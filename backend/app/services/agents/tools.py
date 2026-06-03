from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Callable, Dict, List

from app.config import settings
from app.database import (
    load_db,
    record_agent_action,
    record_agent_checkpoint,
    record_agent_event,
    record_email_draft,
    record_email_event,
    save_db,
)
from app.services.agents.bias_agent import analyze_prestige_indicators, fetch_university_ranking
from app.services.agents.base_agent import get_openai_client, parse_llm_json, sanitize_provider_error
from app.services.agents.interview_agent import run_interview_agent_phase_a, run_interview_agent_phase_b
from app.services.agents.matching_agent import run_matching_agent
from app.services.agents.report_agent import run_report_agent
from app.services.agents.requirement_agent import run_requirement_agent, run_requirement_intake_agent
from app.services.agents.resume_agent import ensure_resume_profile_schema, parse_resume_text_fallback, run_resume_agent
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
        return ensure_resume_profile_schema(parse_resume_text_fallback(resume_text))
    return ensure_resume_profile_schema(run_resume_agent(resume_text, prestige_neutralize=prestige_neutralize))


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


def fetch_university_ranking_tool(institution_name: str) -> Dict[str, Any]:
    return fetch_university_ranking(institution_name)


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


def plan_candidate_email(payload: Dict[str, Any], state: Dict[str, Any] | None = None) -> Dict[str, Any]:
    state = state or {}
    policy = validate_action_policy("plan_candidate_email", payload, state)
    record_agent_action({**payload, "tool_name": "plan_candidate_email", **policy})
    if not policy["approved"]:
        return {"ok": False, "should_send": False, "policy": policy}

    fallback = build_candidate_email_fallback(payload, state)
    client = get_openai_client()
    if client:
        try:
            response = client.chat.completions.create(
                model=settings.AGENT_SUPERVISOR_MODEL or settings.OPENAI_MODEL,
                temperature=0.2,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are the candidate communication planner for a bounded recruiting AI agent. "
                            "Decide whether the agent should send a candidate-facing email at this stage. "
                            "Write a concise, professional subject and body only when a send is appropriate. "
                            "Never email third parties, expose private candidate data, mention protected classes, "
                            "or promise an interview date/time unless HR supplied one. Return JSON only."
                        ),
                    },
                    {
                        "role": "user",
                        "content": json.dumps({
                            "state": {
                                "task_type": state.get("task_type"),
                                "candidate_email": state.get("candidate_email"),
                                "position_id": state.get("position_id"),
                                "overall_position_fit": state.get("overall_position_fit"),
                                "screening_score": state.get("screening_score"),
                                "hiring_recommendation": state.get("hiring_recommendation"),
                            },
                            "payload": payload,
                            "required_json_shape": {
                                "should_send": True,
                                "email_type": "invite | reject | status_update | none",
                                "level": "informational | action_required | decision",
                                "subject": "candidate-facing subject",
                                "body": "candidate-facing plain text body",
                                "action_type": "invite | reject | status_update",
                                "reason": "short explanation of the send/no-send decision",
                            },
                            "fallback_if_uncertain": fallback,
                        }, default=str),
                    },
                ],
            )
            parsed = parse_llm_json(response.choices[0].message.content or "{}")
            return normalize_email_plan(parsed, fallback, policy)
        except Exception as exc:
            warning = sanitize_provider_error(exc, "Email planner LLM fell back to deterministic plan.")
            plan = {**fallback, "planner_warning": warning, "policy": policy, "reason": fallback.get("reason") or warning}
            _record_email_plan_side_effects(plan, state)
            return plan

    plan = {**fallback, "policy": policy}
    _record_email_plan_side_effects(plan, state)
    return plan


