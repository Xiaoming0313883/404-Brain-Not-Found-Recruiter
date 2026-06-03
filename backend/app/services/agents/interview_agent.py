import json
import re
from typing import Dict, Any, List
from app.config import settings
from .base_agent import get_openai_client, is_structured_output_error, json_schema_response_format, parse_llm_json, sanitize_provider_error
from .matching_agent import _build_role_signal_groups, _tokenize

# E. CANDIDATE INTERVIEW AGENT
# ==========================================
INTERVIEW_EVALUATION_JSON_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "screening_score",
        "position_fit_verdict",
        "hiring_recommendation",
        "decision_reason",
        "role_alignment_summary",
        "score_breakdown",
        "critiques",
    ],
    "properties": {
        "screening_score": {"type": "integer", "minimum": 0, "maximum": 100},
        "position_fit_verdict": {"type": "string"},
        "hiring_recommendation": {"type": "string"},
        "decision_reason": {"type": "string"},
        "role_alignment_summary": {"type": "string"},
        "score_breakdown": {
            "type": "object",
            "additionalProperties": False,
            "required": ["role_requirement_alignment", "technical_correctness_depth", "evidence_specificity", "position_impact", "communication_clarity"],
            "properties": {
                "role_requirement_alignment": {"type": "integer"},
                "technical_correctness_depth": {"type": "integer"},
                "evidence_specificity": {"type": "integer"},
                "position_impact": {"type": "integer"},
                "communication_clarity": {"type": "integer"},
            },
        },
        "critiques": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "question",
                    "candidate_answer",
                    "candidate_answer_excerpt",
                    "per_answer_score",
                    "requirement_focus",
                    "critique",
                    "strengths",
                    "weaknesses",
                    "suggested_improvement",
                    "hiring_manager_note",
                    "decision_reason",
                ],
                "properties": {
                    "question": {"type": "string"},
                    "candidate_answer": {"type": "string"},
                    "candidate_answer_excerpt": {"type": "string"},
                    "per_answer_score": {"type": "integer", "minimum": 0, "maximum": 100},
                    "requirement_focus": {"type": "string"},
                    "critique": {"type": "string"},
                    "strengths": {"type": "array", "items": {"type": "string"}},
                    "weaknesses": {"type": "array", "items": {"type": "string"}},
                    "suggested_improvement": {"type": "string"},
                    "hiring_manager_note": {"type": "string"},
                    "decision_reason": {"type": "string"},
                },
            },
        },
    },
}

def run_interview_agent_phase_a(candidate_profile: Dict[str, Any], matching_debate: Dict[str, Any], job_requirements: Dict[str, Any] | None = None) -> List[str]:
    """Phase A: Generate 3 targeted custom screening questions."""
    client = get_openai_client()
    critical_cons = matching_debate.get("debate", {}).get("critical_recruiter_cons", [])
    
    system_prompt = """You are an expert screening assessment generator. 
Generate exactly 3 targeted technical and architectural screening questions for the candidate based on the CURRENT POSITION and the Critical Recruiter's concerns.
The questions must directly test whether this candidate can succeed in this exact role. Avoid generic questions that could apply to any position.
Each question should mention a concrete role requirement, domain context, or success signal from the job profile.

Output JSON Format:
["Question 1", "Question 2", "Question 3"]
Return ONLY valid JSON.
"""

    if client:
        try:
            response = client.chat.completions.create(
                model=settings.OPENAI_MODEL,
                temperature=settings.INTERVIEW_AGENT_TEMP,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"Current Position: {json.dumps(job_requirements or {})}\nCandidate Profile: {json.dumps(candidate_profile)}\nRecruiter Concerns: {json.dumps(critical_cons)}"}
                ]
            )
            return normalize_screening_questions(parse_llm_json(response.choices[0].message.content))
        except Exception as e:
            print(f"Interview Agent Phase A API error: {e}. Falling back to default generator.")

    role = job_requirements or {}
    title = role.get("title", "this position")
    signals = _build_role_signal_groups(role)
    must_have = signals.get("must_have", [])[:3]
    domain = signals.get("domain", [])[:2]
    gap = (matching_debate.get("fit_breakdown", {}).get("must_have", {}) or {}).get("missing", [])
    focus_terms = [*gap[:2], *must_have, *domain]
    focus_terms = [term for term in focus_terms if term]

    if focus_terms:
        primary = focus_terms[0]
        secondary = focus_terms[1] if len(focus_terms) > 1 else title
        tertiary = focus_terms[2] if len(focus_terms) > 2 else "the role's success metrics"
        return normalize_screening_questions([
            f"For the {title} position, describe a specific project where you used {primary}. What trade-offs did you make and what measurable result did you achieve?",
            f"This role requires strength in {secondary}. Walk through how you would solve a realistic problem in our context, including design decisions and failure handling.",
            f"What evidence from your past work shows you can deliver against {tertiary} for this position, and what gap would you close first after joining?"
        ])

    return normalize_screening_questions([
        f"For the {title} position, describe the most relevant project from your background and the measurable impact you delivered.",
        f"What part of the {title} role would be highest risk for you, and how would you close that gap in your first month?",
        f"Walk through a technical decision you made that best proves your fit for {title}."
    ])

