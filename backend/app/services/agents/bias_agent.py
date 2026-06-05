import copy
import csv
import json
import os
import re
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional

from app.config import settings
from .base_agent import get_openai_client, parse_llm_json, sanitize_provider_error


def _ranking_score(rank_value: Optional[int]) -> int:
    if not rank_value:
        return 0
    if rank_value <= 50:
        return 95
    if rank_value <= 100:
        return 88
    if rank_value <= 250:
        return 75
    if rank_value <= 500:
        return 62
    return 45

def _ranking_badge(rank_value: Optional[int]) -> str:
    if not rank_value:
        return ""
    if rank_value <= 100:
        return "Top 100 institution"
    if rank_value <= 500:
        return "Ranked institution"
    return "Ranking found"

def _cache_ranking_result(result: Dict[str, Any]) -> None:
    if not result.get("institution_name"):
        return
    try:
        from app.database import get_supabase_client

        get_supabase_client().table("institution_ranking_cache").upsert({
            "institution_name": result["institution_name"],
            "ranking_source": result.get("ranking_source") or "",
            "rank_value": result.get("rank_value"),
            "confidence": result.get("confidence") or 0,
            "payload": result,
        }, on_conflict="institution_name").execute()
    except Exception:
        return

def _extract_rank_value(parsed: Dict[str, Any]) -> Optional[int]:
    rank_value = (
        parsed.get("rank_value")
        or parsed.get("rank")
        or parsed.get("qs_rank")
        or parsed.get("the_rank")
        or parsed.get("world_rank")
    )
    if isinstance(rank_value, str):
        match = re.search(r"\d+", rank_value.replace(",", ""))
        rank_value = match.group(0) if match else None
    return int(rank_value) if rank_value is not None else None

def _normalize_ranking_provider_payload(parsed: Dict[str, Any], school_name: str, source: str) -> Dict[str, Any]:
    rank = _extract_rank_value(parsed)
    return {
        "institution_name": parsed.get("institution_name") or parsed.get("display_name") or school_name,
        "ranking_status": "live" if rank is not None else "live_no_rank",
        "ranking_source": parsed.get("ranking_source") or source,
        "rank_value": rank,
        "confidence": float(parsed.get("confidence") or (0.9 if rank else 0.35)),
        "payload": parsed,
        "reason": f"Ranking provider returned rank {rank}." if rank else "Ranking provider returned live data but no official rank value.",
    }

def _fetch_json_url(url: str, api_key: str = "") -> Dict[str, Any]:
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    if api_key.strip():
        request.add_header("Authorization", f"Bearer {api_key.strip()}")
    with urllib.request.urlopen(request, timeout=8) as response:
        return json.loads(response.read().decode("utf-8"))


_qs_rankings_cache = None

_BUILTIN_DEMO_QS_RANKINGS: Dict[str, Dict[str, Any]] = {
    "asia pacific university": {
        "rank": 597,
        "school": "Asia Pacific University of Technology and Innovation (APU) Malaysia",
        "country": "Malaysia",
    },
    "apu": {
        "rank": 597,
        "school": "Asia Pacific University of Technology and Innovation (APU) Malaysia",
        "country": "Malaysia",
    },
    "asia pacific university of technology and innovation": {
        "rank": 597,
        "school": "Asia Pacific University of Technology and Innovation (APU) Malaysia",
        "country": "Malaysia",
    },
    "universiti kuala lumpur": {
        "rank": 1201,
        "school": "Universiti Kuala Lumpur (UniKL)",
        "country": "Malaysia",
    },
    "unikl": {
        "rank": 1201,
        "school": "Universiti Kuala Lumpur (UniKL)",
        "country": "Malaysia",
    },
}


def _normalize_institution_name(name: str) -> str:
    normalized = re.sub(r"\(.*?\)", "", str(name or "")).lower()
    normalized = re.sub(r"[^a-z0-9]+", " ", normalized)
    return " ".join(normalized.split())


