import json
import re
from typing import Dict, Any, List, Tuple
from app.config import settings
from .base_agent import get_openai_client, parse_llm_json
from .bias_agent import analyze_prestige_indicators, apply_bias_controls_to_assessment, lookup_qs_rank_from_csv

# D. MATCHING AGENT
# ==========================================
STOPWORDS = {
    "and", "or", "the", "with", "for", "from", "that", "this", "role", "candidate",
    "experience", "knowledge", "skills", "skill", "ability", "able", "working",
    "strong", "good", "excellent", "relevant", "years", "year", "team", "build",
    "building", "using", "based", "focused", "required", "preferred"
}

def _collect_sourcing_terms(job_requirements: Dict[str, Any]) -> List[str]:
    criteria = job_requirements.get("sourcing_criteria") or {}
    raw_values: List[str] = []

    raw_values.extend(job_requirements.get("requirements", []))
    for key in ("candidate_profile", "must_have_skills", "domain_context", "success_signals", "search_keywords"):
        value = criteria.get(key)
        if isinstance(value, str):
            raw_values.append(value)

    terms: List[str] = []
    for value in raw_values:
        for term in re.split(r"[,;\n]| and | or ", value):
            cleaned = term.strip(" .").strip()
            if cleaned and len(cleaned) <= 60 and cleaned.lower() not in {t.lower() for t in terms}:
                terms.append(cleaned)

    return terms[:8]

def _flatten_text(value: Any) -> str:
    if isinstance(value, dict):
        return " ".join(_flatten_text(item) for item in value.values())
    if isinstance(value, list):
        return " ".join(_flatten_text(item) for item in value)
    return str(value or "")

def _tokenize(value: Any) -> List[str]:
    text = _flatten_text(value).lower()
    raw_tokens = re.findall(r"[a-zA-Z][a-zA-Z0-9+#.]{1,}", text)
    return [token for token in raw_tokens if token not in STOPWORDS and len(token) > 2]

def _extract_keywords(values: List[Any], limit: int = 18) -> List[str]:
    phrases: List[str] = []
    seen = set()
    for value in values:
        if isinstance(value, list):
            candidates = value
        else:
            candidates = re.split(r"[,;\n]| and | or ", str(value or ""))
        for candidate in candidates:
            cleaned = str(candidate).strip(" .:-").strip()
            if not cleaned:
                continue
            words = [word for word in _tokenize(cleaned) if word]
            if not words:
                continue
            phrase = " ".join(words[:5])
            if phrase and phrase not in seen:
                seen.add(phrase)
                phrases.append(cleaned)

    if len(phrases) < limit:
        token_counts: Dict[str, int] = {}
        for token in _tokenize(values):
            token_counts[token] = token_counts.get(token, 0) + 1
        for token, _count in sorted(token_counts.items(), key=lambda item: item[1], reverse=True):
            if token not in seen:
                seen.add(token)
                phrases.append(token)
            if len(phrases) >= limit:
                break
    return phrases[:limit]

def _build_role_signal_groups(job_requirements: Dict[str, Any]) -> Dict[str, List[str]]:
    criteria = job_requirements.get("sourcing_criteria") or {}
    return {
        "must_have": _extract_keywords([
            job_requirements.get("requirements", []),
            job_requirements.get("pillars", []),
            criteria.get("must_have_skills", ""),
            criteria.get("candidate_profile", ""),
            job_requirements.get("boolean_queries", "")
        ], limit=16),
        "domain": _extract_keywords([
            job_requirements.get("title", ""),
            job_requirements.get("department", ""),
            job_requirements.get("description", ""),
            criteria.get("domain_context", ""),
            criteria.get("search_keywords", "")
        ], limit=12),
        "success": _extract_keywords([
            criteria.get("success_signals", ""),
            job_requirements.get("behavioral", []),
            criteria.get("target_profile", "")
        ], limit=10),
        "avoid": _extract_keywords([criteria.get("avoid_signals", ""), criteria.get("concerns", "")], limit=8)
    }