def normalize_screening_questions(value: Any) -> List[str]:
    # If the value is a string, try to parse it as JSON
    if isinstance(value, str):
        val_strip = value.strip()
        if (val_strip.startswith("{") and val_strip.endswith("}")) or (val_strip.startswith("[") and val_strip.endswith("]")):
            try:
                value = json.loads(val_strip)
            except Exception:
                pass
                
    # If it is a dictionary, extract the list of questions
    if isinstance(value, dict):
        q_list = (
            value.get("questions") or 
            value.get("custom_questions") or 
            value.get("screening_questions") or
            value.get("items")
        )
        if q_list:
            value = q_list
        else:
            for k, val in value.items():
                if isinstance(val, list):
                    value = val
                    break
            else:
                value = [v for v in value.values() if isinstance(v, str)]

    # If it is a list with 1 stringified JSON element, parse recursively
    if isinstance(value, list) and len(value) == 1 and isinstance(value[0], str):
        item_strip = value[0].strip()
        if (item_strip.startswith("{") and item_strip.endswith("}")) or (item_strip.startswith("[") and item_strip.endswith("]")):
            try:
                parsed_item = json.loads(item_strip)
                return normalize_screening_questions(parsed_item)
            except Exception:
                pass

    raw_items = value if isinstance(value, list) else []
    questions: List[str] = []
    for item in raw_items:
        if isinstance(item, dict):
            question_text = (
                item.get("question") or 
                item.get("text") or 
                item.get("content") or
                next((v for v in item.values() if isinstance(v, str)), "")
            )
        else:
            question_text = str(item or "")
            
        question = str(question_text).strip().strip('"')
        question = re.sub(r"^(question\s*\d*|content|contents)\s*[:\-]\s*", "", question, flags=re.IGNORECASE).strip()
        if question:
            if not question.endswith("?"):
                question = question.rstrip(".") + "?"
            questions.append(question)
    if len(questions) != 3:
        raise ValueError("Interview Agent must return exactly 3 valid questions.")
    return questions

