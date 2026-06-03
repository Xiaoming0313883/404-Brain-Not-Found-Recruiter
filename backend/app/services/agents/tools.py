from __future__ import annotations

from datetime import datetime
from typing import Any, Callable, Dict, List

from app.database import load_db, record_agent_action, record_agent_event, record_email_event, save_db
from app.services.agents.bias_agent import analyze_prestige_indicators
from app.services.agents.interview_agent import run_interview_agent_phase_a, run_interview_agent_phase_b
from app.services.agents.matching_agent import run_matching_agent
from app.services.agents.report_agent import run_report_agent
from app.services.agents.requirement_agent import run_requirement_agent, run_requirement_intake_agent
from app.services.agents.resume_agent import parse_resume_text_fallback, run_resume_agent
from app.services.bias_settings import get_bias_controls
from app.services.mailer import send_recruitment_email

from .guardrails import ensure_autonomous_email_label, validate_action_policy


ToolFn = Callable[..., Dict[str, Any] | List[Any] | str | bool]


def get_application_progress(status: str) -> int:
    return {
        "profile": 10,
        "staged": 20,
        "invited": 30,
        "applied": 40,
        "screening": 70,
        "interview_scheduled": 85,
        "completed": 100,
        "hired": 100,
        "rejected": 100,
        "inactive": 0,
    }.get(status, 10)


def build_application_id(position_id: int) -> str:
    return f"position-{position_id}"


def _find_application(candidate: Dict[str, Any], position_id: int | None) -> Dict[str, Any] | None:
    for application in candidate.setdefault("applications", []):
        if not position_id or application.get("position_id") == position_id:
            return application
    return None


def parse_resume_tool(resume_text: str, prestige_neutralize: bool = False, use_llm: bool = True) -> Dict[str, Any]:
    if not use_llm:
        return parse_resume_text_fallback(resume_text)
    return run_resume_agent(resume_text, prestige_neutralize=prestige_neutralize)


def build_requirements_tool(
    job_title: str,
    department: str = "",
    job_description: str = "",
    chat_messages: List[Dict[str, str]] | None = None,
) -> Dict[str, Any]:
    if chat_messages is not None:
        return run_requirement_intake_agent(job_title, department, chat_messages)
    return run_requirement_agent(job_title, job_description)


def analyze_bias_tool(candidate_profile: Dict[str, Any], resume_text: str = "", use_llm: bool = True) -> Dict[str, Any]:
    return analyze_prestige_indicators(candidate_profile, resume_text, use_llm=use_llm)