def _phrase_score(phrase: str, candidate_text: str, candidate_tokens: set[str]) -> Tuple[str, float]:
    phrase_tokens = set(_tokenize(phrase))
    if not phrase_tokens:
        return "missing", 0.0
    performance_tokens = {"performance", "optimization", "optimisation", "latency", "speed"}
    if phrase_tokens & performance_tokens and any(token in candidate_tokens for token in ("improved", "reduced", "load", "latency", "optimized", "optimised", "faster")):
        if len(phrase_tokens & candidate_tokens) >= 1:
            return "matched", 0.85
        return "partial", 0.55
    normalized_phrase = " ".join(_tokenize(phrase))
    if normalized_phrase and normalized_phrase in candidate_text:
        return "matched", 1.0
    overlap = len(phrase_tokens & candidate_tokens) / max(1, len(phrase_tokens))
    if overlap >= 0.66:
        return "matched", 0.85
    if overlap >= 0.34:
        return "partial", 0.45
    return "missing", 0.0

def _evaluate_signal_group(signals: List[str], candidate_text: str, candidate_tokens: set[str]) -> Dict[str, Any]:
    matched: List[str] = []
    partial: List[str] = []
    missing: List[str] = []
    total = 0.0
    for signal in signals:
        status, value = _phrase_score(signal, candidate_text, candidate_tokens)
        total += value
        if status == "matched":
            matched.append(signal)
        elif status == "partial":
            partial.append(signal)
        else:
            missing.append(signal)

    score = round((total / max(1, len(signals))) * 100)
    return {"score": score, "matched": matched[:6], "partial": partial[:6], "missing": missing[:6]}

def _trajectory_score(candidate_profile: Dict[str, Any]) -> int:
    profile_text = _flatten_text(candidate_profile).lower()
    experiences = candidate_profile.get("experiences") or []
    score = 62
    growth_terms = ("promoted", "lead", "senior", "owner", "architect", "founded", "launched", "scaled", "mentored")
    score += min(18, sum(4 for term in growth_terms if term in profile_text))
    if len(experiences) >= 2:
        latest = str(experiences[0].get("title", "")).lower() if isinstance(experiences[0], dict) else ""
        earliest = str(experiences[-1].get("title", "")).lower() if isinstance(experiences[-1], dict) else ""
        if any(term in latest for term in ("senior", "lead", "manager", "architect")) and not any(term in earliest for term in ("senior", "lead", "manager", "architect")):
            score += 14
    if candidate_profile.get("awards"):
        score += 6
    if len(candidate_profile.get("skills") or []) >= 8:
        score += 6
    # Look up qs_rank inside candidate_profile education entries
    for edu in candidate_profile.get("education") or []:
        if isinstance(edu, dict):
            school = edu.get("school") or edu.get("institution") or ""
            # Use injected rank or look it up from CSV
            rank = edu.get("qs_rank")
            if not rank and school:
                rank = lookup_qs_rank_from_csv(school)
            if rank:
                if rank <= 100:
                    score += 12
                elif rank <= 500:
                    score += 8
                else:
                    score += 4
                break # Only apply one school bonus
    return max(35, min(98, score))