def run_interview_agent_phase_b(questions: List[str], answers: List[str], job_requirements: Dict[str, Any]) -> Dict[str, Any]:
    """Phase B: Evaluate answers against job requirements with detailed structured critique."""
    client = get_openai_client()
    
    system_prompt = """You are a professional HR interviewer and evidence-based screening evaluator.
Evaluate the candidate's responses against the CURRENT POSITION only. Do not reward generic confidence, long answers, or unrelated experience.
Use the candidate's actual answer text. Every critique must reference details the candidate actually said, and every question must get its own specific feedback.

Use this scoring rubric:
- Role requirement alignment (35%): answer directly addresses the selected job's must-have skills, pillars, and sourcing criteria.
- Role knowledge and depth (25%): answer shows sound decisions, constraints, trade-offs, work methods, or implementation detail appropriate to this role.
- Evidence specificity (20%): answer includes concrete projects, candidate actions, tools, metrics, or outcomes.
- Position impact (10%): answer connects the work to what the current position needs.
- Communication clarity (10%): answer is organized and understandable.

Penalize answers that are vague, copied from generic interview prep, do not mention role-relevant requirements, or lack examples. Do not invent experience that is not present in the answer.
If an answer is a non-answer such as "I don't know", "not sure", "no idea", "N/A", or any refusal/empty response with no job evidence, score that answer 0/100. Do not give credit for clarity, honesty, or brevity when no role evidence is provided.
Return an integer grade (0-100), a score breakdown, hiring recommendation, and rich structured qualitative feedback for EACH answer.

Output JSON Format:
{
  "screening_score": 82,
  "position_fit_verdict": "Strong / Moderate / Weak fit for the current position",
  "hiring_recommendation": "advance / hold / reject",
  "decision_reason": "Concise evidence-based reason for the recommendation and score.",
  "role_alignment_summary": "4-6 sentences explaining the score for this exact position, written for a hiring manager who needs to decide what to do next.",
  "score_breakdown": {
    "role_requirement_alignment": 28,
    "technical_correctness_depth": 20,
    "evidence_specificity": 15,
    "position_impact": 8,
    "communication_clarity": 9
  },
  "critiques": [
    {
      "question": "The full question text",
      "candidate_answer": "The candidate's full answer text, unchanged and not summarized",
      "candidate_answer_excerpt": "The candidate's full answer text, unchanged and not summarized",
      "per_answer_score": 82,
      "requirement_focus": "The role requirement or gap this answer was judged against.",
      "critique": "A detailed 4-6 sentence hiring-manager opinion. Explain what the answer proves, what it does not prove, why the score is justified, and how confident the evaluator should be.",
      "strengths": ["Specific strength 1", "Specific strength 2"],
      "weaknesses": ["Specific gap or weakness 1", "Area needing improvement 2"],
      "suggested_improvement": "A concrete, actionable suggestion the candidate can act on to improve their answer or skill.",
      "hiring_manager_note": "A practical recommendation for the hiring manager, including follow-up evidence to request or interview probes to use.",
      "decision_reason": "The specific evidence and missing evidence that justify this answer score."
    }
  ]
}
- strengths: list of 1-3 concrete positives from the answer
- weaknesses: list of 1-3 specific gaps, omissions, or weak points
- suggested_improvement: one clear, specific actionable tip
- hiring_manager_note: 2-3 sentences describing the evaluator's opinion and what the hiring manager should verify next
Return ONLY valid JSON. No markdown code fences.
"""

    q_and_a_payload = []
    for q, a in zip(questions, answers):
        q_and_a_payload.append({"question": q, "answer": a})

    if client:
        try:
            request = {
                "model": settings.OPENAI_MODEL,
                "temperature": settings.INTERVIEW_AGENT_TEMP,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"Job Requirements: {json.dumps(job_requirements)}\nQ&A: {json.dumps(q_and_a_payload)}"}
                ],
            }
            response_format = json_schema_response_format("interview_evaluation", INTERVIEW_EVALUATION_JSON_SCHEMA)
            if response_format:
                request["response_format"] = response_format
            try:
                response = client.chat.completions.create(**request)
            except Exception as structured_exc:
                if not response_format or not is_structured_output_error(structured_exc):
                    raise
                request.pop("response_format", None)
                response = client.chat.completions.create(**request)
            parsed = parse_llm_json(response.choices[0].message.content)
            return normalize_interview_evaluation(parsed, questions, answers, job_requirements)
        except Exception as e:
            print(f"Interview Agent Phase B API error: {sanitize_provider_error(e, 'Interview Agent unavailable; falling back to rule evaluator.')}")

    return build_position_specific_evaluation(questions, answers, job_requirements)