def _lookup_builtin_demo_rank_details(school_name: str) -> Optional[Dict[str, Any]]:
    query = _normalize_institution_name(school_name)
    if not query:
        return None
    if query in _BUILTIN_DEMO_QS_RANKINGS:
        return dict(_BUILTIN_DEMO_QS_RANKINGS[query])
    for alias, details in _BUILTIN_DEMO_QS_RANKINGS.items():
        if alias in query or query in alias:
            return dict(details)
    return None

def _load_qs_rankings() -> Dict[str, Dict[str, Any]]:
    global _qs_rankings_cache
    if _qs_rankings_cache is not None:
        return _qs_rankings_cache

    cache = {}
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
    
    # Try the user-supplied filename in base directory
    csv_path = os.path.join(base_dir, "2026 QS World University Rankings.csv")
    
    if not os.path.exists(csv_path):
        # fallback to standard qs_rankings.csv
        csv_path = os.path.join(base_dir, "data", "qs_rankings.csv")
        if not os.path.exists(csv_path):
            csv_path = os.path.join("backend", "data", "qs_rankings.csv")
            if not os.path.exists(csv_path):
                csv_path = os.path.join("data", "qs_rankings.csv")

    if not os.path.exists(csv_path):
        _qs_rankings_cache = {}
        return _qs_rankings_cache

    try:
        with open(csv_path, mode="r", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            for row in reader:
                school_name = row.get("Institution Name")
                rank_str = row.get("2026 Rank")
                if school_name and rank_str:
                    try:
                        rank_match = re.search(r"\d+", rank_str)
                        rank_val = int(rank_match.group(0)) if rank_match else None
                        if rank_val is not None:
                            cache[school_name.strip()] = {
                                "rank": rank_val,
                                "school": school_name.strip(),
                                "country": row.get("Country/Territory", "").strip()
                            }
                    except Exception:
                        continue
    except Exception as e:
        print(f"Error loading QS rankings CSV: {e}")

    _qs_rankings_cache = cache
    return _qs_rankings_cache

def lookup_qs_rank_details(school_name: str) -> Optional[Dict[str, Any]]:
    if not school_name:
        return None
    rankings = _load_qs_rankings()
    name_clean = school_name.strip()
    name_lower = name_clean.lower()

    if name_clean in rankings:
        return rankings[name_clean]

    for name, details in rankings.items():
        if name.lower() == name_lower:
            return details

    if len(name_lower) >= 4:
        for name, details in rankings.items():
            name_csv_lower = name.lower()
            if name_lower in name_csv_lower or name_csv_lower in name_lower:
                return details

        for name, details in rankings.items():
            name_csv_clean = _normalize_institution_name(name)
            query_clean = _normalize_institution_name(name_clean)
            if name_csv_clean and query_clean:
                if name_csv_clean == query_clean or query_clean in name_csv_clean or name_csv_clean in query_clean:
                    return details

    # Railway deployments should normally include backend/data/qs_rankings.csv.
    # This narrow fallback keeps seeded demo candidates rank-tagged even if the
    # CSV is missing from a deployment image or an old cache-only backend.
    demo_match = _lookup_builtin_demo_rank_details(name_clean)
    if demo_match:
        return demo_match

    return None

def lookup_qs_rank_from_csv(school_name: str) -> Optional[int]:
    details = lookup_qs_rank_details(school_name)
    return details["rank"] if details else None

def fetch_university_ranking(school_name: str) -> Dict[str, Any]:
    if not school_name:
        return {
            "institution_name": "",
            "ranking_status": "unknown",
            "ranking_source": "",
            "rank_value": None,
            "confidence": 0,
            "reason": "No institution name was provided.",
        }

    # Try local CSV ranking first (highly reliable, clean matching)
    csv_match = lookup_qs_rank_details(school_name)
    if csv_match:
        rank = csv_match["rank"]
        return {
            "institution_name": csv_match["school"],
            "ranking_status": "live",
            "ranking_source": "QS World University Rankings 2026",
            "rank_value": rank,
            "confidence": 1.0,
            "payload": {
                "country": csv_match["country"],
                "rank": rank,
            },
            "reason": f"Found in QS Rankings CSV with rank {rank}.",
        }

    try:
        from app.database import get_supabase_client

        name_lower = str(school_name).lower().strip()
        response = (
            get_supabase_client()
            .table("institution_ranking_cache")
            .select("rank_value,institution_name,ranking_source,confidence,payload")
            .ilike("institution_name", f"%{name_lower}%")
            .limit(1)
            .execute()
        )
        rows = getattr(response, "data", None) or []
        if rows:
            cached_rank = rows[0].get("rank_value")
            rank = int(cached_rank) if cached_rank is not None else None
            return {
                "institution_name": rows[0].get("institution_name") or school_name,
                "ranking_status": "cached",
                "ranking_source": rows[0].get("ranking_source") or "supabase_cache",
                "rank_value": rank,
                "confidence": float(rows[0].get("confidence") or 0.85),
                "payload": rows[0].get("payload") or {},
                "reason": (
                    f"Ranking was loaded from institution_ranking_cache with rank {rank}."
                    if rank is not None else
                    "Institution evidence was loaded from institution_ranking_cache; no official rank value is cached."
                ),
            }
    except Exception:
        pass

    return {
        "institution_name": school_name,
        "ranking_status": "unknown",
        "ranking_source": "",
        "rank_value": None,
        "confidence": 0,
        "reason": "No cached ranking or live ranking provider is configured.",
    }

def get_university_qs_rank(school_name: str) -> Optional[int]:
    result = fetch_university_ranking(school_name)
    rank = result.get("rank_value")
    return int(rank) if rank is not None else None


def _flatten_text(value: Any) -> str:
    if isinstance(value, dict):
        return " ".join(_flatten_text(item) for item in value.values())
    if isinstance(value, list):
        return " ".join(_flatten_text(item) for item in value)
    return str(value or "")


def _add_indicator(indicators: List[Dict[str, Any]], seen: set[str], original: str, indicator_type: str, category: str, score: int, source: str) -> None:
    cleaned = " ".join(str(original or "").split())
    if not cleaned:
        return
    key = f"{indicator_type}:{cleaned.lower()}:{source}"
    if key in seen:
        return
    seen.add(key)
    ranking = fetch_university_ranking(cleaned) if indicator_type == "university" else {
        "ranking_status": "not_applicable",
        "rank_value": None,
        "ranking_source": "",
        "confidence": 0,
        "reason": "Ranking lookup applies only to institutions.",
    }
    qs_rank = ranking.get("rank_value")
    score = _ranking_score(qs_rank) if indicator_type == "university" else score
    indicators.append({
        "type": indicator_type,
        "original": cleaned,
        "neutral_category": category,
        "confidence": ranking.get("confidence") or 0.72,
        "prestige_score": score,
        "source": source,
        "reason": f"{cleaned} was classified as {category}; ranking status is {ranking.get('ranking_status')}.",
        "qs_rank": qs_rank,
        "qs_badge": _ranking_badge(qs_rank),
        "ranking_status": ranking.get("ranking_status"),
        "ranking_source": ranking.get("ranking_source"),
    })


def _scan_text_for_indicators(text: str, source: str, indicators: List[Dict[str, Any]], seen: set[str]) -> None:
    # No hardcoded institution or employer ranking list is used here. The
    # deterministic path only classifies explicit structured names, while live
    # ranking evidence comes from institution_ranking_cache or RANKING_API_URL.
    return


def _rule_based_analysis(candidate_profile: Dict[str, Any], resume_text: str = "") -> Dict[str, Any]:
    indicators: List[Dict[str, Any]] = []
    seen: set[str] = set()

    for edu in candidate_profile.get("education") or []:
        if isinstance(edu, dict):
            school = edu.get("school") or edu.get("institution") or ""
            if school and not any(item["original"].lower() == str(school).lower() for item in indicators):
                category = "Education Provider"
                _add_indicator(indicators, seen, school, "university", category, 0, "education")

    for exp in candidate_profile.get("experiences") or []:
        if isinstance(exp, dict):
            company = exp.get("company") or exp.get("employer") or ""
            if company and not any(item["original"].lower() == str(company).lower() for item in indicators):
                category = "Startup Experience" if re.search(r"startup|founder|co-founder", _flatten_text(exp), re.I) else "Employer Experience"
                _add_indicator(indicators, seen, company, "employer", category, 0, "experience")

    scored = [item.get("prestige_score", 0) for item in indicators if item.get("prestige_score")]
    prestige_score = round(sum(scored) / len(scored)) if scored else 0
    return {
        "prestige_indicators": indicators[:24],
        "prestige_score": prestige_score,
        "neutralization_summary": (
            f"{len(indicators)} prestige-related signal{'s' if len(indicators) != 1 else ''} classified into neutral categories."
            if indicators else
            "No ranking-backed prestige indicators detected; evaluation can proceed on merit signals."
        )
    }


def analyze_prestige_indicators(candidate_profile: Dict[str, Any], resume_text: str = "", use_llm: bool = True) -> Dict[str, Any]:
    baseline = _rule_based_analysis(candidate_profile or {}, resume_text or "")
    
    indicators_list = []
    neutralization_summary = ""
    
    client = get_openai_client() if use_llm else None
    parsed = None
    if client:
        prompt = """Analyze this candidate profile for prestige-related hiring-bias indicators.
Classify universities, previous employers, certifications, elite internship programs, and other pedigree signals.
Return JSON only:
{
  "prestige_indicators": [
    {"type": "university|employer|certification|program|other", "original": "string", "neutral_category": "Top-Tier University", "confidence": 0.0, "prestige_score": 0, "source": "education|experience|resume", "reason": "short explanation"}
  ],
  "prestige_score": 0,
  "neutralization_summary": "one sentence"
}
Do not infer protected classes or demographic identity."""
        try:
            response = client.chat.completions.create(
                model=settings.OPENAI_MODEL,
                temperature=0,
                messages=[
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": json.dumps({"candidate_profile": candidate_profile, "resume_text": resume_text[:4000]})}
                ]
            )
            parsed = parse_llm_json(response.choices[0].message.content)
        except Exception as e:
            print(f"Bias Agent API error: {sanitize_provider_error(e)}")
            
    if parsed and isinstance(parsed.get("prestige_indicators"), list):
        merged = {item.get("original", "").lower(): item for item in baseline["prestige_indicators"]}
        for item in parsed["prestige_indicators"]:
            original = str(item.get("original") or "").strip()
            if original:
                item_type = item.get("type") or "other"
                ranking = fetch_university_ranking(original) if item_type == "university" else {}
                qs_rank = ranking.get("rank_value")
                merged[original.lower()] = {
                    "type": item_type,
                    "original": original,
                    "neutral_category": item.get("neutral_category") or "Prestige Indicator",
                    "confidence": item.get("confidence", 0.78),
                    "prestige_score": _ranking_score(qs_rank) if item_type == "university" else max(0, min(100, int(item.get("prestige_score", 0) or 0))),
                    "source": item.get("source") or "profile",
                    "reason": item.get("reason") or "Detected by Bias Agent.",
                    "qs_rank": qs_rank,
                    "qs_badge": _ranking_badge(qs_rank),
                    "ranking_status": ranking.get("ranking_status") if item_type == "university" else "not_applicable",
                    "ranking_source": ranking.get("ranking_source") if item_type == "university" else "",
                }
        indicators_list = list(merged.values())
        neutralization_summary = parsed.get("neutralization_summary") or baseline["neutralization_summary"]
    else:
        indicators_list = baseline["prestige_indicators"]
        neutralization_summary = baseline["neutralization_summary"]

    # Force Candidate education schools from profile into prestige indicators if in QS rankings CSV
    merged_final = {item.get("original", "").lower(): item for item in indicators_list}
    for edu in (candidate_profile.get("education") or []):
        if isinstance(edu, dict):
            school = edu.get("school") or edu.get("institution") or ""
            if school:
                csv_match = lookup_qs_rank_details(school)
                if csv_match:
                    rank = csv_match["rank"]
                    school_name = csv_match["school"]
                    key = school_name.lower()
                    merged_final[key] = {
                        "type": "university",
                        "original": school_name,
                        "neutral_category": "Top-Tier University" if rank <= 100 else "Education Provider",
                        "confidence": 1.0,
                        "prestige_score": _ranking_score(rank),
                        "source": "education",
                        "reason": f"Found in QS Rankings CSV with rank {rank}.",
                        "qs_rank": rank,
                        "qs_badge": _ranking_badge(rank),
                        "ranking_status": "live",
                        "ranking_source": "QS World University Rankings 2026",
                    }
                    if school.lower() != school_name.lower():
                        merged_final[school.lower()] = merged_final[key]
                        
    indicators = list(merged_final.values())[:24]
    scored = [item.get("prestige_score", 0) for item in indicators if item.get("prestige_score")]
    prestige_score = max(0, min(100, int(sum(scored) / max(1, len(scored))) if scored else 0))
    
    return {
        "prestige_indicators": indicators,
        "prestige_score": prestige_score,
        "neutralization_summary": neutralization_summary
    }


def neutralize_text(text: str, analysis: Dict[str, Any] | None = None) -> str:
    if not text:
        return text
    result = str(text)
    indicators = (analysis or {}).get("prestige_indicators") or []
    for item in sorted(indicators, key=lambda entry: len(str(entry.get("original", ""))), reverse=True):
        original = str(item.get("original") or "").strip()
        category = str(item.get("neutral_category") or "Neutral Category").strip()
        if original:
            result = re.sub(re.escape(original), category, result, flags=re.IGNORECASE)
    return result


def neutralize_candidate_profile(candidate_profile: Dict[str, Any], analysis: Dict[str, Any] | None = None) -> Dict[str, Any]:
    profile = copy.deepcopy(candidate_profile or {})

    def walk(value: Any) -> Any:
        if isinstance(value, dict):
            return {key: walk(item) for key, item in value.items()}
        if isinstance(value, list):
            return [walk(item) for item in value]
        if isinstance(value, str):
            return neutralize_text(value, analysis)
        return value

    return walk(profile)


def apply_bias_controls_to_assessment(
    assessment: Dict[str, Any],
    job_requirements: Dict[str, Any],
    candidate_profile: Dict[str, Any],
    controls: Dict[str, Any] | None = None,
    prestige_analysis: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    controls = controls or {}
    mode = "prestige_aware" if controls.get("scoring_mode") == "prestige_aware" else "blind_merit"
    prestige_weight = max(0, min(50, int(controls.get("prestige_weight", 30) or 30)))
    analysis = prestige_analysis or analyze_prestige_indicators(candidate_profile)
    scores = {**(assessment.get("scores") or {})}

    technical = int(scores.get("technical") or 0)
    domain_score = int(scores.get("domain") or 0)
    culture_score = int(scores.get("culture") or 0)
    trajectory = int(scores.get("trajectory_slope") or 0)

    prestige_score = int(analysis.get("prestige_score") if analysis.get("prestige_score") is not None else 0)
    base_score = int(scores.get("overall_position_fit") or round((technical * 0.45) + (domain_score * 0.25) + (culture_score * 0.15) + (trajectory * 0.15)))

    result = copy.deepcopy(assessment)
    contributors = [
        item for item in list(result.get("score_contributors") or [])
        if item.get("factor") not in {"Prestige factor", "Transparent prestige weighting"}
    ]

    skills_score = technical
    experience_score = round((domain_score * 0.6) + (trajectory * 0.4))
    reputation_score = prestige_score

    fair_score = base_score
    active_prestige_weight = prestige_weight if mode == "prestige_aware" else 0
    merit_weight = 100 - active_prestige_weight
    biased_score = round((base_score * merit_weight / 100) + (prestige_score * active_prestige_weight / 100))

    if mode == "prestige_aware" and prestige_weight > 0:
        adjusted_score = biased_score
        scores["overall_position_fit"] = adjusted_score
    else:
        adjusted_score = fair_score
        scores["overall_position_fit"] = adjusted_score

    score_delta = adjusted_score - fair_score
    calculation = {
        "fair_score": fair_score,
        "reputation_score": reputation_score,
        "merit_weight": merit_weight,
        "reputation_weight": active_prestige_weight,
        "final_score": adjusted_score,
        "delta": score_delta,
        "formula": (
            f"round(({fair_score} x {merit_weight}%) + "
            f"({reputation_score} x {active_prestige_weight}%)) = {adjusted_score}"
        )
    }

    if mode == "prestige_aware" and prestige_weight > 0:
        contributors.append({
            "factor": "Transparent prestige weighting",
            "score": prestige_score,
            "weight": prestige_weight,
            "impact": round(prestige_score * prestige_weight / 100, 1),
            "reason": f"Prestige-aware mode is active, so neutralized pedigree signals contribute {prestige_weight}% of the score."
        })
        explanation_note = f" Reputation formula: {calculation['formula']}, a {score_delta:+d} point change from blind merit."
    else:
        contributors.append({
            "factor": "Prestige factor",
            "score": prestige_score,
            "weight": 0,
            "impact": 0,
            "reason": "Prestige factor disabled in current evaluation mode; school and employer reputation do not affect the score."
        })
        explanation_note = " Prestige factor disabled in current evaluation mode."

    high_potential = trajectory >= 82 and technical >= 70
    undervalued = high_potential and prestige_score < 65
    intelligence = {
        "high_potential_candidate": high_potential,
        "undervalued_talent_alert": undervalued,
        "signals": [
            signal for signal, active in [
                ("Strong growth trajectory and role evidence indicate high potential.", high_potential),
                ("Candidate may be undervalued because merit signals exceed pedigree signals.", undervalued),
            ] if active
        ]
    }

    scores["technical"] = technical
    scores["domain"] = domain_score
    scores["culture"] = culture_score
    scores["trajectory_slope"] = trajectory

    result["scores"] = scores
    result["score_contributors"] = contributors
    result["score_explanation"] = f"Overall position fit is {adjusted_score}/100. Blind merit is {fair_score}/100 = {technical}x45% must-have evidence + {domain_score}x25% domain/context + {culture_score}x15% success/working-style signals + {trajectory}x15% trajectory.{explanation_note}"
    result["prestige_analysis"] = analysis
    result["resume_context_intelligence"] = intelligence

    result["bias_control"] = {
        "scoring_mode": mode,
        "prestige_weight": prestige_weight if mode == "prestige_aware" else 0,
        "prestige_score": prestige_score,
        "prestige_affects_score": mode == "prestige_aware" and prestige_weight > 0,
        "neutralize_prestige": bool(controls.get("neutralize_prestige")),
        "anonymized_blind_hiring": bool(controls.get("anonymized_blind_hiring")),
        "fair_score": fair_score,
        "biased_score": biased_score,
        "three_tier_scores": {
            "skills_score": skills_score,
            "experience_score": experience_score,
            "reputation_score": reputation_score,
        },
        "calculation": calculation,
        "explanation": (
            "Prestige-aware mode is enabled with a transparent weighting component."
            if mode == "prestige_aware"
            else "Blind Merit mode is enabled; prestige indicators are classified but excluded from scoring."
        )
    }
    return result