def build_position_fit_assessment(
    job_requirements: Dict[str, Any],
    candidate_profile: Dict[str, Any],
    bias_controls: Dict[str, Any] | None = None,
    prestige_analysis: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    signal_groups = _build_role_signal_groups(job_requirements)
    candidate_text = " ".join(_tokenize(candidate_profile))
    candidate_tokens = set(candidate_text.split())

    must_have = _evaluate_signal_group(signal_groups["must_have"], candidate_text, candidate_tokens)
    domain = _evaluate_signal_group(signal_groups["domain"], candidate_text, candidate_tokens)
    success = _evaluate_signal_group(signal_groups["success"], candidate_text, candidate_tokens)
    avoid = _evaluate_signal_group(signal_groups["avoid"], candidate_text, candidate_tokens)

    technical_score = round((must_have["score"] * 0.9) + (success["score"] * 0.1))
    domain_score = round((domain["score"] * 0.9) + (success["score"] * 0.1))
    culture_score = max(35, min(95, round(68 + success["score"] * 0.25 - len(avoid["matched"]) * 8)))
    trajectory_score = _trajectory_score(candidate_profile)
    overall_fit = round((technical_score * 0.45) + (domain_score * 0.25) + (culture_score * 0.15) + (trajectory_score * 0.15))
    score_contributors = [
        {
            "factor": "Must-have role evidence",
            "score": technical_score,
            "weight": 45,
            "impact": round(technical_score * 0.45, 1),
            "reason": f"Matched {len(must_have['matched'])}, partial {len(must_have['partial'])}, missing {len(must_have['missing'])} current-position requirements."
        },
        {
            "factor": "Domain and position context",
            "score": domain_score,
            "weight": 25,
            "impact": round(domain_score * 0.25, 1),
            "reason": f"Matched {len(domain['matched'])}, partial {len(domain['partial'])}, missing {len(domain['missing'])} title, department, or domain signals."
        },
        {
            "factor": "Success and working style signals",
            "score": culture_score,
            "weight": 15,
            "impact": round(culture_score * 0.15, 1),
            "reason": f"Success signals score {success['score']}/100 with {len(avoid['matched'])} avoid-signal concerns found."
        },
        {
            "factor": "Trajectory and growth",
            "score": trajectory_score,
            "weight": 15,
            "impact": round(trajectory_score * 0.15, 1),
            "reason": "Based on progression, breadth of experience, learning signals, awards, and skill coverage in the candidate profile."
        }
    ]

    title = job_requirements.get("title", "this position")
    critical_cons = []
    if must_have["missing"]:
        critical_cons.append(f"For {title}, missing or weak evidence for: {', '.join(must_have['missing'][:4])}.")
    if domain["missing"]:
        critical_cons.append(f"Role/domain alignment needs verification around: {', '.join(domain['missing'][:3])}.")
    if avoid["matched"]:
        critical_cons.append(f"Potential concern signals for this role: {', '.join(avoid['matched'][:3])}.")
    if not critical_cons:
        critical_cons.append(f"No major position-specific gaps found for {title}; validate depth in screening.")

    advocate_pros = []
    if must_have["matched"]:
        advocate_pros.append(f"Direct evidence for {title} requirements: {', '.join(must_have['matched'][:4])}.")
    if success["matched"] or success["partial"]:
        advocate_pros.append(f"Shows success signals relevant to this role: {', '.join([*success['matched'], *success['partial']][:4])}.")
    advocate_pros.append(f"Trajectory score is {trajectory_score}/100 based on progression, breadth, and learning signals.")

    assessment = {
        "debate": {
            "critical_recruiter_cons": critical_cons,
            "talent_advocate_pros": advocate_pros
        },
        "scores": {
            "technical": technical_score,
            "domain": domain_score,
            "culture": culture_score,
            "trajectory_slope": trajectory_score,
            "overall_position_fit": overall_fit
        },
        "fit_breakdown": {
            "must_have": must_have,
            "domain": domain,
            "success_signals": success,
            "avoid_signals": avoid
        },
        "score_contributors": score_contributors,
        "position_fit_summary": (
            f"{candidate_profile.get('name', 'Candidate')} scores {overall_fit}/100 for {title}. "
            f"Strongest evidence: {', '.join(must_have['matched'][:3]) or 'not yet clear'}. "
            f"Main verification area: {', '.join(must_have['missing'][:3] or domain['missing'][:3]) or 'depth during interview'}."
        ),
        "score_explanation": (
            f"Overall position fit is {overall_fit}/100 = "
            f"{technical_score}x45% must-have evidence + {domain_score}x25% domain/context + "
            f"{culture_score}x15% success/working-style signals + {trajectory_score}x15% trajectory."
        )
    }

    analysis = prestige_analysis or analyze_prestige_indicators(candidate_profile)
    return apply_bias_controls_to_assessment(assessment, job_requirements, candidate_profile, bias_controls, analysis)

def run_matching_agent(
    job_requirements: Dict[str, Any],
    candidate_profile: Dict[str, Any],
    bias_controls: Dict[str, Any] | None = None,
    prestige_analysis: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    client = get_openai_client()
    analysis = prestige_analysis or analyze_prestige_indicators(candidate_profile)
    calibration_controls = {**(bias_controls or {}), "scoring_mode": "blind_merit", "prestige_weight": 0}
    base_assessment = build_position_fit_assessment(job_requirements, candidate_profile, calibration_controls, analysis)
    system_prompt = """You are an expert two-persona hiring committee. You will evaluate the match between ONE CURRENT POSITION and ONE candidate profile.
You MUST output two highly detailed, contrasting evaluation arguments:

1. CRITICAL RECRUITER PERSPECTIVE: Focus intensely on risks relative to THIS position only. Call out missing must-have skills, weak evidence against the current role's success signals, domain mismatch, or unsupported claims.
2. TALENT ADVOCATE PERSPECTIVE: Focus on evidence that transfers directly into THIS position. Highlight demonstrated achievements, matching technologies, domain overlap, and learning velocity only when relevant to the current role.

If the Job Requirement profile includes sourcing_criteria from the hiring-manager intake, treat those answers as first-class matching criteria. Evaluate must-have skills, target profile, domain context, success signals, avoid signals, and search keywords against the candidate profile.

Calculate the following metric values:
- technical (integer, 0-100): weighted score for must-have skills and role pillars.
- domain (integer, 0-100): weighted score for the current position's domain, department, and context.
- culture (integer, 0-100): success-signal fit minus avoid-signal risks for this role.
- trajectory_slope (integer, 0-100): Based on career acceleration, rapid promotions, and skills acquisition rate.
- overall_position_fit (integer, 0-100): weighted final match for THIS position.

Use the provided baseline assessment as calibration. You may adjust scores only when the profile contains clear evidence the baseline missed.

Output JSON Format:
{
  "debate": {
    "critical_recruiter_cons": [
      "Tenure is relatively short at current role.",
      "Lacks direct experience with Vite configurations."
    ],
    "talent_advocate_pros": [
      "Exceptional trajectory: promoted twice in under 3 years.",
      "Highly active contributor in modern frontend repos."
    ]
  },
  "scores": {
    "technical": 85,
    "domain": 80,
    "culture": 90,
    "trajectory_slope": 95,
    "overall_position_fit": 86
  },
  "fit_breakdown": {
    "must_have": {"score": 80, "matched": ["React"], "partial": ["Node APIs"], "missing": ["distributed systems"]},
    "domain": {"score": 70, "matched": ["Engineering"], "partial": [], "missing": ["fintech"]},
    "success_signals": {"score": 75, "matched": ["ownership"], "partial": [], "missing": []},
    "avoid_signals": {"score": 0, "matched": [], "partial": [], "missing": []}
  },
  "score_contributors": [
    {"factor": "Must-have role evidence", "score": 85, "weight": 45, "impact": 38.3, "reason": "Matched React and API work; missing distributed systems depth."}
  ],
  "position_fit_summary": "2-3 sentences explaining why this candidate is or is not a fit for the current position.",
  "score_explanation": "One sentence explaining the weighted calculation and the biggest score drivers."
}
Return ONLY valid JSON.
"""

    user_content = f"""Job Requirements: {json.dumps(job_requirements)}
Candidate Profile: {json.dumps(candidate_profile)}
Baseline Position-Fit Assessment: {json.dumps(base_assessment)}"""

    if client:
        try:
            response = client.chat.completions.create(
                model=settings.OPENAI_MODEL,
                temperature=settings.MATCHING_AGENT_TEMP,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_content}
                ]
            )
            parsed = parse_llm_json(response.choices[0].message.content)
            parsed_scores = {**base_assessment.get("scores", {}), **(parsed.get("scores") or {})}
            merged = {
                **base_assessment,
                **parsed,
                "scores": parsed_scores,
                "fit_breakdown": parsed.get("fit_breakdown") or base_assessment["fit_breakdown"],
                "score_contributors": parsed.get("score_contributors") or base_assessment["score_contributors"],
                "score_explanation": parsed.get("score_explanation") or base_assessment["score_explanation"]
            }
            return apply_bias_controls_to_assessment(merged, job_requirements, candidate_profile, bias_controls, analysis)
        except Exception as e:
            print(f"Matching Agent API error: {e}. Falling back to rule-based debate simulator.")

    return apply_bias_controls_to_assessment(base_assessment, job_requirements, candidate_profile, bias_controls, analysis)