def _answer_excerpt(answer: str, limit: int = 180) -> str:
    return " ".join(str(answer or "").split())

NON_ANSWER_DIMENSION_SCORES = {
    "role_requirement_alignment": 0,
    "technical_correctness_depth": 0,
    "evidence_specificity": 0,
    "position_impact": 0,
    "communication_clarity": 0
}

def _normalized_answer_text(answer: str) -> str:
    text = str(answer or "").lower().replace("'", "").replace("’", "")
    return re.sub(r"[^a-z0-9\s]", " ", text).strip()

def _is_non_answer(answer: str) -> bool:
    normalized = re.sub(r"\s+", " ", _normalized_answer_text(answer))
    if not normalized:
        return True
    tokens = normalized.split()
    exact_non_answers = {
        "i dont know",
        "idk",
        "dont know",
        "do not know",
        "i do not know",
        "no idea",
        "not sure",
        "im not sure",
        "i am not sure",
        "unsure",
        "unknown",
        "n a",
        "na",
        "none",
        "nil",
        "no answer",
        "cannot answer",
        "cant answer",
        "i cant answer",
        "i cannot answer"
    }
    if normalized in exact_non_answers:
        return True
    non_answer_phrases = (
        "dont know",
        "do not know",
        "no idea",
        "not sure",
        "cannot answer",
        "cant answer"
    )
    return len(tokens) <= 6 and any(phrase in normalized for phrase in non_answer_phrases)

def _invalid_answer_reason(answer: str, question: str = "", role_terms: List[str] | None = None) -> str:
    raw = str(answer or "")
    normalized = re.sub(r"\s+", " ", _normalized_answer_text(answer))
    if not normalized:
        return "The answer is blank."
    tokens = normalized.split()
    if _is_non_answer(answer):
        return "The answer is a non-answer or placeholder."
    placeholder_answers = {"test", "testing", "hello", "hi", "asdf", "qwerty", "sample", "placeholder", "nonsense"}
    if normalized in placeholder_answers:
        return "The answer is a non-answer or placeholder."
    unsafe_phrases = ("ignore previous", "system prompt", "you are chatgpt", "override", "jailbreak")
    if any(phrase in normalized for phrase in unsafe_phrases):
        return "The answer contains a prompt-injection attempt."
    abusive_terms = {"stupid", "idiot", "shut up", "kill", "hate", "fuck", "shit"}
    if any(term in normalized for term in abusive_terms):
        return "The answer contains abusive or inappropriate content."
    compact = re.sub(r"\s+", "", normalized)
    if re.fullmatch(r"([a-z0-9])\1{5,}", compact):
        return "The answer is repeated characters rather than interview evidence."
    if len(compact) >= 6 and len(set(compact)) <= 3:
        return "The answer has too little lexical variety to be meaningful."
    alpha_chars = re.findall(r"[a-z]", raw.lower())
    if raw.strip() and len(alpha_chars) / max(1, len(raw.strip())) < 0.35:
        return "The answer is mostly symbols or numbers rather than interview evidence."
    if len(tokens) <= 5:
        return "The answer is too short to provide role-relevant evidence."
    role_terms = role_terms or []
    question_tokens = set(_tokenize(question))
    answer_tokens = set(_tokenize(answer))
    role_tokens = set(token for term in role_terms for token in _tokenize(term))
    overlap = (question_tokens | role_tokens) & answer_tokens
    generic_terms = {"hardworking", "passionate", "teamwork", "learn", "learning", "good", "best", "responsible"}
    if len(tokens) <= 25 and not overlap and answer_tokens & generic_terms:
        return "The answer is generic and unrelated to the question or role requirements."
    return ""