def _record_email_plan_side_effects(plan: Dict[str, Any], state: Dict[str, Any]) -> None:
    if not (plan.get("subject") or plan.get("body")):
        return
    try:
        record_email_draft({**plan, "status": "policy_approved" if plan.get("should_send") else "draft"})
    except Exception:
        pass
    if settings.AGENT_EMAIL_REVIEW_MODE not in {"auto", "off"} and not plan.get("should_send"):
        try:
            record_agent_checkpoint({
                "thread_id": f"{state.get('task_type', 'email')}:{plan.get('candidate_email') or state.get('candidate_email')}:{plan.get('position_id') or state.get('position_id')}",
                "candidate_email": plan.get("candidate_email") or state.get("candidate_email"),
                "position_id": plan.get("position_id") or state.get("position_id"),
                "task_type": state.get("task_type", ""),
                "status": "paused_for_email_review",
                "state": state,
                "email_plan": plan,
            })
        except Exception:
            pass


def build_candidate_email_fallback(payload: Dict[str, Any], state: Dict[str, Any]) -> Dict[str, Any]:
    job = payload.get("job_requirements") or {}
    title = job.get("title") or "the selected position"
    candidate_email = str(payload.get("candidate_email") or state.get("candidate_email") or "").strip().lower()
    fit_score = int(payload.get("overall_position_fit") or state.get("overall_position_fit") or 0)
    screening_score = int(payload.get("screening_score") or state.get("screening_score") or 0)
    recommendation = str(payload.get("hiring_recommendation") or state.get("hiring_recommendation") or "").lower()
    task_type = state.get("task_type")
    hr_feedback = str(payload.get("hr_feedback") or "").strip()

    if task_type == "hr_feedback_update" and hr_feedback:
        body = (
            f"Hello,\n\n"
            f"The hiring team has added feedback for your application to {title}.\n\n"
            f"Feedback from the hiring team:\n{hr_feedback}\n\n"
            "You can also review this update in your candidate portal."
        )
        return {
            "ok": True,
            "should_send": True,
            "candidate_email": candidate_email,
            "to_email": candidate_email,
            "email_type": "status_update",
            "level": "informational",
            "subject": f"Hiring team feedback for {title}",
            "body": body,
            "action_type": "status_update",
            "hr_feedback": hr_feedback,
            "reason": "HR updated candidate-visible feedback, so the candidate should be notified by email.",
        }

    if task_type == "sourced_candidate" and fit_score >= settings.AGENT_INVITE_MIN_FIT_SCORE:
        body = (
            f"Hello,\n\nThe APU Recruiting AI Agent reviewed your public profile against {title} and found a strong initial fit "
            f"with a position-fit score of {fit_score}. You are invited to continue in the candidate portal and complete the screening questions.\n\n"
            "Please review the role details and submit your responses when you are ready."
        )
        return {
            "ok": True,
            "should_send": True,
            "candidate_email": candidate_email,
            "to_email": candidate_email,
            "email_type": "invite",
            "level": "action_required",
            "subject": f"Invitation to continue for {title}",
            "body": body,
            "action_type": "invite",
            "overall_position_fit": fit_score,
            "reason": f"Fit score met the autonomous invitation threshold of {settings.AGENT_INVITE_MIN_FIT_SCORE}.",
        }

    if task_type == "sandbox_evaluation" and screening_score <= settings.AGENT_REJECT_MAX_SCREENING_SCORE and recommendation == "reject":
        body = (
            f"Hello,\n\nThank you for completing the screening for {title}. After reviewing the submitted answers against the role requirements, "
            "the current screening result does not meet the threshold to continue for this position.\n\n"
            "We appreciate the time you invested and encourage you to apply for roles that better match your current strengths."
        )
        return {
            "ok": True,
            "should_send": True,
            "candidate_email": candidate_email,
            "to_email": candidate_email,
            "email_type": "reject",
            "level": "decision",
            "subject": f"Application update for {title}",
            "body": body,
            "action_type": "reject",
            "screening_score": screening_score,
            "hiring_recommendation": recommendation,
            "reason": f"Screening score and recommendation met the bounded rejection policy.",
        }

    return {
        "ok": True,
        "should_send": False,
        "candidate_email": candidate_email,
        "to_email": candidate_email,
        "email_type": "none",
        "level": "informational",
        "subject": "",
        "body": "",
        "action_type": "status_update",
        "reason": "No autonomous candidate email is required at this stage.",
    }