def match_candidate_tool(
    job_requirements: Dict[str, Any],
    candidate_profile: Dict[str, Any],
    prestige_analysis: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    controls = get_bias_controls({"settings": {}})
    return run_matching_agent(job_requirements, candidate_profile, controls, prestige_analysis)


def generate_screening_questions_tool(
    candidate_profile: Dict[str, Any],
    match_results: Dict[str, Any],
    job_requirements: Dict[str, Any],
) -> List[str]:
    return run_interview_agent_phase_a(candidate_profile, match_results, job_requirements)


def evaluate_screening_answers_tool(
    questions: List[str],
    answers: List[str],
    job_requirements: Dict[str, Any],
) -> Dict[str, Any]:
    return run_interview_agent_phase_b(questions, answers, job_requirements)


def generate_report_tool(
    candidate_profile: Dict[str, Any],
    match_results: Dict[str, Any],
    job_requirements: Dict[str, Any],
) -> Dict[str, Any]:
    return run_report_agent(candidate_profile, match_results, job_requirements)


def upsert_candidate_profile(payload: Dict[str, Any], state: Dict[str, Any] | None = None) -> Dict[str, Any]:
    policy = validate_action_policy("upsert_candidate_profile", payload, state)
    record_agent_action({**payload, "tool_name": "upsert_candidate_profile", **policy})
    if not policy["approved"]:
        return {"ok": False, "policy": policy}

    db = load_db()
    email = str(payload.get("email") or payload.get("candidate_email") or "").strip().lower()
    if not email:
        return {"ok": False, "error": "Candidate email is required."}
    candidate = db.setdefault("candidates", {}).setdefault(email, {})
    candidate.update({
        "email": email,
        "name": payload.get("name") or candidate.get("name", ""),
        "profile_data": payload.get("profile_data") or candidate.get("profile_data", {}),
        "resume_text": payload.get("resume_text") or candidate.get("resume_text", ""),
        "status": payload.get("status") or candidate.get("status", "profile"),
        "source_type": payload.get("source_type") or candidate.get("source_type", "resume"),
        "source_method": payload.get("source_method") or candidate.get("source_method", "agent_graph"),
    })
    save_db(db)
    return {"ok": True, "candidate_email": email, "status": candidate.get("status")}


def create_or_update_application(payload: Dict[str, Any], state: Dict[str, Any] | None = None) -> Dict[str, Any]:
    policy = validate_action_policy("create_or_update_application", payload, state)
    record_agent_action({**payload, "tool_name": "create_or_update_application", **policy})
    if not policy["approved"]:
        return {"ok": False, "policy": policy}

    db = load_db()
    email = str(payload.get("candidate_email") or "").strip().lower()
    position_id = int(payload.get("position_id") or 0)
    if not email or not position_id:
        return {"ok": False, "error": "candidate_email and position_id are required."}
    candidate = db.setdefault("candidates", {}).setdefault(email, {"email": email, "name": email})
    application = _find_application(candidate, position_id)
    if not application:
        application = {
            "application_id": build_application_id(position_id),
            "position_id": position_id,
            "applied_at": datetime.now().isoformat(timespec="seconds"),
            "answers": [],
            "evaluation": {},
        }
        candidate.setdefault("applications", []).append(application)
    application.update({
        "status": payload.get("status") or application.get("status", "applied"),
        "progress": get_application_progress(payload.get("status") or application.get("status", "applied")),
        "match_results": payload.get("match_results") or application.get("match_results", {}),
        "custom_questions": payload.get("custom_questions") or application.get("custom_questions", []),
        "sourcing_pitch": payload.get("sourcing_pitch") or application.get("sourcing_pitch", ""),
        "outreach_email": payload.get("outreach_email") or application.get("outreach_email", ""),
    })
    candidate["status"] = application["status"]
    candidate["position_id"] = position_id
    candidate["match_results"] = application.get("match_results", {})
    candidate["custom_questions"] = application.get("custom_questions", [])
    save_db(db)
    return {"ok": True, "candidate_email": email, "position_id": position_id, "status": application["status"]}


def update_application_status(payload: Dict[str, Any], state: Dict[str, Any] | None = None) -> Dict[str, Any]:
    policy = validate_action_policy("update_application_status", payload, state)
    record_agent_action({**payload, "tool_name": "update_application_status", **policy})
    if not policy["approved"]:
        return {"ok": False, "policy": policy}

    db = load_db()
    email = str(payload.get("candidate_email") or "").strip().lower()
    position_id = int(payload.get("position_id") or 0)
    status = str(payload.get("status") or "").strip()
    candidate = db.setdefault("candidates", {}).get(email)
    if not candidate:
        return {"ok": False, "error": "Candidate not found."}
    application = _find_application(candidate, position_id)
    target = application or candidate
    previous_status = target.get("status")
    if previous_status and previous_status != status:
        target.setdefault("status_history", []).append(previous_status)
        target["status_history"] = target["status_history"][-10:]
    target["status"] = status
    target["progress"] = get_application_progress(status)
    if application:
        candidate["status"] = status
        candidate["position_id"] = position_id
    save_db(db)
    return {"ok": True, "candidate_email": email, "position_id": position_id, "status": status, "policy": policy}


def save_screening_evaluation(payload: Dict[str, Any], state: Dict[str, Any] | None = None) -> Dict[str, Any]:
    policy = validate_action_policy("save_screening_evaluation", payload, state)
    record_agent_action({**payload, "tool_name": "save_screening_evaluation", **policy})
    if not policy["approved"]:
        return {"ok": False, "policy": policy}

    db = load_db()
    email = str(payload.get("candidate_email") or "").strip().lower()
    position_id = int(payload.get("position_id") or 0)
    candidate = db.setdefault("candidates", {}).get(email)
    if not candidate:
        return {"ok": False, "error": "Candidate not found."}
    application = _find_application(candidate, position_id)
    if not application:
        return {"ok": False, "error": "Application not found."}
    application["answers"] = payload.get("answers") or application.get("answers", [])
    application["evaluation"] = payload.get("evaluation") or {}
    application["status"] = "screening"
    application["progress"] = get_application_progress("screening")
    candidate["evaluation"] = application["evaluation"]
    candidate["answers"] = application["answers"]
    candidate["status"] = "screening"
    save_db(db)
    return {"ok": True, "candidate_email": email, "position_id": position_id, "status": "screening"}


def send_agent_email(payload: Dict[str, Any], state: Dict[str, Any] | None = None) -> Dict[str, Any]:
    body = ensure_autonomous_email_label(payload.get("body") or payload.get("message") or "")
    normalized = {**payload, "body": body}
    policy = validate_action_policy("send_agent_email", normalized, state)
    record_agent_action({**normalized, "tool_name": "send_agent_email", **policy})
    if not policy["approved"]:
        record_email_event({**normalized, "sent": False, "autonomous": True, "policy": policy})
        return {"ok": False, "policy": policy}

    sent = send_recruitment_email(
        to_email=normalized["to_email"],
        subject=normalized.get("subject") or "Application update",
        body=body,
        smtp_settings=normalized.get("smtp_settings"),
    )
    record_email_event({**normalized, "sent": sent, "autonomous": True, "policy": policy})
    return {"ok": bool(sent), "sent": bool(sent), "policy": policy, "body": body}


def stage_sourced_candidate(payload: Dict[str, Any], state: Dict[str, Any] | None = None) -> Dict[str, Any]:
    policy = validate_action_policy("stage_sourced_candidate", payload, state)
    record_agent_action({**payload, "tool_name": "stage_sourced_candidate", **policy})
    if not policy["approved"]:
        return {"ok": False, "policy": policy}
    candidate_payload = {**payload, "status": "staged", "source_type": "linkedin"}
    upsert_result = upsert_candidate_profile(candidate_payload, state)
    if not upsert_result.get("ok"):
        return upsert_result
    app_result = create_or_update_application({
        "candidate_email": candidate_payload.get("candidate_email") or candidate_payload.get("email"),
        "position_id": candidate_payload.get("position_id"),
        "status": "staged",
        "match_results": candidate_payload.get("match_results"),
        "custom_questions": candidate_payload.get("custom_questions"),
        "sourcing_pitch": candidate_payload.get("sourcing_pitch"),
        "outreach_email": candidate_payload.get("outreach_email"),
    }, state)
    return {"ok": bool(app_result.get("ok")), "candidate": upsert_result, "application": app_result}


def record_agent_event_tool(payload: Dict[str, Any], state: Dict[str, Any] | None = None) -> Dict[str, Any]:
    policy = validate_action_policy("record_agent_event", payload, state)
    if not policy["approved"]:
        return {"ok": False, "policy": policy}
    row = record_agent_event(payload)
    return {"ok": True, "event": row}


TOOL_REGISTRY: Dict[str, ToolFn] = {
    "parse_resume": parse_resume_tool,
    "build_requirements": build_requirements_tool,
    "analyze_bias": analyze_bias_tool,
    "match_candidate": match_candidate_tool,
    "generate_screening_questions": generate_screening_questions_tool,
    "evaluate_screening_answers": evaluate_screening_answers_tool,
    "generate_report": generate_report_tool,
    "upsert_candidate_profile": upsert_candidate_profile,
    "create_or_update_application": create_or_update_application,
    "update_application_status": update_application_status,
    "save_screening_evaluation": save_screening_evaluation,
    "send_agent_email": send_agent_email,
    "stage_sourced_candidate": stage_sourced_candidate,
    "record_agent_event": record_agent_event_tool,
}

ACTION_TOOL_NAMES = {
    "upsert_candidate_profile",
    "create_or_update_application",
    "update_application_status",
    "save_screening_evaluation",
    "send_agent_email",
    "stage_sourced_candidate",
    "record_agent_event",
}


def call_tool(name: str, arguments: Dict[str, Any], state: Dict[str, Any] | None = None) -> Any:
    if name not in TOOL_REGISTRY:
        raise ValueError(f"Unknown agent tool: {name}")
    fn = TOOL_REGISTRY[name]
    if name in ACTION_TOOL_NAMES:
        return fn(arguments, state)  # type: ignore[misc]
    return fn(**arguments)  # type: ignore[misc]