ROLE_SYNONYM_GROUPS = [
    {"baker", "bakery", "baked", "bread", "pastry", "cake", "oven", "batch", "ingredient", "recipe", "kitchen", "hygiene", "food", "freshness"},
    {"sales", "selling", "customer", "client", "lead", "pipeline", "quota", "negotiation", "revenue"},
    {"marketing", "campaign", "brand", "content", "seo", "social", "analytics", "conversion", "audience"},
    {"design", "designer", "ux", "ui", "prototype", "wireframe", "visual", "layout", "figma"},
    {"software", "developer", "frontend", "backend", "api", "database", "cloud", "react", "node", "python", "deployment"}
]

def _soft_term_match(term: str, answer_tokens: set[str], answer_text: str, question_tokens: set[str]) -> bool:
    term_tokens = set(_tokenize(term))
    if not term_tokens:
        return False
    if len(term_tokens & answer_tokens) / max(1, len(term_tokens)) >= 0.34:
        return True
    if len(term_tokens & question_tokens) / max(1, len(term_tokens)) >= 0.5 and len(question_tokens & answer_tokens) >= 2:
        return True
    for group in ROLE_SYNONYM_GROUPS:
        if term_tokens & group and (answer_tokens & group):
            return True
    normalized_term = " ".join(term_tokens)
    return bool(normalized_term and normalized_term in answer_text)

def _answer_dimension_scores(answer: str, question: str, role_terms: List[str]) -> Dict[str, int]:
    if _is_non_answer(answer):
        return dict(NON_ANSWER_DIMENSION_SCORES)

    answer_tokens = set(_tokenize(answer))
    question_tokens = set(_tokenize(question))
    role_token_sets = [set(_tokenize(term)) for term in role_terms if _tokenize(term)]
    answer_text = " ".join(answer_tokens)
    matched_role_terms = sum(1 for term in role_terms if _soft_term_match(term, answer_tokens, answer_text, question_tokens))
    role_alignment_ratio = matched_role_terms / max(1, len(role_token_sets))
    question_alignment_ratio = len(question_tokens & answer_tokens) / max(1, len(question_tokens))

    metric_terms = re.findall(r"\b\d+(?:\.\d+)?\s*(?:%|ms|seconds?|minutes?|hours?|days?|users?|requests?|x|k|m)?\b", answer.lower())
    evidence_terms = ("i ", "my ", "we ", "project", "built", "designed", "implemented", "led", "improved", "reduced", "increased", "deployed", "measured")
    tradeoff_terms = (
        "trade-off", "tradeoff", "latency", "scale", "security", "testing", "failure",
        "risk", "constraint", "monitoring", "rollback", "index", "indexing",
        "pagination", "memo", "memoizing", "cache", "caching", "api", "endpoint",
        "query", "sql", "performance", "load time", "optimize", "optimization"
    )
    word_count = len(answer.split())

    practical_role_signal = any(answer_tokens & group and question_tokens & group for group in ROLE_SYNONYM_GROUPS)
    role_alignment = min(35, round(35 * max(role_alignment_ratio, question_alignment_ratio * 0.75)))
    if practical_role_signal and word_count >= 20:
        role_alignment = max(role_alignment, 22)
    technical_depth = min(25, 9 + sum(2 for term in tradeoff_terms if term in answer.lower()) + (4 if word_count >= 55 else 0))
    evidence_specificity = min(20, 4 + sum(2 for term in evidence_terms if term in answer.lower()) + min(6, len(metric_terms) * 3))
    position_impact = min(10, round(10 * max(role_alignment_ratio, question_alignment_ratio * 0.7)) + (2 if any(term in answer.lower() for term in ("impact", "result", "outcome", "business", "user", "reduced", "increased", "improved")) else 0))
    communication = min(10, 4 + (2 if word_count >= 35 else 0) + (2 if any(mark in answer for mark in (".", ";", ":")) else 0) + (2 if word_count <= 220 else 0))

    return {
        "role_requirement_alignment": role_alignment,
        "technical_correctness_depth": technical_depth,
        "evidence_specificity": evidence_specificity,
        "position_impact": min(10, position_impact),
        "communication_clarity": communication
    }