def normalize_email_plan(parsed: Dict[str, Any], fallback: Dict[str, Any], policy: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(parsed, dict):
        return {**fallback, "policy": policy}
    should_send = bool(parsed.get("should_send", fallback.get("should_send", False)))
    subject = str(parsed.get("subject") or fallback.get("subject") or "").strip()[:160]
    body = str(parsed.get("body") or fallback.get("body") or "").strip()
    if should_send and (not subject or not body):
        subject = str(fallback.get("subject") or "Application update")
        body = str(fallback.get("body") or "Please check your candidate portal for the latest application update.")
    plan = {
        **fallback,
        "ok": True,
        "should_send": should_send,
        "email_type": str(parsed.get("email_type") or fallback.get("email_type") or "status_update"),
        "level": str(parsed.get("level") or fallback.get("level") or "informational"),
        "subject": subject,
        "body": body,
        "html_body": str(parsed.get("html_body") or "").strip(),
        "action_type": str(parsed.get("action_type") or fallback.get("action_type") or "status_update"),
        "reason": str(parsed.get("reason") or fallback.get("reason") or ""),
        "policy": policy,
    }
    if subject or body:
        _record_email_plan_side_effects(plan, {})
    return plan


def send_agent_email(payload: Dict[str, Any], state: Dict[str, Any] | None = None) -> Dict[str, Any]:
    body = ensure_autonomous_email_label(payload.get("body") or payload.get("message") or "")
    html_body = str(payload.get("html_body") or "").strip()
    if html_body and "System Note: This email was drafted" not in html_body:
        html_body = f"{html_body}<p><strong>{ensure_autonomous_email_label('').strip()}</strong></p>"
    normalized = {**payload, "body": body, "html_body": html_body}
    policy = validate_action_policy("send_agent_email", normalized, state)
    record_agent_action({**normalized, "tool_name": "send_agent_email", **policy})
    if not policy["approved"]:
        record_email_event({**normalized, "sent": False, "autonomous": True, "policy": policy})
        return {"ok": False, "policy": policy}

    receipt = send_recruitment_email(
        to_email=normalized["to_email"],
        subject=normalized.get("subject") or "Application update",
        body=body,
        html_body=html_body or None,
        smtp_settings=normalized.get("smtp_settings"),
    )
    if isinstance(receipt, dict):
        sent = bool(receipt.get("sent"))
        email_receipt = receipt
    else:
        sent = bool(receipt)
        email_receipt = {
            "sent": sent,
            "smtp_configured": sent,
            "reason": "SMTP delivery accepted by provider." if sent else "SMTP delivery was not confirmed.",
            "error_type": "",
            "provider_message": "",
        }
    record_email_event({**normalized, **email_receipt, "autonomous": True, "policy": policy})
    return {"ok": sent, "sent": sent, "policy": policy, "body": body, "receipt": email_receipt, **email_receipt}


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
    "fetch_university_ranking": fetch_university_ranking_tool,
    "match_candidate": match_candidate_tool,
    "generate_screening_questions": generate_screening_questions_tool,
    "evaluate_screening_answers": evaluate_screening_answers_tool,
    "generate_report": generate_report_tool,
    "upsert_candidate_profile": upsert_candidate_profile,
    "create_or_update_application": create_or_update_application,
    "update_application_status": update_application_status,
    "save_screening_evaluation": save_screening_evaluation,
    "plan_candidate_email": plan_candidate_email,
    "send_agent_email": send_agent_email,
    "stage_sourced_candidate": stage_sourced_candidate,
    "record_agent_event": record_agent_event_tool,
}

ACTION_TOOL_NAMES = {
    "upsert_candidate_profile",
    "create_or_update_application",
    "update_application_status",
    "save_screening_evaluation",
    "plan_candidate_email",
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