def _collect_role_terms(job_requirements: Dict[str, Any]) -> List[str]:
    signals = _build_role_signal_groups(job_requirements or {})
    terms = [
        *(signals.get("must_have") or []),
        *(signals.get("domain") or []),
        *(signals.get("success") or []),
        job_requirements.get("title", ""),
        job_requirements.get("department", "")
    ]
    return [term for term in terms if term][:18]

def build_position_specific_evaluation(questions: List[str], answers: List[str], job_requirements: Dict[str, Any]) -> Dict[str, Any]:
    role_terms = _collect_role_terms(job_requirements)
    title = job_requirements.get("title", "the current position") if job_requirements else "the current position"
    aggregate = {
        "role_requirement_alignment": 0,
        "technical_correctness_depth": 0,
        "evidence_specificity": 0,
        "position_impact": 0,
        "communication_clarity": 0
    }
    critiques = []
    for idx, (q, a) in enumerate(zip(questions, answers)):
        dimension_scores = _answer_dimension_scores(a, q, role_terms)
        per_answer_score = sum(dimension_scores.values())
        for key, value in dimension_scores.items():
            aggregate[key] += value

        word_count = len(a.split())
        matched_terms = [
            term for term in role_terms
            if _soft_term_match(term, set(_tokenize(a)), " ".join(_tokenize(a)), set(_tokenize(q)))
        ][:4]
        missing_terms = [
            term for term in role_terms
            if term not in matched_terms
        ][:4]
        requirement_focus = matched_terms[0] if matched_terms else (role_terms[0] if role_terms else title)
        if _invalid_answer_reason(a, q, role_terms):
            critiques.append({
                "question": q,
                "candidate_answer_excerpt": _answer_excerpt(a),
                "candidate_answer": a,
                "per_answer_score": 0,
                "requirement_focus": requirement_focus,
                "critique": (
                    f"The answer scored 0/100 for {title}. The candidate's full answer was: \"{_answer_excerpt(a)}\". "
                    "This is a non-answer and does not provide evidence of role requirement alignment, technical depth, project experience, impact, or communication of a solution. "
                    "It should not be treated as partial credit simply because it is clear or honest. "
                    "For a hiring manager, this answer is a verification risk and should be followed up only if the rest of the application provides strong evidence."
                ),
                "strengths": [],
                "weaknesses": [
                    "No role-relevant evidence was provided.",
                    "No technical reasoning, project example, trade-off, metric, or outcome was supplied."
                ],
                "suggested_improvement": (
                    f"Replace this with a concrete example related to {requirement_focus}: explain the situation, your action, the trade-offs, and the result."
                ),
                "hiring_manager_note": (
                    "Treat this answer as zero evidence for the prompt. If the candidate continues, ask a direct follow-up for a specific project and do not infer capability from this response."
                ),
                "decision_reason": (
                    f"The answer is a non-answer for {title}; it supplies no evidence for {requirement_focus}, role depth, impact, or communication of a solution."
                )
            })
            continue

        critiques.append({
            "question": q,
            "candidate_answer_excerpt": _answer_excerpt(a),
            "candidate_answer": a,
            "per_answer_score": per_answer_score,
            "requirement_focus": requirement_focus,
            "critique": (
                f"The answer scored {per_answer_score}/100 for {title}. "
                    f"As an HR interviewer, my opinion is that it {'provides useful role evidence around ' + ', '.join(matched_terms[:2]) if matched_terms else 'does not yet provide enough direct evidence for the current position requirements'}. "
                f"The candidate's full answer was reviewed against the actual prompt: \"{_answer_excerpt(a)}\". "
                f"The strongest part of the response is its connection to {', '.join(matched_terms[:2]) if matched_terms else 'the question at a basic level'}, while the main concern is {', '.join(missing_terms[:2]) if missing_terms else 'whether the example transfers cleanly to the role context'}. "
                f"For a hiring manager, this should be treated as {'supporting evidence' if per_answer_score >= 70 else 'a verification risk'} rather than a final decision by itself."
            ),
            "strengths": [
                f"Mentions role-relevant evidence: {', '.join(matched_terms[:3])}." if matched_terms else "Addresses the question at a basic level.",
                "Includes concrete implementation or impact detail." if dimension_scores["evidence_specificity"] >= 12 else "Provides enough context to understand the answer direction."
            ],
            "weaknesses": [
                f"Needs stronger evidence for current-position requirements: {', '.join(missing_terms[:3])}." if missing_terms else "Could connect the example more explicitly to the role's success criteria.",
                "Lacks specific metrics or measurable outcomes." if not re.search(r"\d", a) else "Could explain trade-offs and failure handling in more depth."
            ],
            "suggested_improvement": (
                f"Revise this answer by naming one project that used {requirement_focus}, then explain your decision, trade-offs, and measurable impact for the {title} role."
            ),
            "hiring_manager_note": (
                f"Use this answer to probe for concrete evidence of {requirement_focus}. "
                f"Ask the candidate to walk through one implementation choice, one constraint, and one measurable result so you can separate confidence from demonstrated fit."
            ),
            "decision_reason": (
                f"The answer scored {per_answer_score}/100 because it matched {len(matched_terms)} role signals, "
                f"left gaps around {', '.join(missing_terms[:2]) if missing_terms else 'role transfer evidence'}, "
                f"and earned breakdown scores {dimension_scores}."
            )
        })

    answer_count = max(1, len(critiques))
    score_breakdown = {key: round(value / answer_count) for key, value in aggregate.items()}
    score = max(0, min(100, sum(score_breakdown.values())))
    if score >= 80:
        verdict = "Strong fit for the current position"
        recommendation = "advance"
    elif score >= 62:
        verdict = "Moderate fit for the current position"
        recommendation = "hold"
    else:
        verdict = "Weak fit for the current position"
        recommendation = "reject"
    decision_reason = (
        f"Recommendation is {recommendation} because the screening score is {score}/100. "
        f"The largest rubric signals were role alignment {score_breakdown['role_requirement_alignment']}/35, "
        f"depth {score_breakdown['technical_correctness_depth']}/25, and evidence {score_breakdown['evidence_specificity']}/20."
    )

    return {
        "screening_score": score,
        "position_fit_verdict": verdict,
        "hiring_recommendation": recommendation,
        "decision_reason": decision_reason,
        "role_alignment_summary": (
            f"The score is based on how directly the answers prove readiness for {title}. "
            f"Role alignment contributed {score_breakdown['role_requirement_alignment']}/35 and evidence specificity contributed {score_breakdown['evidence_specificity']}/20. "
            f"My evaluator opinion is that the candidate should be judged by the depth of the examples, not by general confidence or length. "
            f"Where the answers name role-relevant methods or outcomes, they create useful evidence for the hiring manager. "
            f"Where the answers stay broad, the next interview should request implementation detail, constraints, trade-offs, and measurable impact before making a final decision."
        ),
        "score_breakdown": score_breakdown,
        "critiques": critiques,
        "question_feedback": critiques,
    }

def _coerce_score(value: Any, fallback: int = 0) -> int:
    try:
        return max(0, min(100, int(round(float(value)))))
    except (TypeError, ValueError):
        return fallback

def _align_score_mentions(critique_text: str, score: int) -> str:
    if not critique_text:
        return critique_text
    patterns = [
        r"(answer\s+scored\s+)(\d+(?:\.\d+)?)(/100)",
        r"(score\s+is\s+)(\d+(?:\.\d+)?)(/100)",
        r"(scored\s+)(\d+(?:\.\d+)?)(\s*out\s+of\s+100)",
    ]
    aligned = critique_text
    for pattern in patterns:
        aligned = re.sub(pattern, rf"\g<1>{score}\g<3>", aligned, flags=re.IGNORECASE)
    return aligned

def normalize_interview_evaluation(parsed: Dict[str, Any], questions: List[str], answers: List[str], job_requirements: Dict[str, Any]) -> Dict[str, Any]:
    fallback = build_position_specific_evaluation(questions, answers, job_requirements)
    if not isinstance(parsed, dict):
        return fallback

    fallback_critiques = fallback.get("critiques", [])
    parsed_items = parsed.get("question_feedback") if isinstance(parsed.get("question_feedback"), list) else parsed.get("critiques")
    parsed_critiques = parsed_items if isinstance(parsed_items, list) else []
    normalized_critiques = []
    seen_critique_texts: set[str] = set()

    for idx, question in enumerate(questions):
        answer = answers[idx] if idx < len(answers) else ""
        item = parsed_critiques[idx] if idx < len(parsed_critiques) and isinstance(parsed_critiques[idx], dict) else {}
        fallback_item = fallback_critiques[idx] if idx < len(fallback_critiques) else {}
        full_answer = _answer_excerpt(answer)
        excerpt = full_answer
        critique_text = item.get("critique") or fallback_item.get("critique", "")
        score_source = item
        normalized_text_key = re.sub(r"\s+", " ", critique_text.strip().lower())
        looks_generic = (
            not critique_text
            or normalized_text_key in seen_critique_texts
            or "answer was received and appears usable" in normalized_text_key
            or (excerpt and excerpt[:40].lower() not in normalized_text_key)
        )
        if looks_generic:
            critique_text = fallback_item.get("critique", critique_text)
            score_source = fallback_item
            normalized_text_key = re.sub(r"\s+", " ", critique_text.strip().lower())
        per_answer_score = _coerce_score(
            score_source.get("per_answer_score"),
            _coerce_score(fallback_item.get("per_answer_score"), 0)
        )
        if _invalid_answer_reason(answer, question, _collect_role_terms(job_requirements)):
            per_answer_score = 0
            critique_text = fallback_item.get("critique", critique_text)
        critique_text = _align_score_mentions(critique_text, per_answer_score)
        if excerpt and excerpt[:40].lower() not in normalized_text_key:
            critique_text = f"{critique_text} Candidate evidence reviewed: \"{excerpt}\"".strip()
            normalized_text_key = re.sub(r"\s+", " ", critique_text.strip().lower())
        seen_critique_texts.add(normalized_text_key)

        normalized_critiques.append({
            "question": item.get("question") or question,
            "candidate_answer_excerpt": excerpt,
            "candidate_answer": full_answer or answer,
            "per_answer_score": per_answer_score,
            "requirement_focus": item.get("requirement_focus") or fallback_item.get("requirement_focus", ""),
            "critique": critique_text,
            "strengths": item.get("strengths") if isinstance(item.get("strengths"), list) and item.get("strengths") else fallback_item.get("strengths", []),
            "weaknesses": item.get("weaknesses") if isinstance(item.get("weaknesses"), list) and item.get("weaknesses") else fallback_item.get("weaknesses", []),
            "suggested_improvement": item.get("suggested_improvement") or fallback_item.get("suggested_improvement", ""),
            "hiring_manager_note": item.get("hiring_manager_note") or fallback_item.get("hiring_manager_note", ""),
            "decision_reason": item.get("decision_reason") or fallback_item.get("decision_reason", "")
        })

    score_breakdown = fallback.get("score_breakdown", {})
    if normalized_critiques:
        score = round(sum(_coerce_score(item.get("per_answer_score"), 0) for item in normalized_critiques) / len(normalized_critiques))
    else:
        score = fallback.get("screening_score", 0)

    return {
        "screening_score": score,
        "position_fit_verdict": parsed.get("position_fit_verdict") or fallback.get("position_fit_verdict", ""),
        "hiring_recommendation": parsed.get("hiring_recommendation") or fallback.get("hiring_recommendation", ""),
        "decision_reason": parsed.get("decision_reason") or fallback.get("decision_reason", ""),
        "role_alignment_summary": parsed.get("role_alignment_summary") or fallback.get("role_alignment_summary", ""),
        "score_breakdown": score_breakdown,
        "critiques": normalized_critiques,
        "question_feedback": normalized_critiques,
    }
