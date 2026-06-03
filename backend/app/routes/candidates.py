import hashlib
import hmac
import io
import json
import os
import re
import shutil
import uuid
import base64
import secrets
from datetime import datetime, timedelta
from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Query
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, EmailStr
from typing import List, Optional, Dict, Any
from pypdf import PdfReader

from ..database import load_db, record_agent_event, save_db
from ..config import settings
from ..services.agents.base_agent import get_openai_client
from ..services.job_windows import is_open_for_applications
from ..services.linkedin_profiles import build_fast_match_results, build_fast_outreach, scrape_live_linkedin_profile, parse_apify_profile, _get_run_field
from ..services.bias_settings import get_bias_controls
from ..services.agents.bias_agent import (
    analyze_prestige_indicators,
    neutralize_candidate_profile,
    neutralize_text as agent_neutralize_text,
    apply_bias_controls_to_assessment,
    lookup_qs_rank_from_csv,
)
from ..services.agents import (
    run_resume_agent,
    run_matching_agent,
    run_interview_agent_phase_a,
    run_interview_agent_phase_b,
    build_position_specific_evaluation,
    run_report_agent
)
from ..services.agents.graph import recruiting_agent_graph, run_agent_graph
from ..services.agents.resume_agent import parse_resume_text_fallback
from ..services.mailer import is_smtp_configured, send_candidate_verification_email, send_recruitment_email

router = APIRouter(prefix="/candidates", tags=["Candidates"])
MAX_RESUME_BYTES = 10 * 1024 * 1024
VERIFICATION_COOLDOWN_SECONDS = 60
UPLOAD_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "uploads"))
RESUME_DIR = os.path.join(UPLOAD_ROOT, "resumes")
PROFILE_IMAGE_DIR = os.path.join(UPLOAD_ROOT, "profile_pictures")
PROFILE_REQUIRED_FIELDS = {
    "name": "Full name",
    "age": "Age",
    "phone": "Phone number",
    "address": "Address",
    "came_from": "Came from",
    "work_experience": "Work experience",
    "qualification": "Qualification",
    "grade_results": "Grade and results",
}

# Schema models
class SandboxAnswers(BaseModel):
    answers: List[str]
    position_id: Optional[int] = None

class DraftAnswersPayload(BaseModel):
    answers: List[str]
    position_id: Optional[int] = None

class CandidateStatusPayload(BaseModel):
    status: str
    position_id: Optional[int] = None

class CandidatePasswordPayload(BaseModel):
    password: str

class CandidateLoginPayload(BaseModel):
    email: str
    password: str

class CandidateEmailPayload(BaseModel):
    email: str

class CandidatePendingEmailVerificationPayload(BaseModel):
    email: str
    code: str

class CandidateEmailVerificationPayload(BaseModel):
    code: str

class CandidateAccountUpdatePayload(BaseModel):
    email_verified: Optional[bool] = None
    profile_verified: Optional[bool] = None

class CandidatePasswordResetPayload(BaseModel):
    temporary_password: Optional[str] = None

class CandidateApplyPositionPayload(BaseModel):
    position_id: int

class CandidateProfilePayload(BaseModel):
    name: str
    age: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    came_from: Optional[str] = None
    location: Optional[str] = None
    headline: Optional[str] = None
    work_experience: Optional[str] = None
    qualification: Optional[str] = None
    grade_results: Optional[str] = None
    awards: Optional[List[str]] = None
    skills: Optional[List[str]] = None

class CandidateProfileAssistantPayload(BaseModel):
    message: str
    field: Optional[str] = None

class ScrapePayload(BaseModel):
    position_id: int
    linkedin_url: str
    smtp_settings: Optional[Dict[str, Any]] = None

class InvitePayload(BaseModel):
    email: str
    outreach_email: Optional[str] = None
    hr_feedback: Optional[str] = None
    smtp_settings: Optional[Dict[str, Any]] = None

class RejectCandidatePayload(BaseModel):
    position_id: Optional[int] = None
    hr_feedback: Optional[str] = ""
    rejection_message: Optional[str] = "Thank you for applying. After careful consideration, we have decided to move forward with other candidates whose experience more closely matches our current needs. We appreciate the time you invested and wish you success in your career journey."

class UpdateCandidateOutreachNotesPayload(BaseModel):
    position_id: Optional[int] = None
    outreach_email: Optional[str] = None
    hr_feedback: Optional[str] = None

class InterviewSlotPayload(BaseModel):
    position_id: Optional[int] = None
    interview_date: str
    interview_time: str
    interview_location: str = "To be confirmed"
    interview_notes: Optional[str] = ""

class AutoSourcePayload(BaseModel):
    position_id: int
    count: int = 3

class MockBiasComparisonPayload(BaseModel):
    position_id: int

class NotificationReadPayload(BaseModel):
    notification_id: Optional[str] = None

class RevertStatusPayload(BaseModel):
    position_id: Optional[int] = None


def get_anonymized_hash(email: str) -> str:
    """Generates a consistent anonymized identifier like 'Candidate #7291'."""
    val = int(hashlib.md5(email.encode("utf-8")).hexdigest(), 16) % 10000
    return f"Candidate #{val:04d}"

def hash_password(password: str) -> str:
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters.")
    digest = hashlib.sha256(f"{password}:{settings.SECRET_KEY}".encode("utf-8")).hexdigest()
    return digest

def verify_password(password: str, password_hash: str) -> bool:
    return hmac.compare_digest(hash_password(password), password_hash)

def normalize_candidate_email(email: str) -> str:
    email_clean = (email or "").strip().lower()
    email_pattern = re.compile(r"^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$", re.IGNORECASE)
    if not email_pattern.match(email_clean):
        raise HTTPException(status_code=400, detail="Please enter a valid email address.")
    return email_clean

def create_email_verification(candidate: Dict[str, Any]) -> str:
    code = f"{secrets.randbelow(900000) + 100000}"
    candidate["email_verified"] = False
    candidate["email_verification"] = {
        "code": code,
        "sent_at": datetime.now().isoformat(timespec="seconds"),
        "prototype": not is_smtp_configured()
    }
    return code

def _email_sent(receipt: Any) -> bool:
    if isinstance(receipt, dict):
        return bool(receipt.get("sent"))
    return bool(receipt)

def send_or_log_verification_email(email: str, code: str) -> bool:
    receipt = send_candidate_verification_email(email, code)
    print(f"Prototype email verification code for {email}: {code}")
    return _email_sent(receipt)

def create_pending_email_verification(db: Dict[str, Any], email: str) -> str:
    code = f"{secrets.randbelow(900000) + 100000}"
    db.setdefault("pending_email_verifications", {})[email] = {
        "code": code,
        "sent_at": datetime.now().isoformat(timespec="seconds"),
        "verified": False,
        "prototype": not is_smtp_configured()
    }
    return code

def parse_iso_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None

def verification_cooldown_remaining(record: Dict[str, Any]) -> int:
    sent_at = parse_iso_datetime(record.get("sent_at"))
    if not sent_at:
        return 0
    elapsed = (datetime.now() - sent_at).total_seconds()
    return max(0, VERIFICATION_COOLDOWN_SECONDS - int(elapsed))

def verification_delivery_payload(record: Dict[str, Any], sent: bool = False, cooldown_seconds: int = 0) -> Dict[str, Any]:
    sent_at = parse_iso_datetime(record.get("sent_at")) or datetime.now()
    next_resend_at = sent_at + timedelta(seconds=VERIFICATION_COOLDOWN_SECONDS)
    return {
        "verification_sent": sent,
        "prototype_verification_code": record.get("code") or "",
        "cooldown_seconds": cooldown_seconds,
        "next_resend_at": next_resend_at.isoformat(timespec="seconds"),
        "smtp_configured": is_smtp_configured()
    }

def require_pending_email_verified(db: Dict[str, Any], email: str) -> None:
    pending = db.setdefault("pending_email_verifications", {}).get(email) or {}
    if not pending.get("verified"):
        raise HTTPException(status_code=403, detail="Please verify your email address before creating your candidate profile.")

def add_notification(candidate: Dict[str, Any], title: str, message: str, kind: str = "info", position_id: Optional[int] = None) -> Dict[str, Any]:
    notification = {
        "id": uuid.uuid4().hex[:12],
        "title": title,
        "message": message,
        "kind": kind,
        "position_id": position_id,
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "read": False
    }
    candidate.setdefault("notifications", []).insert(0, notification)
    candidate["notifications"] = candidate["notifications"][:50]
    return notification

def send_decision_email(email: str, subject: str, body: str) -> Dict[str, Any]:
    if not is_smtp_configured():
        print(f"SMTP not configured. Decision email kept in prototype mode for {email}.")
        return {
            "sent": False,
            "smtp_configured": False,
            "reason": "SMTP is not configured; decision email was saved but not sent.",
            "error_type": "smtp_not_configured",
            "provider_message": "",
        }
    try:
        return send_recruitment_email(to_email=email, subject=subject, body=body)
    except Exception as e:
        print(f"Decision email dispatch failure: {e}")
        return {
            "sent": False,
            "smtp_configured": True,
            "reason": "Decision email dispatch failed.",
            "error_type": e.__class__.__name__,
            "provider_message": str(e),
        }

def record_outreach_history(candidate: Dict[str, Any], message: str, status: str, detail: str = "", position_id: Optional[int] = None) -> Dict[str, Any]:
    item = {
        "id": uuid.uuid4().hex[:12],
        "sent_at": datetime.now().isoformat(timespec="seconds"),
        "status": status,
        "message": message or "",
        "detail": detail,
        "position_id": position_id
    }
    candidate.setdefault("outreach_history", []).insert(0, item)
    candidate["outreach_history"] = candidate["outreach_history"][:50]
    return item

def build_application_id(position_id: int) -> str:
    return f"position-{position_id}"

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
        "inactive": 0
    }.get(status, 10)

def normalize_candidate_applications(candidate: Dict[str, Any]) -> List[Dict[str, Any]]:
    applications = candidate.setdefault("applications", [])
    if not applications and candidate.get("position_id"):
        applications.append({
            "application_id": build_application_id(candidate["position_id"]),
            "position_id": candidate.get("position_id"),
            "status": candidate.get("status", "applied"),
            "applied_at": candidate.get("applied_at"),
            "match_results": candidate.get("match_results", {}),
            "custom_questions": candidate.get("custom_questions", []),
            "answers": candidate.get("answers", []),
            "evaluation": candidate.get("evaluation", {}),
            "sourcing_pitch": candidate.get("sourcing_pitch", ""),
            "outreach_email": candidate.get("outreach_email", ""),
            "draft_answers": candidate.get("draft_answers", {}).get(str(candidate.get("position_id")), []),
            "last_agent_error": candidate.get("last_agent_error", "")
        })
    return applications

def find_application(candidate: Dict[str, Any], position_id: Optional[int]) -> Optional[Dict[str, Any]]:
    applications = normalize_candidate_applications(candidate)
    if position_id:
        return next((app for app in applications if app.get("position_id") == position_id), None)
    current_position_id = candidate.get("position_id")
    if current_position_id:
        return next((app for app in applications if app.get("position_id") == current_position_id), None)
    return applications[-1] if applications else None

def sync_current_application(candidate: Dict[str, Any], application: Dict[str, Any]) -> None:
    candidate["status"] = application.get("status", "applied")
    candidate["position_id"] = application.get("position_id")
    candidate["applied_at"] = application.get("applied_at")
    candidate["match_results"] = application.get("match_results", {})
    candidate["custom_questions"] = application.get("custom_questions", [])
    candidate["answers"] = application.get("answers", [])
    candidate["evaluation"] = application.get("evaluation", {})
    candidate["sourcing_pitch"] = application.get("sourcing_pitch", candidate.get("sourcing_pitch", ""))
    candidate["outreach_email"] = application.get("outreach_email", candidate.get("outreach_email", ""))
    candidate["hr_feedback"] = application.get("hr_feedback", candidate.get("hr_feedback", ""))
    candidate["rejection_message"] = application.get("rejection_message", candidate.get("rejection_message", ""))
    candidate["rejected_at"] = application.get("rejected_at", candidate.get("rejected_at"))
    candidate["hired_at"] = application.get("hired_at", candidate.get("hired_at"))
    candidate["interview_slot"] = application.get("interview_slot", candidate.get("interview_slot"))

def serialize_application_candidate(candidate: Dict[str, Any], email: str, application: Dict[str, Any]) -> Dict[str, Any]:
    serialized = serialize_candidate(candidate, email)
    serialized.update({
        "application_id": application.get("application_id") or build_application_id(application["position_id"]),
        "position_id": application.get("position_id"),
        "status": application.get("status", "applied"),
        "applied_at": application.get("applied_at"),
        "match_results": application.get("match_results", {}),
        "custom_questions": application.get("custom_questions", []),
        "answers": application.get("answers", []),
        "evaluation": application.get("evaluation", {}),
        "sourcing_pitch": application.get("sourcing_pitch", candidate.get("sourcing_pitch", "")),
        "outreach_email": application.get("outreach_email", candidate.get("outreach_email", "")),
        "hr_feedback": application.get("hr_feedback", candidate.get("hr_feedback", "")),
        "rejection_message": application.get("rejection_message", ""),
        "rejected_at": application.get("rejected_at"),
        "hired_at": application.get("hired_at"),
        "interview_slot": application.get("interview_slot"),
        "draft_answers": application.get("draft_answers", []),
        "last_agent_error": application.get("last_agent_error", ""),
        "agent_warnings": application.get("agent_warnings", candidate.get("agent_warnings", [])),
        "status_history": application.get("status_history", [])
    })
    return serialized

def serialize_candidate(candidate: Dict[str, Any], management_email: Optional[str] = None) -> Dict[str, Any]:
    normalize_candidate_applications(candidate)
    profile_data = candidate.get("profile_data", {})
    serialized = {k: v for k, v in candidate.items() if k not in {"password_hash", "email_verification"}}
    serialized["management_email"] = management_email or candidate.get("email")
    serialized["has_password"] = bool(candidate.get("password_hash"))
    serialized["application_count"] = len(candidate.get("applications", []))
    missing_fields = get_missing_profile_fields(profile_data)
    serialized["profile_missing_fields"] = missing_fields
    serialized["profile_completion"] = max(0, round(((len(PROFILE_REQUIRED_FIELDS) - len(missing_fields)) / len(PROFILE_REQUIRED_FIELDS)) * 100))
    serialized["profile_verified"] = not missing_fields
    serialized["email_verified"] = bool(candidate.get("email_verified", True))
    serialized["hr_feedback"] = candidate.get("hr_feedback", "")
    serialized["notifications"] = candidate.get("notifications", [])
    serialized["outreach_history"] = candidate.get("outreach_history", [])
    serialized["source_type"] = candidate.get("source_type") or profile_data.get("source_type") or ("linkedin" if candidate.get("is_sourced") else "inbound")
    serialized["source_method"] = candidate.get("source_method") or profile_data.get("source_method") or ("manual_public" if candidate.get("linkedin_url") else "resume")

    # Inject QS ranking data for each education entry
    qs_ranking = []
    for edu in (profile_data.get("education") or []):
        if isinstance(edu, dict):
            school = edu.get("school") or edu.get("institution") or ""
            if school:
                rank = lookup_qs_rank_from_csv(school)
                qs_ranking.append({
                    "school": school,
                    "rank": rank
                })
    serialized["qs_ranking"] = qs_ranking

    return serialized

def neutralize_text(text: str) -> str:
    """Masks high prestige institutions inside textual data."""
    return agent_neutralize_text(text)

def build_candidate_bias_artifacts(
    profile_data: Dict[str, Any],
    resume_text: str = "",
    existing_analysis: Optional[Dict[str, Any]] = None,
    use_llm: bool = True
) -> Dict[str, Any]:
    analysis = existing_analysis or analyze_prestige_indicators(profile_data or {}, resume_text or "", use_llm=use_llm)
    neutralized_profile = neutralize_candidate_profile(profile_data or {}, analysis)
    return {
        "bias_analysis": analysis,
        "neutralized_profile_data": neutralized_profile
    }

def apply_bias_to_match_results(
    match_results: Dict[str, Any],
    job: Dict[str, Any],
    profile_data: Dict[str, Any],
    controls: Dict[str, Any],
    bias_analysis: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    return apply_bias_controls_to_assessment(
        match_results or {},
        job or {},
        profile_data or {},
        controls,
        bias_analysis
    )

def attach_bias_artifacts_to_candidate(candidate: Dict[str, Any], resume_text: str = "") -> Dict[str, Any]:
    artifacts = build_candidate_bias_artifacts(
        candidate.get("profile_data", {}),
        resume_text or candidate.get("resume_text", ""),
        candidate.get("bias_analysis")
    )
    candidate["bias_analysis"] = artifacts["bias_analysis"]
    candidate["neutralized_profile_data"] = artifacts["neutralized_profile_data"]
    return artifacts

def run_resume_profile_upload_graph(
    resume_text: str,
    candidate_email: str,
    submitted_name: str = ""
) -> tuple[Dict[str, Any], Dict[str, Any], List[str]]:
    """Run the lightweight agent graph used by account/resume uploads.

    Signup needs a verified candidate profile quickly. The graph still routes
    through guardrails, supervisor, Resume Agent, and Bias Agent, but the worker
    tools use deterministic in-agent modes so the browser is not held hostage by
    long model calls before the candidate can enter the portal.
    """
    agent_warnings: List[str] = []
    try:
        graph_result = run_agent_graph("resume_profile", {
            "candidate_email": candidate_email,
            "input": {
                "candidate_email": candidate_email,
                "resume_text": resume_text,
                "supervisor_use_llm": False,
                "resume_use_llm": False,
                "bias_use_llm": False,
                "status": "profile",
                "source_type": "inbound",
                "source_method": "resume_agent_graph",
            }
        })
        if graph_result.get("blocked"):
            raise HTTPException(
                status_code=400,
                detail=graph_result.get("guardrail", {}).get("reason", "Resume upload was blocked by agent guardrails.")
            )
        artifacts = graph_result.get("artifacts", {}) or {}
        profile_data = artifacts.get("candidate_profile")
        if not isinstance(profile_data, dict) or not profile_data:
            agent_warnings.append("Resume Agent returned no profile, so its deterministic parser fallback was used.")
            profile_data = parse_resume_text_fallback(resume_text)
        agent_warnings.extend(graph_result.get("agent_warnings", []))
        bias_analysis = artifacts.get("prestige_analysis")
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error running resume profile agent graph: {e}")
        agent_warnings.append("Resume profile agent graph failed, so deterministic agent fallbacks were used.")
        profile_data = parse_resume_text_fallback(resume_text)
        bias_analysis = None

    validate_resume_agent_profile(profile_data, submitted_name)
    profile_data = normalize_profile_details(apply_resume_extraction_warning(profile_data, resume_text))
    bias_artifacts = build_candidate_bias_artifacts(
        profile_data,
        resume_text,
        bias_analysis if isinstance(bias_analysis, dict) else None,
        use_llm=False
    )
    return profile_data, bias_artifacts, agent_warnings

def save_signup_candidate_record(
    db: Dict[str, Any],
    email_clean: str,
    name: str,
    password: str,
    resume_filename: str,
    resume_text: str,
    contents: bytes,
    profile_data: Dict[str, Any],
    bias_artifacts: Dict[str, Any],
    agent_warnings: List[str]
) -> Dict[str, Any]:
    resume_path = save_resume_file(email_clean, resume_filename or "resume.pdf", contents)
    resume_summary = get_resume_summary(profile_data, resume_text)
    parsed_name = profile_data.get("name") if profile_data.get("name") and profile_data.get("name") != "Candidate Full Name" else name

    candidate_record = {
        "name": parsed_name,
        "email": email_clean,
        "status": "profile",
        "position_id": None,
        "is_sourced": False,
        "source_type": "inbound",
        "source_method": "resume",
        "linkedin_url": "",
        "profile_data": profile_data,
        "bias_analysis": bias_artifacts["bias_analysis"],
        "neutralized_profile_data": bias_artifacts["neutralized_profile_data"],
        "resume_filename": resume_filename,
        "resume_path": resume_path,
        "resume_url": f"/api/v1/candidates/{email_clean}/resume",
        "resume_text": resume_text,
        "resume_summary": resume_summary,
        "profile_picture_url": "",
        "sourcing_pitch": "",
        "outreach_email": "",
        "match_results": {},
        "custom_questions": [],
        "answers": [],
        "evaluation": {},
        "agent_warnings": agent_warnings,
        "applications": [],
        "notifications": [],
        "outreach_history": [],
        "hiring_manager_feedback": "",
        "profile_verified": not get_missing_profile_fields(profile_data),
        "email_verified": True,
        "email_verified_at": datetime.now().isoformat(timespec="seconds"),
        "password_hash": hash_password(password)
    }

    db.setdefault("candidates", {})[email_clean] = candidate_record
    db.setdefault("pending_email_verifications", {}).pop(email_clean, None)
    save_db(db)
    return serialize_candidate(candidate_record, email_clean)

def ensure_candidate_bias_metadata(candidate: Dict[str, Any], db: Dict[str, Any]) -> None:
    controls = get_bias_controls(db)
    artifacts = attach_bias_artifacts_to_candidate(candidate)
    for application in normalize_candidate_applications(candidate):
        match_results = application.get("match_results") or {}
        if not match_results or match_results.get("bias_control"):
            continue
        job = db.get("positions", {}).get(str(application.get("position_id")), {})
        application["match_results"] = apply_bias_to_match_results(
            match_results,
            job,
            candidate.get("profile_data", {}),
            controls,
            artifacts["bias_analysis"]
        )
        if application.get("position_id") == candidate.get("position_id"):
            sync_current_application(candidate, application)

def serialize_neutralized_candidate(candidate: Dict[str, Any], email: str, application: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    working = {**candidate}
    artifacts = build_candidate_bias_artifacts(
        candidate.get("profile_data", {}),
        candidate.get("resume_text", ""),
        candidate.get("bias_analysis")
    )
    email_hash = get_anonymized_hash(candidate.get("email") or email)
    profile = {
        **artifacts["neutralized_profile_data"],
        "name": email_hash,
        "location": artifacts["neutralized_profile_data"].get("location", "Anonymous City")
    }
    match_results = application.get("match_results", {}) if application else candidate.get("match_results", {})
    debate = match_results.get("debate", {})
    neutralized_match = {
        **match_results,
        "debate": {
            "critical_recruiter_cons": [agent_neutralize_text(con, artifacts["bias_analysis"]) for con in debate.get("critical_recruiter_cons", [])],
            "talent_advocate_pros": [agent_neutralize_text(pro, artifacts["bias_analysis"]) for pro in debate.get("talent_advocate_pros", [])]
        },
        "position_fit_summary": agent_neutralize_text(match_results.get("position_fit_summary", ""), artifacts["bias_analysis"]),
        "score_explanation": agent_neutralize_text(match_results.get("score_explanation", ""), artifacts["bias_analysis"])
    }
    working.update({
        "name": email_hash,
        "email": f"{email_hash.lower().replace(' ', '_').replace('#', '')}@anonymous.com",
        "linkedin_url": "https://www.linkedin.com/in/anonymous-profile",
        "profile_data": profile,
        "bias_analysis": artifacts["bias_analysis"],
        "neutralized_profile_data": artifacts["neutralized_profile_data"],
        "match_results": neutralized_match,
        "sourcing_pitch": agent_neutralize_text(candidate.get("sourcing_pitch", ""), artifacts["bias_analysis"]),
        "outreach_email": agent_neutralize_text(candidate.get("outreach_email", ""), artifacts["bias_analysis"])
    })
    if application:
        neutralized_application = {**application, "match_results": neutralized_match}
        return serialize_application_candidate(working, email, neutralized_application)
    return serialize_candidate(working, email)

def get_resume_summary(profile_data: Dict[str, Any], resume_text: str) -> str:
    about = profile_data.get("about", "").strip()
    headline = profile_data.get("headline", "").strip()
    experiences = profile_data.get("experiences", [])
    if about:
        return about
    if headline:
        return headline
    if resume_text and not resume_text.startswith("PDF text extraction"):
        return " ".join(resume_text.split())[:420]
    if experiences:
        latest = experiences[0]
        return f"{latest.get('title', 'Candidate')} with experience at {latest.get('company', 'previous organizations')}."
    return "Resume text could not be extracted automatically. Open the original PDF to review the candidate profile."

def apply_resume_extraction_warning(profile_data: Dict[str, Any], resume_text: str) -> Dict[str, Any]:
    text = resume_text or ""
    sparse_text = len(text.strip()) < 80 or text.startswith("PDF text extraction did not find readable text")
    if sparse_text:
        profile_data["extraction_warning"] = (
            "This resume looks like an image-based PDF. Automatic prefill needs selectable PDF text, "
            "Tesseract OCR, or a vision-capable AI model. Please review and complete the fields manually."
        )
    else:
        profile_data.pop("extraction_warning", None)
    return profile_data

def has_profile_value(value: Any) -> bool:
    if isinstance(value, str):
        normalized = value.strip().lower()
        return bool(normalized) and normalized not in {"n/a", "na", "none", "unknown", "not specified", "candidate full name"}
    if isinstance(value, list):
        return any(has_profile_value(item) for item in value)
    if isinstance(value, dict):
        return any(has_profile_value(item) for item in value.values())
    return value is not None

def normalize_profile_details(profile_data: Dict[str, Any]) -> Dict[str, Any]:
    profile_data = profile_data or {}
    basic_info = profile_data.get("basic_info") if isinstance(profile_data.get("basic_info"), dict) else {}
    experiences = profile_data.get("experiences") if isinstance(profile_data.get("experiences"), list) else []
    education = profile_data.get("education") if isinstance(profile_data.get("education"), list) else []

    for key in ("phone", "age", "address", "location", "came_from"):
        if not has_profile_value(profile_data.get(key)) and has_profile_value(basic_info.get(key)):
            profile_data[key] = basic_info.get(key)

    if not has_profile_value(profile_data.get("skills")) and has_profile_value(basic_info.get("skills")):
        profile_data["skills"] = basic_info.get("skills")

    if not has_profile_value(profile_data.get("work_experience")) and experiences:
        chunks = []
        for exp in experiences[:4]:
            title = exp.get("title", "")
            company = exp.get("company", "")
            duration = exp.get("duration", "")
            description = exp.get("description", "")
            chunk = " - ".join(part for part in [title, company, duration] if has_profile_value(part))
            if description:
                chunk = f"{chunk}: {description}" if chunk else description
            if chunk:
                chunks.append(chunk)
        profile_data["work_experience"] = "; ".join(chunks)

    if not has_profile_value(profile_data.get("qualification")) and education:
        profile_data["qualification"] = "; ".join(
            " - ".join(part for part in [edu.get("degree", ""), edu.get("school", ""), edu.get("duration", "")] if has_profile_value(part))
            for edu in education[:3]
        )

    if not has_profile_value(profile_data.get("came_from")):
        profile_data["came_from"] = profile_data.get("location") or profile_data.get("address") or ""

    return profile_data

def get_missing_profile_fields(profile_data: Dict[str, Any]) -> List[Dict[str, str]]:
    normalized_profile = normalize_profile_details(profile_data)
    return [
        {"field": field, "label": label}
        for field, label in PROFILE_REQUIRED_FIELDS.items()
        if not has_profile_value(normalized_profile.get(field))
    ]

def validate_resume_text_for_agent(resume_text: str) -> None:
    text = " ".join((resume_text or "").split())
    lowered = text.lower()
    signal_terms = {
        "resume", "cv", "education", "experience", "employment", "work",
        "skills", "qualification", "degree", "university", "project",
        "summary", "profile", "award", "certification"
    }
    signal_count = sum(1 for term in signal_terms if term in lowered)
    section_count = sum(1 for term in ("experience", "education", "skills", "projects", "certification", "summary", "profile") if term in lowered)
    has_contact = bool(re.search(r"[\w.+-]+@[\w-]+\.[\w.-]+", text)) or bool(re.search(r"\+?\d[\d\s().-]{7,}\d", text))
    mostly_non_words = len(re.findall(r"[A-Za-z]{3,}", text)) < 35
    if len(text) < 180 or mostly_non_words or signal_count < 3 or (section_count < 1 and not has_contact):
        raise HTTPException(
            status_code=400,
            detail=(
                "This PDF does not look like a valid readable resume. Upload a resume PDF with clear text, "
                "candidate identity, and resume sections such as experience, education, skills, projects, or certifications."
            )
        )

def validate_resume_agent_profile(profile_data: Dict[str, Any], submitted_name: str) -> None:
    profile_data = profile_data or {}
    has_identity = has_profile_value(profile_data.get("name")) and str(profile_data.get("name")).strip().lower() != "candidate full name"
    has_resume_content = any(has_profile_value(profile_data.get(field)) for field in ("skills", "experiences", "education", "work_experience", "qualification", "about"))
    if not has_identity and submitted_name.strip():
        profile_data["name"] = submitted_name.strip()
        has_identity = True
    if not has_identity or not has_resume_content:
        raise HTTPException(
            status_code=400,
            detail="Resume validation failed. The Resume Agent could not find candidate identity plus resume content in this PDF."
        )

def save_resume_file(email: str, filename: str, contents: bytes) -> str:
    os.makedirs(RESUME_DIR, exist_ok=True)
    extension = os.path.splitext(filename or "resume.pdf")[1].lower() or ".pdf"
    safe_email = re.sub(r"[^a-zA-Z0-9_.-]", "_", email)
    stored_name = f"{safe_email}-{uuid.uuid4().hex[:8]}{extension}"
    stored_path = os.path.join(RESUME_DIR, stored_name)
    with open(stored_path, "wb") as f:
        f.write(contents)
    return stored_path

def save_profile_picture_file(email: str, image: UploadFile, contents: bytes) -> str:
    if len(contents) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Profile picture must be 5MB or smaller.")
    extension = os.path.splitext(image.filename or "profile.jpg")[1].lower()
    if extension not in {".jpg", ".jpeg", ".png", ".webp"}:
        raise HTTPException(status_code=400, detail="Profile picture must be JPG, PNG, or WebP.")
    try:
        from PIL import Image
        with Image.open(io.BytesIO(contents)) as img:
            img.verify()
    except Exception:
        raise HTTPException(status_code=400, detail="Profile picture file could not be read as an image.")
    os.makedirs(PROFILE_IMAGE_DIR, exist_ok=True)
    safe_email = re.sub(r"[^a-zA-Z0-9_.-]", "_", email)
    stored_name = f"{safe_email}-{uuid.uuid4().hex[:8]}{extension}"
    stored_path = os.path.join(PROFILE_IMAGE_DIR, stored_name)
    with open(stored_path, "wb") as f:
        f.write(contents)
    return f"/uploads/profile_pictures/{stored_name}"

@router.get("")
def get_candidates(neutralize: bool = Query(False)):
    db = load_db()
    candidates = list(db.get("candidates", {}).items())
    if not neutralize:
        rows = []
        for email, candidate in candidates:
            ensure_candidate_bias_metadata(candidate, db)
            applications = normalize_candidate_applications(candidate)
            if applications:
                rows.extend(serialize_application_candidate(candidate, email, app) for app in applications)
            else:
                rows.append(serialize_candidate(candidate, email))
        save_db(db)
        return rows
        
    neutralized_list = []
    for email, candidate in candidates:
        ensure_candidate_bias_metadata(candidate, db)
        applications = normalize_candidate_applications(candidate)
        if applications:
            neutralized_list.extend(serialize_neutralized_candidate(candidate, email, app) for app in applications)
        else:
            neutralized_list.append(serialize_neutralized_candidate(candidate, email))
    save_db(db)
    return neutralized_list

@router.get("/fairness-audit")
def get_fairness_audit(position_id: Optional[int] = Query(None)):
    db = load_db()
    rows: List[Dict[str, Any]] = []
    for email, candidate in db.get("candidates", {}).items():
        ensure_candidate_bias_metadata(candidate, db)
        for application in normalize_candidate_applications(candidate):
            if position_id and application.get("position_id") != position_id:
                continue
            match_results = application.get("match_results") or candidate.get("match_results", {})
            bias_control = match_results.get("bias_control", {})
            prestige_analysis = match_results.get("prestige_analysis") or candidate.get("bias_analysis", {})
            rows.append({
                "email": email,
                "status": application.get("status", candidate.get("status", "staged")),
                "match_score": (match_results.get("scores") or {}).get("overall_position_fit", 0),
                "prestige_score": bias_control.get("prestige_score") or prestige_analysis.get("prestige_score", 35),
                "prestige_affects_score": bool(bias_control.get("prestige_affects_score")),
                "indicator_count": len(prestige_analysis.get("prestige_indicators", []))
            })

    total = len(rows)
    if total == 0:
        return {
            "fairness_score": 100,
            "risk_level": "insufficient_data",
            "summary": "No candidates are available for this fairness audit scope yet.",
            "selection_patterns": {},
            "prestige_favoritism": {"risk": "insufficient_data", "message": "Add candidates before measuring prestige-related outcome patterns."},
            "warnings": ["Protected-class inference is disabled; the audit uses only available recruitment outcomes and prestige signals."]
        }

    selected_statuses = {"completed", "interview_scheduled", "hired"}
    rejected = [row for row in rows if row["status"] == "rejected"]
    selected = [row for row in rows if row["status"] in selected_statuses]
    high_prestige = [row for row in rows if int(row["prestige_score"] or 0) >= 75]
    lower_prestige = [row for row in rows if int(row["prestige_score"] or 0) < 75]

    def rate(pool: List[Dict[str, Any]], statuses: set[str]) -> int:
        return round((len([row for row in pool if row["status"] in statuses]) / max(1, len(pool))) * 100)

    high_selection = rate(high_prestige, selected_statuses)
    lower_selection = rate(lower_prestige, selected_statuses)
    gap = high_selection - lower_selection if high_prestige and lower_prestige else 0
    prestige_weighted_count = len([row for row in rows if row["prestige_affects_score"]])
    risk_points = min(35, abs(gap)) + min(20, prestige_weighted_count * 4)
    fairness_score = max(0, min(100, 100 - risk_points))
    risk_level = "low"
    if fairness_score < 60:
        risk_level = "high"
    elif fairness_score < 80:
        risk_level = "medium"

    warnings = ["Protected-class inference is disabled; the audit uses only available recruitment outcomes and prestige signals."]
    if len(high_prestige) < 2 or len(lower_prestige) < 2:
        warnings.append("Prestige cohorts are small, so favoritism risk is directional rather than statistically conclusive.")
    if gap > 20:
        warnings.append("High-prestige candidates are advancing at a noticeably higher rate than lower-prestige candidates.")
    if prestige_weighted_count:
        warnings.append("Prestige-Aware scoring is active for at least one candidate; review whether this aligns with the hiring strategy.")

    save_db(db)
    return {
        "fairness_score": fairness_score,
        "risk_level": risk_level,
        "summary": f"Audit reviewed {total} candidate application{'s' if total != 1 else ''}; selection gap by prestige cohort is {gap} points.",
        "selection_patterns": {
            "total_candidates": total,
            "selected_count": len(selected),
            "rejected_count": len(rejected),
            "selected_rate": rate(rows, selected_statuses),
            "rejection_rate": rate(rows, {"rejected"}),
            "high_prestige_selection_rate": high_selection,
            "lower_prestige_selection_rate": lower_selection,
            "prestige_selection_gap": gap
        },
        "prestige_favoritism": {
            "risk": risk_level,
            "high_prestige_count": len(high_prestige),
            "lower_prestige_count": len(lower_prestige),
            "prestige_weighted_count": prestige_weighted_count,
            "message": "Monitor advancement rates across prestige cohorts before final decisions."
        },
        "warnings": warnings
    }

@router.get("/lookup")
def lookup_candidate(email: str):
    db = load_db()
    email_clean = normalize_candidate_email(email)
    candidate = db.get("candidates", {}).get(email_clean)
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate session not found.")
    return serialize_candidate(candidate, email_clean)

@router.post("/login")
def login_candidate(payload: CandidateLoginPayload):
    db = load_db()
    email_clean = normalize_candidate_email(payload.email)
    candidate = db.get("candidates", {}).get(email_clean)

    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate account not found.")
    if not candidate.get("password_hash"):
        raise HTTPException(status_code=400, detail="Password has not been set for this account.")
    if not payload.password or not verify_password(payload.password, candidate["password_hash"]):
        raise HTTPException(status_code=401, detail="Incorrect password.")

    return serialize_candidate(candidate, email_clean)

@router.post("/{email}/password")
def set_candidate_password(email: str, payload: CandidatePasswordPayload):
    db = load_db()
    email_clean = normalize_candidate_email(email)
    candidate = db.get("candidates", {}).get(email_clean)
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate account not found.")

    candidate["password_hash"] = hash_password(payload.password)
    save_db(db)
    return serialize_candidate(candidate, email_clean)

@router.post("/{email}/reset-password")
def reset_candidate_password(email: str, payload: CandidatePasswordResetPayload):
    db = load_db()
    email_clean = normalize_candidate_email(email)
    candidate = db.get("candidates", {}).get(email_clean)
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate account not found.")

    temporary_password = (payload.temporary_password or "").strip()
    if not temporary_password:
        temporary_password = f"Temp-{secrets.token_urlsafe(9)}"
    candidate["password_hash"] = hash_password(temporary_password)
    candidate["password_reset_at"] = datetime.now().isoformat(timespec="seconds")
    save_db(db)

    response = serialize_candidate(candidate, email_clean)
    response["temporary_password"] = temporary_password
    return response

@router.patch("/{email}/account")
def update_candidate_account(email: str, payload: CandidateAccountUpdatePayload):
    db = load_db()
    email_clean = normalize_candidate_email(email)
    candidate = db.get("candidates", {}).get(email_clean)
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate account not found.")

    update_data = payload.model_dump(exclude_unset=True)
    if "email_verified" in update_data:
        candidate["email_verified"] = bool(update_data["email_verified"])
        if candidate["email_verified"]:
            candidate["email_verified_at"] = datetime.now().isoformat(timespec="seconds")
            candidate.pop("email_verification", None)
        else:
            candidate.pop("email_verified_at", None)

    if "profile_verified" in update_data:
        candidate["profile_verified"] = bool(update_data["profile_verified"])

    save_db(db)
    return serialize_candidate(candidate, email_clean)

@router.post("/{email}/verify-email")
def verify_candidate_email(email: str, payload: CandidateEmailVerificationPayload):
    db = load_db()
    email_clean = normalize_candidate_email(email)
    candidate = db.get("candidates", {}).get(email_clean)
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate account not found.")

    verification = candidate.get("email_verification") or {}
    expected_code = str(verification.get("code") or "").strip()
    submitted_code = (payload.code or "").strip()
    if not expected_code or submitted_code != expected_code:
        raise HTTPException(status_code=400, detail="Invalid verification code.")

    candidate["email_verified"] = True
    candidate["email_verified_at"] = datetime.now().isoformat(timespec="seconds")
    candidate.pop("email_verification", None)
    save_db(db)
    return serialize_candidate(candidate, email_clean)

@router.post("/{email}/resend-verification")
def resend_candidate_email_verification(email: str):
    db = load_db()
    email_clean = normalize_candidate_email(email)
    candidate = db.get("candidates", {}).get(email_clean)
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate account not found.")
    if candidate.get("email_verified"):
        return {**serialize_candidate(candidate, email_clean), **verification_delivery_payload({}, sent=False)}

    existing = candidate.get("email_verification") or {}
    remaining = verification_cooldown_remaining(existing)
    if remaining:
        return {**serialize_candidate(candidate, email_clean), **verification_delivery_payload(existing, sent=False, cooldown_seconds=remaining)}
    code = create_email_verification(candidate)
    sent = send_or_log_verification_email(email_clean, code)
    save_db(db)
    response = serialize_candidate(candidate, email_clean)
    response.update(verification_delivery_payload(candidate.get("email_verification") or {"code": code}, sent=sent, cooldown_seconds=VERIFICATION_COOLDOWN_SECONDS))
    return response

@router.post("/start-email-verification")
def start_candidate_email_verification(payload: CandidateEmailPayload):
    db = load_db()
    email_clean = normalize_candidate_email(payload.email)
    candidate = db.get("candidates", {}).get(email_clean)

    if candidate:
        if candidate.get("email_verified"):
            return {**serialize_candidate(candidate, email_clean), **verification_delivery_payload({}, sent=False)}
        existing = candidate.get("email_verification") or {}
        remaining = verification_cooldown_remaining(existing)
        if remaining:
            return {**serialize_candidate(candidate, email_clean), **verification_delivery_payload(existing, sent=False, cooldown_seconds=remaining)}
        code = create_email_verification(candidate)
        record = candidate.get("email_verification") or {"code": code}
    else:
        pending = db.setdefault("pending_email_verifications", {}).get(email_clean) or {}
        remaining = verification_cooldown_remaining(pending)
        if remaining:
            return {
                "email": email_clean,
                **verification_delivery_payload(pending, sent=False, cooldown_seconds=remaining)
            }
        code = create_pending_email_verification(db, email_clean)
        record = db.setdefault("pending_email_verifications", {}).get(email_clean) or {"code": code}

    sent = send_or_log_verification_email(email_clean, code)
    save_db(db)
    return {
        "email": email_clean,
        **verification_delivery_payload(record, sent=sent, cooldown_seconds=VERIFICATION_COOLDOWN_SECONDS)
    }

@router.post("/verify-pending-email")
def verify_pending_candidate_email(payload: CandidatePendingEmailVerificationPayload):
    db = load_db()
    email_clean = normalize_candidate_email(payload.email)
    submitted_code = (payload.code or "").strip()
    candidate = db.get("candidates", {}).get(email_clean)

    if candidate:
        verification = candidate.get("email_verification") or {}
        expected_code = str(verification.get("code") or "").strip()
        if not expected_code or submitted_code != expected_code:
            raise HTTPException(status_code=400, detail="Invalid verification code.")
        candidate["email_verified"] = True
        candidate["email_verified_at"] = datetime.now().isoformat(timespec="seconds")
        candidate.pop("email_verification", None)
        save_db(db)
        return serialize_candidate(candidate, email_clean)

    pending = db.setdefault("pending_email_verifications", {}).get(email_clean)
    if not pending or str(pending.get("code") or "").strip() != submitted_code:
        raise HTTPException(status_code=400, detail="Invalid verification code.")
    pending["verified"] = True
    pending["verified_at"] = datetime.now().isoformat(timespec="seconds")
    save_db(db)
    return {"email": email_clean, "email_verified": True}

@router.patch("/{email}/profile")
def update_candidate_profile(email: str, payload: CandidateProfilePayload):
    db = load_db()
    email_clean = normalize_candidate_email(email)
    candidate = db.setdefault("candidates", {}).get(email_clean)
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate account not found.")

    profile_data = candidate.setdefault("profile_data", {})
    candidate["name"] = payload.name.strip()
    profile_data["name"] = payload.name.strip()
    profile_data["age"] = (payload.age or "").strip()
    profile_data["phone"] = (payload.phone or "").strip()
    profile_data["address"] = (payload.address or "").strip()
    profile_data["came_from"] = (payload.came_from or "").strip()
    profile_data["location"] = (payload.location or "").strip()
    profile_data["headline"] = (payload.headline or "").strip()
    profile_data["work_experience"] = (payload.work_experience or "").strip()
    profile_data["qualification"] = (payload.qualification or "").strip()
    profile_data["grade_results"] = (payload.grade_results or "").strip()
    profile_data["awards"] = payload.awards or []
    profile_data["skills"] = payload.skills or []
    profile_data = normalize_profile_details(profile_data)
    candidate["profile_data"] = profile_data
    candidate["profile_verified"] = not get_missing_profile_fields(profile_data)
    attach_bias_artifacts_to_candidate(candidate)

    save_db(db)
    return serialize_candidate(candidate, email_clean)

@router.post("/{email}/profile-assistant")
def profile_assistant(email: str, payload: CandidateProfileAssistantPayload):
    db = load_db()
    email_clean = normalize_candidate_email(email)
    candidate = db.setdefault("candidates", {}).get(email_clean)
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate account not found.")

    profile_data = normalize_profile_details(candidate.setdefault("profile_data", {}))
    missing = get_missing_profile_fields(profile_data)
    if not missing:
        return {
            "is_complete": True,
            "accepted": True,
            "field": "",
            "question": "",
            "message": "Your required information details are complete.",
            "candidate": serialize_candidate(candidate, email_clean)
        }

    field = payload.field if payload.field in PROFILE_REQUIRED_FIELDS else missing[0]["field"]
    value = (payload.message or "").strip()
    if len(value) < 2:
        raise HTTPException(status_code=400, detail=f"Please provide a valid {PROFILE_REQUIRED_FIELDS[field].lower()}.")
    if field == "age" and not re.match(r"^(1[6-9]|[2-9][0-9])$", value):
        raise HTTPException(status_code=400, detail="Please enter a valid age as a number.")
    if field == "phone" and len(re.sub(r"\D", "", value)) < 7:
        raise HTTPException(status_code=400, detail="Please enter a valid reachable phone number.")

    profile_data[field] = value
    candidate["profile_data"] = normalize_profile_details(profile_data)
    candidate["name"] = candidate["profile_data"].get("name") or candidate.get("name")
    candidate["profile_verified"] = not get_missing_profile_fields(candidate["profile_data"])
    attach_bias_artifacts_to_candidate(candidate)
    remaining = get_missing_profile_fields(candidate["profile_data"])
    next_field = remaining[0] if remaining else None
    save_db(db)
    return {
        "is_complete": not remaining,
        "accepted": True,
        "field": field,
        "question": f"What is your {next_field['label'].lower()}?" if next_field else "",
        "message": "Thanks. I saved that detail." if remaining else "Thanks. Your required information details are now complete and saved.",
        "candidate": serialize_candidate(candidate, email_clean)
    }

@router.post("/{email}/profile-picture")
async def upload_candidate_profile_picture(email: str, image: UploadFile = File(...)):
    db = load_db()
    email_clean = normalize_candidate_email(email)
    candidate = db.setdefault("candidates", {}).get(email_clean)
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate account not found.")
    contents = await image.read()
    candidate["profile_picture_url"] = save_profile_picture_file(email_clean, image, contents)
    save_db(db)
    return serialize_candidate(candidate, email_clean)

@router.post("/{email}/resume")
async def replace_candidate_resume(email: str, resume: UploadFile = File(...)):
    db = load_db()
    email_clean = normalize_candidate_email(email)
    candidate = db.setdefault("candidates", {}).get(email_clean)
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate account not found.")

    resume_text, contents = await read_resume_text(resume)
    validate_resume_text_for_agent(resume_text)
    profile_data, bias_artifacts, graph_warnings = run_resume_profile_upload_graph(
        resume_text,
        email_clean,
        candidate.get("name", "")
    )
    candidate["profile_data"] = {**candidate.get("profile_data", {}), **profile_data}
    candidate["name"] = candidate["profile_data"].get("name") or candidate.get("name")
    candidate["resume_filename"] = resume.filename
    candidate["resume_path"] = save_resume_file(email_clean, resume.filename or "resume.pdf", contents)
    candidate["resume_url"] = f"/api/v1/candidates/{email_clean}/resume"
    candidate["resume_text"] = resume_text
    candidate["resume_summary"] = get_resume_summary(candidate["profile_data"], resume_text)
    candidate["profile_verified"] = not get_missing_profile_fields(candidate["profile_data"])
    candidate["bias_analysis"] = bias_artifacts["bias_analysis"]
    candidate["neutralized_profile_data"] = bias_artifacts["neutralized_profile_data"]
    if graph_warnings:
        candidate.setdefault("agent_warnings", []).extend(graph_warnings)
    add_notification(candidate, "Resume updated", "Your resume and profile details were updated.", "profile")
    save_db(db)
    return serialize_candidate(candidate, email_clean)

async def read_resume_text(resume: UploadFile) -> tuple[str, bytes]:
    filename = resume.filename or ""
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Please upload a PDF resume.")

    try:
        contents = await resume.read()
        if len(contents) > MAX_RESUME_BYTES:
            raise HTTPException(status_code=400, detail="Resume must be 10MB or smaller.")

        pdf_reader = PdfReader(io.BytesIO(contents))
        resume_text = extract_text_from_pdf_layers(contents, pdf_reader)
        if len(resume_text.strip()) < 80:
            image_text = extract_text_from_image_pdf(pdf_reader)
            if image_text:
                resume_text = f"{resume_text}\n{image_text}".strip()
        return resume_text, contents
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read PDF resume: {e}")

def extract_text_from_pdf_layers(contents: bytes, pdf_reader: PdfReader) -> str:
    extractors = [
        ("pypdf", lambda: "\n".join(page.extract_text() or "" for page in pdf_reader.pages)),
        ("pymupdf", lambda: extract_text_with_pymupdf(contents)),
        ("pdfminer", lambda: extract_text_with_pdfminer(contents)),
    ]
    best_text = ""
    for name, extractor in extractors:
        try:
            text = extractor() or ""
        except Exception as e:
            print(f"{name} resume text extraction failed: {e}")
            continue
        if len(text.strip()) > len(best_text.strip()):
            best_text = text
        if len(best_text.strip()) >= 80:
            break
    return best_text.strip()

def extract_text_with_pymupdf(contents: bytes) -> str:
    try:
        import fitz
    except Exception:
        return ""
    with fitz.open(stream=contents, filetype="pdf") as doc:
        return "\n".join(page.get_text("text") for page in doc)

def extract_text_with_pdfminer(contents: bytes) -> str:
    try:
        from pdfminer.high_level import extract_text
    except Exception:
        return ""
    return extract_text(io.BytesIO(contents)) or ""

def extract_text_from_image_pdf(pdf_reader: PdfReader) -> str:
    image_bytes: List[bytes] = []
    for page in pdf_reader.pages[:3]:
        try:
            page_images = list(getattr(page, "images", []))[:3]
        except Exception as e:
            print(f"Resume image extraction unavailable: {e}")
            page_images = []
        for image in page_images:
            data = getattr(image, "data", None)
            if data and len(data) > 1024:
                image_bytes.append(data)
    if not image_bytes:
        return ""

    tesseract_text = extract_text_with_optional_tesseract(image_bytes)
    if tesseract_text.strip():
        return tesseract_text

    rapidocr_text = extract_text_with_rapidocr(image_bytes)
    if rapidocr_text.strip():
        return rapidocr_text

    return extract_text_with_openai_vision(image_bytes)

def extract_text_with_optional_tesseract(image_bytes: List[bytes]) -> str:
    if not shutil.which("tesseract"):
        return ""
    try:
        from PIL import Image
        import pytesseract
    except Exception:
        return ""

    chunks = []
    for data in image_bytes:
        try:
            image = Image.open(io.BytesIO(data))
            text = pytesseract.image_to_string(image)
            if text.strip():
                chunks.append(text.strip())
        except Exception as e:
            print(f"Tesseract OCR skipped one resume image: {e}")
    return "\n".join(chunks)

def extract_text_with_rapidocr(image_bytes: List[bytes]) -> str:
    try:
        import numpy as np
        from PIL import Image
        from rapidocr_onnxruntime import RapidOCR
    except Exception as e:
        print(f"RapidOCR unavailable: {e}")
        return ""

    chunks = []
    try:
        ocr = RapidOCR()
    except Exception as e:
        print(f"RapidOCR initialization failed: {e}")
        return ""

    for data in image_bytes:
        try:
            image = Image.open(io.BytesIO(data)).convert("RGB")
            result, _ = ocr(np.array(image))
            if result:
                chunks.extend(str(item[1]).strip() for item in result if len(item) > 1 and str(item[1]).strip())
        except Exception as e:
            print(f"RapidOCR skipped one resume image: {e}")
    return "\n".join(chunks)

def extract_text_with_openai_vision(image_bytes: List[bytes]) -> str:
    client = get_openai_client()
    if not client:
        return ""

    content: List[Dict[str, Any]] = [{
        "type": "text",
        "text": "Extract all readable resume text from these image-based PDF pages. Return plain text only."
    }]
    for data in image_bytes[:3]:
        content.append({
            "type": "image_url",
            "image_url": {
                "url": f"data:image/png;base64,{base64.b64encode(data).decode('ascii')}"
            }
        })

    try:
        response = client.chat.completions.create(
            model=settings.OPENAI_MODEL,
            temperature=0,
            messages=[{"role": "user", "content": content}]
        )
        return response.choices[0].message.content or ""
    except Exception as e:
        print(f"Vision OCR failed: {e}")
        return ""

def build_interview_for_position(db: Dict[str, Any], candidate: Dict[str, Any], position_id: int):
    job = db.get("positions", {}).get(str(position_id))
    if not job:
        raise HTTPException(status_code=404, detail="Selected position not found.")
    if not is_open_for_applications(job):
        raise HTTPException(status_code=400, detail="Selected position is not open for applications.")
    if find_application(candidate, position_id):
        raise HTTPException(status_code=409, detail="You have already applied for this position.")

    profile_data = candidate.get("profile_data", {})
    agent_warnings: List[str] = []
    controls = get_bias_controls(db)
    artifacts = attach_bias_artifacts_to_candidate(candidate)

    try:
        match_results = run_matching_agent(job, profile_data, controls, artifacts["bias_analysis"])
    except Exception as e:
        print(f"Error running matching agent: {e}")
        agent_warnings.append("Matching Agent failed, so a basic position-fit assessment was used.")
        match_results = apply_bias_to_match_results({
            "debate": {"critical_recruiter_cons": ["Stack verification required."], "talent_advocate_pros": ["Strong interest in the position."]},
            "scores": {"technical": 75, "domain": 70, "culture": 80, "trajectory_slope": 75}
        }, job, profile_data, controls, artifacts["bias_analysis"])

    try:
        custom_questions = run_interview_agent_phase_a(profile_data, match_results, job)
    except Exception as e:
        print(f"Error generating screening questions: {e}")
        agent_warnings.append("Interview Agent question generation failed, so standard role-focused screening questions were used.")
        custom_questions = [
            "What technical challenge on your resume was the most architecturally complex, and how did you approach it?",
            "How do you ensure code scalability and high performance when designing REST endpoints?",
            "Describe how you structure React component hierarchies for high maintainability."
        ]

    application = {
        "application_id": build_application_id(position_id),
        "position_id": position_id,
        "status": "applied",
        "applied_at": datetime.now().isoformat(timespec="seconds"),
        "progress": get_application_progress("applied"),
        "match_results": match_results,
        "custom_questions": custom_questions,
        "answers": [],
        "evaluation": {},
        "agent_warnings": agent_warnings,
        "sourcing_pitch": "Inbound applicant with verified profile details.",
        "outreach_email": candidate.get("outreach_email", "")
    }
    if agent_warnings:
        candidate.setdefault("agent_warnings", []).extend(agent_warnings)
    normalize_candidate_applications(candidate).append(application)
    sync_current_application(candidate, application)
    return application

@router.post("/signup")
async def signup_candidate(
    name: str = Form(...),
    email: str = Form(...),
    password: str = Form(...),
    resume: UploadFile = File(...)
):
    db = load_db()
    email_clean = normalize_candidate_email(email)

    if email_clean in db.setdefault("candidates", {}):
        raise HTTPException(status_code=409, detail="Candidate account already exists. Please log in.")

    require_pending_email_verified(db, email_clean)
    resume_text, contents = await read_resume_text(resume)
    validate_resume_text_for_agent(resume_text)
    profile_data, bias_artifacts, agent_warnings = run_resume_profile_upload_graph(
        resume_text,
        email_clean,
        name
    )

    return save_signup_candidate_record(
        db,
        email_clean,
        name,
        password,
        resume.filename or "resume.pdf",
        resume_text,
        contents,
        profile_data,
        bias_artifacts,
        agent_warnings
    )

@router.post("/signup/stream")
async def signup_candidate_stream(
    name: str = Form(...),
    email: str = Form(...),
    password: str = Form(...),
    resume: UploadFile = File(...)
):
    email_clean = normalize_candidate_email(email)

    def sse(payload: Dict[str, Any]) -> str:
        return f"data: {json.dumps(payload, default=str)}\n\n"

    def emit_agent_event(node: str, event_type: str, message: str, payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        payload = payload or {}
        reason = str(payload.get("reason") or payload.get("decision_reason") or message)
        payload.setdefault("reason", reason)
        payload.setdefault("decision_reason", reason)
        event = {
            "event_type": event_type,
            "node": node,
            "message": message,
            "reason": reason,
            "decision_reason": reason,
            "candidate_email": email_clean,
            "position_id": None,
            "payload": payload,
        }
        try:
            record_agent_event(event)
        except Exception as exc:
            event["payload"] = {**event["payload"], "event_logging_warning": str(exc)}
        return event

    def graph_progress(event: Dict[str, Any]) -> int:
        node = event.get("node")
        event_type = event.get("event_type")
        tool = (event.get("payload") or {}).get("tool")
        if node == "guardrail":
            return 34
        if node == "supervisor":
            return 42 if tool == "parse_resume" else 68
        if tool == "parse_resume":
            return 48 if event_type == "started" else 62
        if tool == "analyze_bias":
            return 72 if event_type == "started" else 84
        if node == "graph":
            return 90
        return 50

    async def event_stream():
        try:
            yield sse({
                "progress": 8,
                "agent_event": emit_agent_event(
                    "intake",
                    "started",
                    "Resume Intake Agent received the signup upload."
                )
            })
            db = load_db()
            if email_clean in db.setdefault("candidates", {}):
                raise HTTPException(status_code=409, detail="Candidate account already exists. Please log in.")

            yield sse({
                "progress": 18,
                "agent_event": emit_agent_event(
                    "guardrail",
                    "started",
                    "Guardrail Agent is checking email verification and upload eligibility."
                )
            })
            require_pending_email_verified(db, email_clean)

            yield sse({
                "progress": 26,
                "agent_event": emit_agent_event(
                    "tool",
                    "started",
                    "Resume Intake Agent is extracting readable PDF text."
                )
            })
            resume_text, contents = await read_resume_text(resume)
            validate_resume_text_for_agent(resume_text)
            yield sse({
                "progress": 30,
                "agent_event": emit_agent_event(
                    "tool",
                    "completed",
                    "Resume Intake Agent extracted readable resume text.",
                    {"text_length": len(resume_text or "")}
                )
            })

            graph_state = recruiting_agent_graph._initial_state({
                "task_type": "resume_profile",
                "candidate_email": email_clean,
                "input": {
                    "candidate_email": email_clean,
                    "resume_text": resume_text,
                    "supervisor_use_llm": False,
                    "resume_use_llm": False,
                    "bias_use_llm": False,
                    "status": "profile",
                    "source_type": "inbound",
                    "source_method": "resume_agent_graph",
                }
            })
            for event in recruiting_agent_graph.stream(graph_state):
                yield sse({"progress": graph_progress(event), "agent_event": event})

            if graph_state.get("blocked"):
                raise HTTPException(
                    status_code=400,
                    detail=graph_state.get("guardrail", {}).get("reason", "Resume upload was blocked by agent guardrails.")
                )

            artifacts = graph_state.get("artifacts", {}) or {}
            profile_data = artifacts.get("candidate_profile")
            agent_warnings = list(graph_state.get("agent_warnings", []))
            if not isinstance(profile_data, dict) or not profile_data:
                agent_warnings.append("Resume Agent returned no profile, so its deterministic parser fallback was used.")
                profile_data = parse_resume_text_fallback(resume_text)

            validate_resume_agent_profile(profile_data, name)
            profile_data = normalize_profile_details(apply_resume_extraction_warning(profile_data, resume_text))
            bias_artifacts = build_candidate_bias_artifacts(
                profile_data,
                resume_text,
                artifacts.get("prestige_analysis") if isinstance(artifacts.get("prestige_analysis"), dict) else None,
                use_llm=False
            )

            yield sse({
                "progress": 94,
                "agent_event": emit_agent_event(
                    "tool",
                    "started",
                    "Persistence Agent is saving the candidate profile to Supabase."
                )
            })
            response = save_signup_candidate_record(
                db,
                email_clean,
                name,
                password,
                resume.filename or "resume.pdf",
                resume_text,
                contents,
                profile_data,
                bias_artifacts,
                agent_warnings
            )
            yield sse({
                "progress": 100,
                "agent_event": emit_agent_event(
                    "graph",
                    "final",
                    "Candidate signup agent graph completed."
                ),
                "result": response
            })
        except HTTPException as exc:
            yield sse({
                "error": exc.detail,
                "agent_event": emit_agent_event(
                    "guardrail",
                    "blocked" if exc.status_code in {400, 403, 409} else "failed",
                    str(exc.detail),
                    {"status_code": exc.status_code}
                )
            })
        except Exception as exc:
            print(f"Signup stream failed: {exc}")
            yield sse({
                "error": str(exc) or "Resume upload failed while the agent graph was processing it. Please try again.",
                "agent_event": emit_agent_event(
                    "graph",
                    "failed",
                    "Signup agent graph failed during resume processing.",
                    {"error": str(exc)}
                )
            })

    return StreamingResponse(event_stream(), media_type="text/event-stream")

@router.post("/{email}/apply-position/stream")
def apply_candidate_to_position_stream(email: str, payload: CandidateApplyPositionPayload):
    email_clean = normalize_candidate_email(email)
    position_id = payload.position_id

    def sse(payload_data: Dict[str, Any]) -> str:
        return f"data: {json.dumps(payload_data, default=str)}\n\n"

    def emit_agent_event(node: str, event_type: str, message: str, event_payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        event_payload = event_payload or {}
        reason = str(event_payload.get("reason") or event_payload.get("decision_reason") or message)
        event_payload.setdefault("reason", reason)
        event_payload.setdefault("decision_reason", reason)
        event = {
            "event_type": event_type,
            "node": node,
            "message": message,
            "reason": reason,
            "decision_reason": reason,
            "candidate_email": email_clean,
            "position_id": position_id,
            "payload": event_payload,
        }
        try:
            record_agent_event(event)
        except Exception as exc:
            event["payload"] = {**event["payload"], "event_logging_warning": str(exc)}
        return event

    def graph_progress(event: Dict[str, Any]) -> int:
        node = event.get("node")
        event_type = event.get("event_type")
        tool = (event.get("payload") or {}).get("tool")
        progress_by_tool = {
            "analyze_bias": (28, 36),
            "match_candidate": (46, 58),
            "generate_screening_questions": (68, 78),
            "create_or_update_application": (86, 94),
        }
        if node == "guardrail":
            return 18
        if node == "supervisor":
            return 22
        if tool in progress_by_tool:
            started, completed = progress_by_tool[tool]
            return started if event_type == "started" else completed
        if node == "graph":
            return 96
        return 40

    def event_stream():
        try:
            yield sse({
                "progress": 8,
                "agent_event": emit_agent_event(
                    "intake",
                    "started",
                    "Application Setup Agent received the selected position."
                )
            })
            db = load_db()
            candidate = db.setdefault("candidates", {}).get(email_clean)
            if not candidate:
                raise HTTPException(status_code=404, detail="Candidate account not found.")
            if candidate.get("email_verified", True) is False:
                raise HTTPException(status_code=403, detail="Please verify your email address before applying.")
            if find_application(candidate, position_id):
                raise HTTPException(status_code=409, detail="You have already applied for this position.")

            job = db.get("positions", {}).get(str(position_id))
            if not job:
                raise HTTPException(status_code=404, detail="Selected position not found.")
            if not is_open_for_applications(job):
                raise HTTPException(status_code=400, detail="Selected position is not open for applications.")

            yield sse({
                "progress": 14,
                "agent_event": emit_agent_event(
                    "guardrail",
                    "started",
                    "Guardrail Agent is checking application eligibility and candidate profile safety."
                )
            })
            graph_state = recruiting_agent_graph._initial_state({
                "task_type": "existing_candidate_application",
                "candidate_email": email_clean,
                "position_id": position_id,
                "input": {
                    "candidate_email": email_clean,
                    "position_id": position_id,
                    "candidate_profile": candidate.get("profile_data", {}),
                    "profile_data": candidate.get("profile_data", {}),
                    "job_requirements": job,
                    "supervisor_use_llm": False,
                    "bias_use_llm": False,
                    "status": "applied",
                }
            })
            for event in recruiting_agent_graph.stream(graph_state):
                yield sse({"progress": graph_progress(event), "agent_event": event})

            if graph_state.get("blocked"):
                raise HTTPException(
                    status_code=400,
                    detail=graph_state.get("guardrail", {}).get("reason", "Application setup blocked by guardrails.")
                )

            artifacts = graph_state.get("artifacts", {}) or {}
            db = load_db()
            candidate = db.setdefault("candidates", {}).get(email_clean)
            if not candidate:
                raise HTTPException(status_code=404, detail="Candidate account not found after graph processing.")
            application = find_application(candidate, position_id)
            if not application:
                application = {
                    "application_id": build_application_id(position_id),
                    "position_id": position_id,
                    "status": "applied",
                    "applied_at": datetime.now().isoformat(timespec="seconds"),
                    "progress": get_application_progress("applied"),
                    "match_results": artifacts.get("match_results") or {},
                    "custom_questions": artifacts.get("custom_questions") or [],
                    "answers": [],
                    "evaluation": {},
                    "agent_warnings": graph_state.get("agent_warnings", []),
                    "sourcing_pitch": "Inbound applicant with verified profile details.",
                    "outreach_email": candidate.get("outreach_email", "")
                }
                normalize_candidate_applications(candidate).append(application)
            else:
                application["match_results"] = application.get("match_results") or artifacts.get("match_results") or {}
                application["custom_questions"] = application.get("custom_questions") or artifacts.get("custom_questions") or []
                application.setdefault("agent_warnings", []).extend(graph_state.get("agent_warnings", []))
            sync_current_application(candidate, application)
            add_notification(candidate, "Application started", "Your personalized interview questions are ready.", "application", position_id)
            save_db(db)
            yield sse({
                "progress": 100,
                "agent_event": emit_agent_event(
                    "graph",
                    "final",
                    "Application Setup Agent completed the profile match and screening question setup."
                ),
                "result": serialize_application_candidate(candidate, email_clean, application)
            })
        except HTTPException as exc:
            yield sse({
                "error": exc.detail,
                "agent_event": emit_agent_event(
                    "guardrail" if exc.status_code in {400, 403, 409} else "graph",
                    "blocked" if exc.status_code in {400, 403, 409} else "failed",
                    str(exc.detail),
                    {"status_code": exc.status_code}
                )
            })
        except Exception as exc:
            yield sse({
                "error": str(exc) or "Application setup failed while the agent graph was processing it.",
                "agent_event": emit_agent_event(
                    "graph",
                    "failed",
                    "Application Setup Agent failed before completion.",
                    {"error": str(exc)}
                )
            })

    return StreamingResponse(event_stream(), media_type="text/event-stream")

@router.post("/{email}/apply-position")
def apply_candidate_to_position(email: str, payload: CandidateApplyPositionPayload):
    db = load_db()
    email_clean = normalize_candidate_email(email)
    candidate = db.setdefault("candidates", {}).get(email_clean)
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate account not found.")
    if candidate.get("email_verified", True) is False:
        raise HTTPException(status_code=403, detail="Please verify your email address before applying.")

    application = build_interview_for_position(db, candidate, payload.position_id)
    add_notification(candidate, "Application started", "Your personalized interview questions are ready.", "application", payload.position_id)
    save_db(db)
    return serialize_application_candidate(candidate, email_clean, application)

@router.patch("/{email}/draft-answers")
def save_candidate_draft_answers(email: str, payload: DraftAnswersPayload):
    db = load_db()
    email_clean = normalize_candidate_email(email)
    candidate = db.setdefault("candidates", {}).get(email_clean)
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate account not found.")
    application = find_application(candidate, payload.position_id)
    if not application:
        raise HTTPException(status_code=404, detail="Candidate application not found.")
    if application.get("answers"):
        raise HTTPException(status_code=409, detail="This position already has submitted interview answers.")
    application["draft_answers"] = payload.answers
    candidate.setdefault("draft_answers", {})[str(application.get("position_id"))] = payload.answers
    sync_current_application(candidate, application)
    save_db(db)
    return serialize_application_candidate(candidate, email_clean, application)

@router.patch("/{email}/notifications/read")
def mark_candidate_notifications_read(email: str, payload: NotificationReadPayload):
    db = load_db()
    email_clean = normalize_candidate_email(email)
    candidate = db.setdefault("candidates", {}).get(email_clean)
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate account not found.")
    for notification in candidate.get("notifications", []):
        if payload.notification_id is None or notification.get("id") == payload.notification_id:
            notification["read"] = True
    save_db(db)
    return serialize_candidate(candidate, email_clean)

@router.patch("/{email}/status")
def update_candidate_status(email: str, payload: CandidateStatusPayload):
    allowed_statuses = {"profile", "staged", "invited", "applied", "screening", "completed", "hired", "inactive", "rejected", "interview_scheduled"}
    if payload.status not in allowed_statuses:
        raise HTTPException(status_code=400, detail="Unsupported candidate status.")

    db = load_db()
    email_clean = email.strip().lower()
    candidate = db.setdefault("candidates", {}).get(email_clean)
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found.")

    application = find_application(candidate, payload.position_id)
    if payload.position_id and not application:
        raise HTTPException(status_code=404, detail="Candidate application not found.")
    smtp_configured = is_smtp_configured()
    email_receipt: Dict[str, Any] = {"sent": False, "smtp_configured": smtp_configured}
    if application:
        # Track previous status in history (max 10 entries)
        previous_status = application.get("status")
        if previous_status and previous_status != payload.status:
            history = application.setdefault("status_history", [])
            history.append(previous_status)
            application["status_history"] = history[-10:]
        application["status"] = payload.status
        application["progress"] = get_application_progress(payload.status)
        if payload.status == "hired":
            application["hired_at"] = datetime.now().isoformat(timespec="seconds")
            add_notification(candidate, "Application decision", "Congratulations. You have been hired for this position.", "success", payload.position_id)
            email_receipt = send_decision_email(email_clean, "Application update - hired", "Congratulations. The hiring team has marked your application as hired. Please check the candidate portal for details.")
        sync_current_application(candidate, application)
    else:
        previous_status = candidate.get("status")
        if previous_status and previous_status != payload.status:
            history = candidate.setdefault("status_history", [])
            history.append(previous_status)
            candidate["status_history"] = history[-10:]
        candidate["status"] = payload.status
        if payload.status == "hired":
            candidate["hired_at"] = datetime.now().isoformat(timespec="seconds")
            add_notification(candidate, "Application decision", "Congratulations. You have been hired.", "success")
            email_receipt = send_decision_email(email_clean, "Application update - hired", "Congratulations. The hiring team has marked your application as hired. Please check the candidate portal for details.")
    save_db(db)
    result = serialize_candidate(candidate, email_clean)
    result["email_sent"] = _email_sent(email_receipt)
    result["email_receipt"] = email_receipt
    result["smtp_configured"] = smtp_configured
    return result

@router.post("/{email}/revert-status")
def revert_candidate_status(email: str, payload: RevertStatusPayload):
    """Undo the last status change for a candidate application."""
    db = load_db()
    email_clean = email.strip().lower()
    candidate = db.setdefault("candidates", {}).get(email_clean)
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found.")

    application = find_application(candidate, payload.position_id)
    target = application if application else candidate

    history = target.get("status_history", [])
    if not history:
        raise HTTPException(status_code=400, detail="No status history available to revert.")

    current_status = target.get("status")
    previous_status = history[-1]
    target["status_history"] = history[:-1]
    target["status"] = previous_status
    target["progress"] = get_application_progress(previous_status)

    # Clean up status-specific fields when reverting
    if current_status == "interview_scheduled":
        target.pop("interview_slot", None)
    if current_status == "rejected":
        target["rejection_message"] = ""
        target["rejected_at"] = None
    if current_status == "hired":
        target["hired_at"] = None

    if application:
        sync_current_application(candidate, application)

    save_db(db)
    return serialize_candidate(candidate, email_clean)


@router.delete("/{email}")
def delete_candidate(email: str):
    db = load_db()
    email_clean = email.strip().lower()
    candidates = db.setdefault("candidates", {})
    if email_clean not in candidates:
        raise HTTPException(status_code=404, detail="Candidate not found.")

    deleted = candidates.pop(email_clean)
    save_db(db)
    return {"deleted": True, "candidate": serialize_candidate(deleted, email_clean)}

@router.get("/{email}/resume")
def get_candidate_resume(email: str):
    db = load_db()
    email_clean = email.strip().lower()
    candidate = db.get("candidates", {}).get(email_clean)
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate account not found.")
    resume_path = candidate.get("resume_path")
    if not resume_path or not os.path.exists(resume_path):
        raise HTTPException(status_code=404, detail="Original resume file is not available.")
    return FileResponse(
        resume_path,
        media_type="application/pdf",
        filename=candidate.get("resume_filename") or "resume.pdf",
        headers={"Content-Disposition": f"inline; filename=\"{candidate.get('resume_filename') or 'resume.pdf'}\""}
    )

@router.post("/apply")
async def apply_inbound(
    name: str = Form(...),
    email: str = Form(...),
    position_id: int = Form(...),
    password: str = Form(...),
    resume: UploadFile = File(...)
):
    db = load_db()
    email_clean = normalize_candidate_email(email)
    existing_candidate = db.setdefault("candidates", {}).get(email_clean)
    if existing_candidate and find_application(existing_candidate, position_id):
        raise HTTPException(status_code=409, detail="You have already applied for this position.")
    if not existing_candidate:
        require_pending_email_verified(db, email_clean)
    resume_text, contents = await read_resume_text(resume)
    validate_resume_text_for_agent(resume_text)
    agent_warnings: List[str] = []

    job = db.get("positions", {}).get(str(position_id))
    if not job:
        raise HTTPException(status_code=404, detail="Selected position not found.")
    if not is_open_for_applications(job):
        raise HTTPException(status_code=400, detail="Selected position is not open for applications.")

    try:
        graph_result = run_agent_graph("inbound_application", {
            "candidate_email": email_clean,
            "position_id": position_id,
            "input": {
                "candidate_email": email_clean,
                "position_id": position_id,
                "resume_text": resume_text,
                "job_requirements": job,
                "supervisor_use_llm": False,
                "resume_use_llm": False,
                "bias_use_llm": False,
                "status": "applied",
            }
        })
        if graph_result.get("blocked"):
            raise HTTPException(status_code=400, detail=graph_result.get("guardrail", {}).get("reason", "Application input blocked by guardrails."))
        artifacts = graph_result.get("artifacts", {})
        profile_data = artifacts.get("candidate_profile") or parse_resume_text_fallback(resume_text)
        validate_resume_agent_profile(profile_data, name)
        profile_data = normalize_profile_details(apply_resume_extraction_warning(profile_data, resume_text))
        bias_analysis = artifacts.get("prestige_analysis") or analyze_prestige_indicators(profile_data, resume_text, use_llm=False)
        bias_artifacts = {
            "bias_analysis": bias_analysis,
            "neutralized_profile_data": neutralize_candidate_profile(profile_data, bias_analysis)
        }
        match_results = artifacts.get("match_results") or build_fast_match_results(job, profile_data, get_bias_controls(db), bias_artifacts["bias_analysis"])
        custom_questions = artifacts.get("custom_questions") or run_interview_agent_phase_a(profile_data, match_results, job)
        agent_warnings.extend(graph_result.get("agent_warnings", []))
    except Exception as e:
        if isinstance(e, HTTPException):
            raise
        print(f"Error running inbound agent graph: {e}")
        agent_warnings.append("Agent graph failed, so the legacy resume and screening pipeline was used.")
        profile_data = parse_resume_text_fallback(resume_text)
        validate_resume_agent_profile(profile_data, name)
        profile_data = normalize_profile_details(apply_resume_extraction_warning(profile_data, resume_text))
        controls = get_bias_controls(db)
        bias_artifacts = build_candidate_bias_artifacts(profile_data, resume_text, use_llm=False)
        match_results = build_fast_match_results(job, profile_data, controls, bias_artifacts["bias_analysis"])
        custom_questions = [
            "What technical challenge on your resume was the most architecturally complex, and how did you approach it?",
            "How do you ensure code scalability and high performance when designing REST endpoints?",
            "Describe how you structure React component hierarchies for high maintainability."
        ]
        
    resume_path = save_resume_file(email_clean, resume.filename or "resume.pdf", contents)
    resume_summary = get_resume_summary(profile_data, resume_text)
    applied_at = datetime.now().isoformat(timespec="seconds")
    application = {
        "application_id": build_application_id(position_id),
        "position_id": position_id,
        "status": "applied",
        "applied_at": applied_at,
        "progress": get_application_progress("applied"),
        "match_results": match_results,
        "custom_questions": custom_questions,
        "answers": [],
        "evaluation": {},
        "sourcing_pitch": "Inbound applicant with verified profile details.",
        "outreach_email": "Thank you for applying!"
    }

    parsed_name = profile_data.get("name") if profile_data.get("name") and profile_data.get("name") != "Candidate Full Name" else name

    candidate_record = {
        "name": parsed_name,
        "email": email_clean,
        "status": "applied",
        "position_id": position_id,
        "applied_at": applied_at,
        "is_sourced": False,
        "source_type": "inbound",
        "source_method": "resume",
        "linkedin_url": "",
        "profile_data": profile_data,
        "bias_analysis": bias_artifacts["bias_analysis"],
        "neutralized_profile_data": bias_artifacts["neutralized_profile_data"],
        "resume_filename": resume.filename,
        "resume_path": resume_path,
        "resume_url": f"/api/v1/candidates/{email_clean}/resume",
        "resume_text": resume_text,
        "resume_summary": resume_summary,
        "profile_picture_url": existing_candidate.get("profile_picture_url", "") if existing_candidate else "",
        "sourcing_pitch": "Inbound applicant with verified profile details.",
        "outreach_email": "Thank you for applying!",
        "match_results": match_results,
        "custom_questions": custom_questions,
        "answers": [],
        "evaluation": {},
        "agent_warnings": agent_warnings,
        "applications": [application],
        "notifications": [],
        "outreach_history": [],
        "profile_verified": not get_missing_profile_fields(profile_data),
        "email_verified": True if not existing_candidate else bool(existing_candidate.get("email_verified", True)),
        "email_verified_at": datetime.now().isoformat(timespec="seconds") if not existing_candidate else existing_candidate.get("email_verified_at"),
        "password_hash": hash_password(password)
    }

    db.setdefault("candidates", {})[email_clean] = candidate_record
    db.setdefault("pending_email_verifications", {}).pop(email_clean, None)
    save_db(db)
    response = serialize_candidate(candidate_record, email_clean)
    return response

@router.post("/{email}/sandbox/stream")
def submit_sandbox_stream(email: str, payload: SandboxAnswers):
    email_clean = email.strip().lower()
    position_id = payload.position_id

    def sse(payload_data: Dict[str, Any]) -> str:
        return f"data: {json.dumps(payload_data, default=str)}\n\n"

    def emit_agent_event(node: str, event_type: str, message: str, event_payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        event_payload = event_payload or {}
        reason = str(event_payload.get("reason") or event_payload.get("decision_reason") or message)
        event_payload.setdefault("reason", reason)
        event_payload.setdefault("decision_reason", reason)
        event = {
            "event_type": event_type,
            "node": node,
            "message": message,
            "reason": reason,
            "decision_reason": reason,
            "candidate_email": email_clean,
            "position_id": position_id,
            "payload": event_payload,
        }
        try:
            record_agent_event(event)
        except Exception as exc:
            event["payload"] = {**event["payload"], "event_logging_warning": str(exc)}
        return event

    def graph_progress(event: Dict[str, Any]) -> int:
        node = event.get("node")
        event_type = event.get("event_type")
        tool = (event.get("payload") or {}).get("tool")
        progress_by_tool = {
            "evaluate_screening_answers": (26, 44),
            "generate_report": (52, 62),
            "save_screening_evaluation": (70, 76),
            "update_application_status": (82, 86),
            "plan_candidate_email": (90, 93),
            "send_agent_email": (96, 98),
        }
        if node == "guardrail":
            return 16
        if node == "supervisor":
            return 20
        if tool in progress_by_tool:
            started, completed = progress_by_tool[tool]
            return started if event_type == "started" else completed
        if node == "graph":
            return 99
        return 40

    def event_stream():
        try:
            db = load_db()
            candidate = db.setdefault("candidates", {}).get(email_clean)
            if not candidate:
                raise HTTPException(status_code=404, detail="Candidate not found.")
            application = find_application(candidate, position_id)
            if not application:
                raise HTTPException(status_code=404, detail="Candidate application not found.")
            if application.get("answers"):
                raise HTTPException(status_code=409, detail="This position's interview has already been submitted.")

            for idx, ans in enumerate(payload.answers):
                if len(ans.strip()) < 10:
                    raise HTTPException(status_code=400, detail=f"Answer for Question {idx+1} is too short. (Minimum 10 characters)")

            job_id = application.get("position_id")
            job = db.get("positions", {}).get(str(job_id), {})
            application["draft_answers"] = payload.answers
            candidate.setdefault("draft_answers", {})[str(application.get("position_id"))] = payload.answers
            save_db(db)

            yield sse({
                "progress": 8,
                "agent_event": emit_agent_event(
                    "intake",
                    "started",
                    "Screening Evaluation Agent received the candidate answers."
                )
            })
            graph_state = recruiting_agent_graph._initial_state({
                "task_type": "sandbox_evaluation",
                "candidate_email": email_clean,
                "position_id": job_id,
                "input": {
                    "candidate_email": email_clean,
                    "position_id": job_id,
                    "questions": application.get("custom_questions", []),
                    "answers": payload.answers,
                    "job_requirements": job,
                    "candidate_profile": candidate.get("profile_data", {}),
                    "match_results": application.get("match_results") or candidate.get("match_results", {}),
                    "supervisor_use_llm": False,
                    "status": application.get("status", "applied"),
                }
            })
            for event in recruiting_agent_graph.stream(graph_state):
                yield sse({"progress": graph_progress(event), "agent_event": event})

            if graph_state.get("blocked"):
                raise HTTPException(
                    status_code=400,
                    detail=graph_state.get("guardrail", {}).get("reason", "Screening answers blocked by guardrails.")
                )

            artifacts = graph_state.get("artifacts", {}) or {}
            evaluation = artifacts.get("evaluation") or build_position_specific_evaluation(application.get("custom_questions", []), payload.answers, job)
            report_data = artifacts.get("report") or {}
            roadmap = report_data.get("upskilling_roadmap", {})
            next_status = (
                "rejected"
                if int(evaluation.get("screening_score", 100) or 100) <= settings.AGENT_REJECT_MAX_SCREENING_SCORE
                and str(evaluation.get("hiring_recommendation", "")).lower() == "reject"
                else "screening"
            )
            db = load_db()
            candidate = db.setdefault("candidates", {}).get(email_clean)
            if not candidate:
                raise HTTPException(status_code=404, detail="Candidate not found after graph processing.")
            application = find_application(candidate, job_id)
            if not application:
                raise HTTPException(status_code=404, detail="Candidate application not found after graph processing.")
            application["status"] = next_status
            application["progress"] = get_application_progress(next_status)
            application["answers"] = payload.answers
            application["draft_answers"] = payload.answers
            application["screening_submitted_at"] = application.get("screening_submitted_at") or datetime.now().isoformat(timespec="seconds")
            application.pop("last_agent_error", None)
            candidate.pop("last_agent_error", None)
            application["evaluation"] = {
                "screening_score": evaluation.get("screening_score", 80),
                "critiques": evaluation.get("question_feedback") or evaluation.get("critiques", []),
                "question_feedback": evaluation.get("question_feedback") or evaluation.get("critiques", []),
                "score_breakdown": evaluation.get("score_breakdown", {}),
                "position_fit_verdict": evaluation.get("position_fit_verdict", ""),
                "hiring_recommendation": evaluation.get("hiring_recommendation", ""),
                "decision_reason": evaluation.get("decision_reason", ""),
                "role_alignment_summary": evaluation.get("role_alignment_summary", ""),
                "upskilling_roadmap": roadmap
            }
            if graph_state.get("agent_warnings"):
                application.setdefault("agent_warnings", []).extend(graph_state.get("agent_warnings", []))
                candidate.setdefault("agent_warnings", []).extend(graph_state.get("agent_warnings", []))
            sync_current_application(candidate, application)
            save_db(db)
            yield sse({
                "progress": 100,
                "agent_event": emit_agent_event(
                    "graph",
                    "final",
                    "Screening Evaluation Agent completed feedback, status update, and action policy review."
                ),
                "result": serialize_application_candidate(candidate, email_clean, application)
            })
        except HTTPException as exc:
            yield sse({
                "error": exc.detail,
                "agent_event": emit_agent_event(
                    "guardrail" if exc.status_code in {400, 403, 409} else "graph",
                    "blocked" if exc.status_code in {400, 403, 409} else "failed",
                    str(exc.detail),
                    {"status_code": exc.status_code}
                )
            })
        except Exception as exc:
            print(f"Sandbox stream failed: {exc}")
            yield sse({
                "error": str(exc) or "Unable to evaluate your answers. Please try again.",
                "agent_event": emit_agent_event(
                    "graph",
                    "failed",
                    "Screening Evaluation Agent failed before completion.",
                    {"error": str(exc)}
                )
            })

    return StreamingResponse(event_stream(), media_type="text/event-stream")

@router.post("/{email}/sandbox")
def submit_sandbox(email: str, payload: SandboxAnswers):
    db = load_db()
    email_clean = email.strip().lower()
    candidate = db.setdefault("candidates", {}).get(email_clean)
    
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found.")
    application = find_application(candidate, payload.position_id)
    if not application:
        raise HTTPException(status_code=404, detail="Candidate application not found.")
    if application.get("answers"):
        raise HTTPException(status_code=409, detail="This position's interview has already been submitted.")
        
    # Validate answers length
    for idx, ans in enumerate(payload.answers):
        if len(ans.strip()) < 10:
            raise HTTPException(status_code=400, detail=f"Answer for Question {idx+1} is too short. (Minimum 10 characters)")
            
    application["answers"] = payload.answers
    application["draft_answers"] = payload.answers
    application["screening_submitted_at"] = datetime.now().isoformat(timespec="seconds")
    candidate.setdefault("draft_answers", {})[str(application.get("position_id"))] = payload.answers

    # Fetch job requirements
    job_id = application.get("position_id")
    job = db.get("positions", {}).get(str(job_id), {})
    
    agent_warnings: List[str] = []
    try:
        graph_result = run_agent_graph("sandbox_evaluation", {
            "candidate_email": email_clean,
            "position_id": job_id,
            "input": {
                "candidate_email": email_clean,
                "position_id": job_id,
                "questions": application.get("custom_questions", []),
                "answers": payload.answers,
                "job_requirements": job,
                "candidate_profile": candidate.get("profile_data", {}),
                "match_results": application.get("match_results") or candidate.get("match_results", {}),
                "supervisor_use_llm": False,
                }
        })
        if graph_result.get("blocked"):
            raise HTTPException(status_code=400, detail=graph_result.get("guardrail", {}).get("reason", "Screening answers blocked by guardrails."))
        artifacts = graph_result.get("artifacts", {})
        evaluation = artifacts.get("evaluation") or build_position_specific_evaluation(application.get("custom_questions", []), payload.answers, job)
        report_data = artifacts.get("report") or {}
        roadmap = report_data.get("upskilling_roadmap", {})
        agent_warnings.extend(graph_result.get("agent_warnings", []))
    except Exception as e:
        if isinstance(e, HTTPException):
            raise
        print(f"Error evaluating sandbox answers: {e}")
        agent_warnings.append("Agent graph failed, so a basic response review was used.")
        evaluation = build_position_specific_evaluation(application.get("custom_questions", []), payload.answers, job)
        roadmap = {}
        
    next_status = (
        "rejected"
        if int(evaluation.get("screening_score", 100) or 100) <= settings.AGENT_REJECT_MAX_SCREENING_SCORE
        and str(evaluation.get("hiring_recommendation", "")).lower() == "reject"
        else "screening"
    )
    application["status"] = next_status
    application["progress"] = get_application_progress(next_status)
    application.pop("last_agent_error", None)
    candidate.pop("last_agent_error", None)
    application["evaluation"] = {
        "screening_score": evaluation.get("screening_score", 80),
        "critiques": evaluation.get("question_feedback") or evaluation.get("critiques", []),
        "question_feedback": evaluation.get("question_feedback") or evaluation.get("critiques", []),
        "score_breakdown": evaluation.get("score_breakdown", {}),
        "position_fit_verdict": evaluation.get("position_fit_verdict", ""),
        "hiring_recommendation": evaluation.get("hiring_recommendation", ""),
        "decision_reason": evaluation.get("decision_reason", ""),
        "role_alignment_summary": evaluation.get("role_alignment_summary", ""),
        "upskilling_roadmap": roadmap
    }
    if agent_warnings:
        application.setdefault("agent_warnings", []).extend(agent_warnings)
        candidate.setdefault("agent_warnings", []).extend(agent_warnings)
    sync_current_application(candidate, application)
    
    save_db(db)
    return serialize_application_candidate(candidate, email_clean, application)

@router.post("/scrape")
def scrape_profile(payload: ScrapePayload):
    db = load_db()

    # Fetch job requirements
    job = db.get("positions", {}).get(str(payload.position_id))
    if not job:
        raise HTTPException(status_code=404, detail="Selected position not found.")

    try:
        profile_data = scrape_live_linkedin_profile(payload.linkedin_url.strip())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))

    candidate_name = profile_data["name"]
    candidate_email = profile_data["email"]
    controls = get_bias_controls(db)
    try:
        graph_result = run_agent_graph("sourced_candidate", {
            "candidate_email": candidate_email,
            "position_id": payload.position_id,
            "input": {
                "candidate_email": candidate_email,
                "position_id": payload.position_id,
                "candidate_profile": profile_data,
                "job_requirements": job,
                "supervisor_use_llm": False,
                "bias_use_llm": False,
                "source_method": profile_data.get("source_method", "manual_apify"),
            }
        })
        if graph_result.get("blocked"):
            raise HTTPException(status_code=400, detail=graph_result.get("guardrail", {}).get("reason", "LinkedIn profile blocked by guardrails."))
        artifacts = graph_result.get("artifacts", {})
        bias_analysis = artifacts.get("prestige_analysis") or analyze_prestige_indicators(profile_data)
        bias_artifacts = {
            "bias_analysis": bias_analysis,
            "neutralized_profile_data": neutralize_candidate_profile(profile_data, bias_analysis)
        }
        match_results = artifacts.get("match_results") or build_fast_match_results(job, profile_data, controls, bias_artifacts["bias_analysis"])
        custom_questions = artifacts.get("custom_questions") or run_interview_agent_phase_a(profile_data, match_results, job)
        report_data = artifacts.get("report") or build_fast_outreach(profile_data, job)
        sourcing_pitch = report_data.get("sourcing_pitch", "")
        outreach_email = report_data.get("outreach_email", "")
    except Exception as e:
        if isinstance(e, HTTPException):
            raise
        print(f"Scraper report synthesis error: {e}")
        bias_artifacts = build_candidate_bias_artifacts(profile_data)
        match_results = build_fast_match_results(job, profile_data, controls, bias_artifacts["bias_analysis"])
        custom_questions = run_interview_agent_phase_a(profile_data, match_results, job)
        report_data = build_fast_outreach(profile_data, job)
        sourcing_pitch = report_data["sourcing_pitch"]
        outreach_email = report_data["outreach_email"]

    staged_candidate = {
        "name": candidate_name,
        "email": candidate_email,
        "status": "staged",
        "position_id": payload.position_id,
        "is_sourced": True,
        "source_type": "linkedin",
        "source_method": profile_data.get("source_method", "manual_apify"),
        "linkedin_url": profile_data.get("source_url") or payload.linkedin_url,
        "profile_data": profile_data,
        "bias_analysis": bias_artifacts["bias_analysis"],
        "neutralized_profile_data": bias_artifacts["neutralized_profile_data"],
        "sourcing_pitch": sourcing_pitch,
        "outreach_email": outreach_email,
        "match_results": match_results,
        "custom_questions": custom_questions,
        "answers": [],
        "evaluation": {},
        "notifications": [],
        "outreach_history": []
    }
    
    # Store staged candidate in database staging state
    db.setdefault("candidates", {})[candidate_email] = staged_candidate
    save_db(db)
    
    return serialize_candidate(staged_candidate, candidate_email)

@router.post("/auto-source")
def auto_source_candidates(payload: AutoSourcePayload):
    db = load_db()
    job = db.get("positions", {}).get(str(payload.position_id))
    if not job:
        raise HTTPException(status_code=404, detail="Selected position not found.")
    controls = get_bias_controls(db)

    def event_generator():
        import json
        generated = []
        
        # Check if Apify API Token is configured for live sourcing
        if settings.APIFY_API_TOKEN.strip():
            try:
                from apify_client import ApifyClient
                from apify_client.errors import ApifyApiError
                client = ApifyClient(settings.APIFY_API_TOKEN.strip())
                
                yield f"data: {json.dumps({'log': 'Initializing Apify search client...'})}\n\n"
                
                is_combined_actor = (
                    settings.APIFY_SEARCH_ACTOR_ID == "M2FMdjRVeF1HPGFcc" or 
                    "profile-search" in settings.APIFY_SEARCH_ACTOR_ID or
                    "harvestapi" in settings.APIFY_SEARCH_ACTOR_ID
                )
                
                if is_combined_actor:
                    yield f"data: {json.dumps({'log': 'Starting combined search and scrape actor (M2FMdjRVeF1HPGFcc)...'})}\n\n"
                    boolean_query = job.get("boolean_queries") or f'("{job.get("title")}")'
                    search_input = {
                        "profileScraperMode": "Full",
                        "searchQuery": boolean_query,
                        "maxItems": payload.count,
                    }
                    if settings.LINKEDIN_LI_AT_COOKIE.strip():
                        search_input["cookies"] = [{"name": "li_at", "value": settings.LINKEDIN_LI_AT_COOKIE.strip()}]
                        
                    search_run = client.actor(settings.APIFY_SEARCH_ACTOR_ID).call(
                        run_input=search_input,
                        wait_duration=timedelta(seconds=settings.APIFY_TIMEOUT_SECONDS)
                    )
                    
                    if not search_run:
                        yield f"data: {json.dumps({'log': 'ERROR: Apify search run failed to start.'})}\n\n"
                        return
                        
                    status = _get_run_field(search_run, "status", "status")
                    if status != "SUCCEEDED":
                        yield f"data: {json.dumps({'log': f'ERROR: Apify search run finished with status: {status}'})}\n\n"
                        return
                        
                    dataset_id = _get_run_field(search_run, "default_dataset_id", "defaultDatasetId")
                    yield f"data: {json.dumps({'log': f'Search actor completed successfully. Fetching dataset: {dataset_id}...'})}\n\n"
                    scraped_items = list(client.dataset(dataset_id).iterate_items())
                    profile_urls = [item.get("linkedinUrl") or item.get("url") for item in scraped_items if item.get("linkedinUrl") or item.get("url")]
                else:
                    yield f"data: {json.dumps({'log': 'Starting Apify talent search actor...'})}\n\n"
                    boolean_query = job.get("boolean_queries") or f'("{job.get("title")}")'
                    search_input = {
                        "query": boolean_query,
                        "queries": [boolean_query],
                        "limit": payload.count,
                        "maxItems": payload.count,
                        "count": payload.count,
                    }
                    if settings.LINKEDIN_LI_AT_COOKIE.strip():
                        search_input["cookies"] = [{"name": "li_at", "value": settings.LINKEDIN_LI_AT_COOKIE.strip()}]
                        
                    search_run = client.actor(settings.APIFY_SEARCH_ACTOR_ID).call(
                        run_input=search_input,
                        wait_duration=timedelta(seconds=settings.APIFY_TIMEOUT_SECONDS)
                    )
                    
                    if not search_run:
                        yield f"data: {json.dumps({'log': 'ERROR: Apify search run failed to start.'})}\n\n"
                        return
                        
                    status = _get_run_field(search_run, "status", "status")
                    if status != "SUCCEEDED":
                        yield f"data: {json.dumps({'log': f'ERROR: Apify search run finished with status: {status}'})}\n\n"
                        return
                        
                    dataset_id = _get_run_field(search_run, "default_dataset_id", "defaultDatasetId")
                    search_items = list(client.dataset(dataset_id).iterate_items())
                    profile_urls = []
                    for item in search_items:
                        url = item.get("url") or item.get("profileUrl") or item.get("link") or item.get("profileUrlLink") or item.get("profile_url")
                        if url:
                            profile_urls.append(url)
                            if len(profile_urls) >= payload.count:
                                break
                                
                    if not profile_urls:
                        yield f"data: {json.dumps({'log': 'ERROR: LinkedIn search did not return any candidate profile URLs.'})}\n\n"
                        return
                        
                    yield f"data: {json.dumps({'log': f'Search finished. Found {len(profile_urls)} profile URLs. Starting profile scraper Actor...'})}\n\n"
                    
                    scrape_input = {
                        "profileUrls": profile_urls,
                        "urls": profile_urls
                    }
                    if settings.LINKEDIN_LI_AT_COOKIE.strip():
                        scrape_input["cookies"] = [{"name": "li_at", "value": settings.LINKEDIN_LI_AT_COOKIE.strip()}]
                        
                    scrape_run = client.actor(settings.APIFY_PROFILE_ACTOR_ID).call(
                        run_input=scrape_input,
                        wait_duration=timedelta(seconds=settings.APIFY_TIMEOUT_SECONDS)
                    )
                    
                    if not scrape_run:
                        yield f"data: {json.dumps({'log': 'ERROR: Apify profile scraper run failed to start.'})}\n\n"
                        return
                        
                    status = _get_run_field(scrape_run, "status", "status")
                    if status != "SUCCEEDED":
                        yield f"data: {json.dumps({'log': f'ERROR: Apify profile scraper run finished with status: {status}'})}\n\n"
                        return
                        
                    scrape_dataset_id = _get_run_field(scrape_run, "default_dataset_id", "defaultDatasetId")
                    scraped_items = list(client.dataset(scrape_dataset_id).iterate_items())
                
                yield f"data: {json.dumps({'log': f'Scraped {len(scraped_items)} profile items. Invoking AI agent evaluation pipeline...'})}\n\n"
                
                # 3. Parse and run the complete AI agent evaluation pipeline for each profile
                for index, item in enumerate(scraped_items):
                    url = item.get("linkedinUrl") or item.get("url") or (profile_urls[index] if index < len(profile_urls) else "")
                    profile_data = parse_apify_profile(item, url)
                    candidate_name = profile_data["name"]
                    candidate_email = profile_data["email"]
                    
                    yield f"data: {json.dumps({'log': f'Evaluating candidate: {candidate_name} ({candidate_email})...'})}\n\n"
                    
                    # Check for existing candidates to avoid duplicates
                    if candidate_email in db.get("candidates", {}):
                        yield f"data: {json.dumps({'log': f'Candidate {candidate_name} already exists in DB. Skipping.'})}\n\n"
                        continue
                        
                    graph_state = recruiting_agent_graph._initial_state({
                        "task_type": "sourced_candidate",
                        "candidate_email": candidate_email,
                        "position_id": payload.position_id,
                        "input": {
                            "candidate_email": candidate_email,
                            "position_id": payload.position_id,
                            "candidate_profile": profile_data,
                            "job_requirements": job,
                            "supervisor_use_llm": False,
                            "bias_use_llm": False,
                            "source_method": "apify_auto_source",
                        }
                    })
                    for event in recruiting_agent_graph.stream(graph_state):
                        graph_log = f"[{event.get('node')}] {event.get('message')}"
                        yield f"data: {json.dumps({'log': graph_log, 'agent_event': event})}\n\n"
                    if graph_state.get("blocked"):
                        blocked_reason = graph_state.get("guardrail", {}).get("reason", "blocked")
                        yield f"data: {json.dumps({'log': f'Guardrail blocked {candidate_name}: {blocked_reason}'})}\n\n"
                        continue
                    artifacts = graph_state.get("artifacts", {})
                    bias_analysis = artifacts.get("prestige_analysis") or analyze_prestige_indicators(profile_data)
                    bias_artifacts = {
                        "bias_analysis": bias_analysis,
                        "neutralized_profile_data": neutralize_candidate_profile(profile_data, bias_analysis)
                    }
                    match_results = artifacts.get("match_results") or build_fast_match_results(job, profile_data, controls, bias_artifacts["bias_analysis"])
                    custom_questions = artifacts.get("custom_questions") or [
                        f"Describe your most relevant experience for the {job.get('title', 'selected')} role.",
                        f"What evidence shows you can meet the main requirements for {job.get('title', 'this position')}?",
                        "What gap would you want to close before starting this role?"
                    ]
                    report_data = artifacts.get("report") or build_fast_outreach(profile_data, job)
                    sourcing_pitch = report_data.get("sourcing_pitch", "")
                    outreach_email = report_data.get("outreach_email", "")
                        
                    staged_candidate = {
                        "name": candidate_name,
                        "email": candidate_email,
                        "status": "staged",
                        "position_id": payload.position_id,
                        "is_sourced": True,
                        "source_type": "linkedin",
                        "source_method": "apify_auto_source",
                        "linkedin_url": profile_data.get("source_url") or f"https://www.linkedin.com/in/{candidate_name.lower().replace(' ', '-')}",
                        "profile_data": profile_data,
                        "bias_analysis": bias_artifacts["bias_analysis"],
                        "neutralized_profile_data": bias_artifacts["neutralized_profile_data"],
                        "sourcing_pitch": sourcing_pitch,
                        "outreach_email": outreach_email,
                        "match_results": match_results,
                        "custom_questions": custom_questions,
                        "answers": [],
                        "evaluation": {},
                        "notifications": [],
                        "outreach_history": []
                    }
                    db.setdefault("candidates", {})[candidate_email] = staged_candidate
                    generated.append(serialize_candidate(staged_candidate, candidate_email))
                    yield f"data: {json.dumps({'log': f'Successfully evaluated and staged {candidate_name}!'})}\n\n"
                    
            except ApifyApiError as e:
                approval_msg = ""
                if e.data and isinstance(e.data, dict) and e.data.get("approvalUrl"):
                    approval_msg = f" Please approve the actor permissions in your Apify Console: {e.data['approvalUrl']}"
                yield f"data: {json.dumps({'log': f'ERROR: Apify API error: {e.message} (status: {e.status_code}).{approval_msg}'})}\n\n"
                return
            except Exception as e:
                yield f"data: {json.dumps({'log': f'ERROR: Sourcing failed: {str(e)}'})}\n\n"
                return
                
        else:
            # Fall back to prototype auto-sourcing
            yield f"data: {json.dumps({'log': 'Sourcing live Apify token is not configured. Falling back to prototype simulation...' })}\n\n"
            sample_profiles = build_auto_source_profiles(job, max(1, min(payload.count, 10)))

            for index, profile_data in enumerate(sample_profiles):
                candidate_email = profile_data["email"]
                candidate_name = profile_data["name"]
                
                yield f"data: {json.dumps({'log': f'Simulating evaluation for prototype candidate: {candidate_name}...'})}\n\n"
                graph_state = recruiting_agent_graph._initial_state({
                    "task_type": "sourced_candidate",
                    "candidate_email": candidate_email,
                    "position_id": payload.position_id,
                    "input": {
                        "candidate_email": candidate_email,
                        "position_id": payload.position_id,
                        "candidate_profile": profile_data,
                        "job_requirements": job,
                        "supervisor_use_llm": False,
                        "bias_use_llm": False,
                        "source_method": "prototype_auto_source",
                    }
                })
                for event in recruiting_agent_graph.stream(graph_state):
                    graph_log = f"[{event.get('node')}] {event.get('message')}"
                    yield f"data: {json.dumps({'log': graph_log, 'agent_event': event})}\n\n"
                if graph_state.get("blocked"):
                    blocked_reason = graph_state.get("guardrail", {}).get("reason", "blocked")
                    yield f"data: {json.dumps({'log': f'Guardrail blocked prototype candidate {candidate_name}: {blocked_reason}'})}\n\n"
                    continue
                artifacts = graph_state.get("artifacts", {})
                fallback_bias = build_candidate_bias_artifacts(profile_data, use_llm=False)
                bias_analysis = artifacts.get("prestige_analysis") or fallback_bias["bias_analysis"]
                bias_artifacts = {
                    "bias_analysis": bias_analysis,
                    "neutralized_profile_data": neutralize_candidate_profile(profile_data, bias_analysis)
                }
                match_results = calibrate_auto_source_match(
                    artifacts.get("match_results") or build_fast_match_results(job, profile_data, controls, bias_artifacts["bias_analysis"]),
                    profile_data,
                    job,
                    index
                )
                custom_questions = artifacts.get("custom_questions") or [
                    f"Describe your most relevant experience for the {job.get('title', 'selected')} role.",
                    f"What evidence shows you can meet the main requirements for {job.get('title', 'this position')}?",
                    "What gap would you want to close before starting this role?"
                ]
                report_data = artifacts.get("report") or build_fast_outreach(profile_data, job)
                sourcing_pitch = report_data["sourcing_pitch"]
                outreach_email = report_data["outreach_email"]

                candidate_record = {
                    "name": candidate_name,
                    "email": candidate_email,
                    "status": "staged",
                    "position_id": payload.position_id,
                    "is_sourced": True,
                    "source_type": "linkedin",
                    "source_method": "prototype_auto_source",
                    "linkedin_url": f"https://www.linkedin.com/in/{profile_data['name'].lower().replace(' ', '-')}",
                    "profile_data": profile_data,
                    "bias_analysis": bias_artifacts["bias_analysis"],
                    "neutralized_profile_data": bias_artifacts["neutralized_profile_data"],
                    "sourcing_pitch": sourcing_pitch,
                    "outreach_email": outreach_email,
                    "match_results": match_results,
                    "custom_questions": custom_questions,
                    "answers": [],
                    "evaluation": {},
                    "notifications": [],
                    "outreach_history": []
                }
                db.setdefault("candidates", {})[candidate_email] = candidate_record
                generated.append(serialize_candidate(candidate_record, candidate_email))
                yield f"data: {json.dumps({'log': f'Staged prototype candidate {candidate_name}'})}\n\n"
                
        # Save DB and yield final results
        save_db(db)
        yield f"data: {json.dumps({'result': generated})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")

@router.post("/mock-bias-comparison")
def add_mock_bias_comparison_candidates(payload: MockBiasComparisonPayload):
    db = load_db()
    job = db.get("positions", {}).get(str(payload.position_id))
    if not job:
        raise HTTPException(status_code=404, detail="Selected position not found.")

    controls = get_bias_controls(db)
    title = job.get("title", "Open Role")
    terms = role_search_terms(job, limit=6)
    skills = list(dict.fromkeys([*terms, title, job.get("department", ""), "communication", "project delivery"]))[:12]
    comparison_profiles = [
        {
            "name": "Alex Prestige",
            "email": f"bias.demo.top.{payload.position_id}@example.com",
            "headline": f"{title} candidate with high growth trajectory",
            "school": "Asia Pacific University",
            "company": "Verified Prototype Talent Pool",
            "note": "high growth and consistent role evidence"
        },
        {
            "name": "Rina Regional",
            "email": f"bias.demo.regional.{payload.position_id}@example.com",
            "headline": f"{title} candidate from a regional public university",
            "school": "Selangor Vocational College",
            "company": "Regional Product Studio",
            "note": "regional university background with matching project evidence"
        },
        {
            "name": "Sam Portfolio",
            "email": f"bias.demo.portfolio.{payload.position_id}@example.com",
            "headline": f"{title} candidate with portfolio-led experience",
            "school": "Professional Training Institute",
            "company": "Startup Experience Lab",
            "note": "portfolio-first background with lower pedigree signals"
        },
        {
            "name": "Maya Growth",
            "email": f"bias.demo.growth.{payload.position_id}@example.com",
            "headline": f"{title} candidate from a top-tier university",
            "school": "Universiti Kuala Lumpur",
            "company": "Google",
            "note": "strong institutional prestige signals"
        }
    ]

    created = []
    candidates = db.setdefault("candidates", {})
    for index, profile in enumerate(comparison_profiles):
        profile_data = {
            "name": profile["name"],
            "email": profile["email"],
            "headline": profile["headline"],
            "location": "Kuala Lumpur, MY",
            "about": (
                f"Bias comparison mock candidate for {title}; all comparison candidates share similar role skills, "
                f"but differ by university and employer prestige so scoring mode changes are visible."
            ),
            "work_experience": f"Delivered projects involving {', '.join(terms[:4]) or title}.",
            "skills": skills,
            "awards": ["High Potential Candidate"] if index in {2, 3} else [],
            "experiences": [
                {
                    "title": f"{title} Specialist",
                    "company": profile["company"],
                    "duration": "2021 - Present",
                    "description": f"Built role-relevant projects, collaborated with stakeholders, and demonstrated {', '.join(terms[:3]) or 'position fit'}."
                }
            ],
            "education": [
                {
                    "school": profile["school"],
                    "degree": f"Degree related to {terms[0] if terms else title}"
                }
            ],
            "scrape_status": "mock_bias_comparison",
            "scrape_warning": "Mock candidate for university-score comparison; not a real sourced profile.",
            "source_type": "linkedin",
            "source_method": "mock_bias_comparison"
        }
        bias_artifacts = build_candidate_bias_artifacts(profile_data, use_llm=False)
        match_results = build_fast_match_results(job, profile_data, controls, bias_artifacts["bias_analysis"])
        custom_questions = [
            f"Describe evidence that shows your fit for {title}.",
            "Which project best demonstrates your practical skills for this position?",
            "What growth area would you prioritize in your first month?"
        ]
        candidate_record = {
            "name": profile_data["name"],
            "email": profile_data["email"],
            "status": "staged",
            "position_id": payload.position_id,
            "is_sourced": True,
            "source_type": "linkedin",
            "source_method": "mock_bias_comparison",
            "linkedin_url": f"https://www.linkedin.com/in/{profile_data['name'].lower().replace(' ', '-')}",
            "profile_data": profile_data,
            "bias_analysis": bias_artifacts["bias_analysis"],
            "neutralized_profile_data": bias_artifacts["neutralized_profile_data"],
            "sourcing_pitch": f"{profile_data['name']} is a university comparison mock profile with {profile['note']}.",
            "outreach_email": f"Subject: Mock comparison candidate for {title}\n\nThis profile is seeded for Bias Control Console testing.",
            "match_results": match_results,
            "custom_questions": custom_questions,
            "answers": [],
            "evaluation": {},
            "notifications": [],
            "outreach_history": []
        }
        candidates[profile_data["email"]] = candidate_record
        created.append(serialize_candidate(candidate_record, profile_data["email"]))

    save_db(db)
    return {"created_count": len(created), "candidates": created}

@router.post("/invite")
def invite_candidate(payload: InvitePayload):
    db = load_db()
    email_clean = payload.email.strip().lower()
    candidate = db.setdefault("candidates", {}).get(email_clean)
    
    if not candidate:
        raise HTTPException(status_code=404, detail="Staged candidate profile not found.")
        
    previous_status = candidate.get("status")
    if previous_status and previous_status != "invited":
        history = candidate.setdefault("status_history", [])
        history.append(previous_status)
        candidate["status_history"] = history[-10:]
    candidate["status"] = "invited"
    if payload.outreach_email:
        candidate["outreach_email"] = payload.outreach_email
    if payload.hr_feedback is not None:
        candidate["hr_feedback"] = payload.hr_feedback

    # Trigger Outreach SMTP dispatch only when real SMTP credentials exist.
    smtp_configured = is_smtp_configured(payload.smtp_settings)
    try:
        email_receipt = send_recruitment_email(
            to_email=email_clean,
            subject=f"Exclusive Sourcing Invitation - {candidate.get('profile_data', {}).get('headline')}",
            body=candidate.get("outreach_email", ""),
            smtp_settings=payload.smtp_settings
        ) if smtp_configured else {
            "sent": False,
            "smtp_configured": False,
            "reason": "SMTP is not configured; invitation was saved but not sent.",
            "error_type": "smtp_not_configured",
            "provider_message": "",
        }
    except Exception as e:
        print(f"SMTP dispatch failure: {e}")
        email_receipt = {
            "sent": False,
            "smtp_configured": smtp_configured,
            "reason": "Invitation email dispatch failed.",
            "error_type": e.__class__.__name__,
            "provider_message": str(e),
        }
    email_sent = _email_sent(email_receipt)
    history_status = "sent" if email_sent else "prototype"
    history_detail = email_receipt.get("reason") if isinstance(email_receipt, dict) else ("SMTP dispatch completed." if email_sent else "SMTP is not configured; invitation was saved in prototype mode.")
    record_outreach_history(
        candidate,
        candidate.get("outreach_email", ""),
        history_status,
        history_detail,
        candidate.get("position_id")
    )
    add_notification(candidate, "Recruitment invitation", "A hiring manager sent you an outreach invitation.", "application", candidate.get("position_id"))

    save_db(db)
    return {
        "candidate": serialize_candidate(candidate, email_clean),
        "outreach_sent": email_sent,
        "smtp_configured": smtp_configured,
        "email_receipt": email_receipt,
    }

@router.post("/{email}/reject")
def reject_candidate(email: str, payload: RejectCandidatePayload):
    db = load_db()
    email_clean = email.strip().lower()
    candidate = db.setdefault("candidates", {}).get(email_clean)
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found.")

    application = find_application(candidate, payload.position_id)
    rejection_message = payload.rejection_message or (
        "Thank you for applying. After careful consideration, we have decided to move forward with other candidates "
        "whose experience more closely matches our current needs. We appreciate the time you invested and wish you "
        "success in your career journey."
    )
    if application:
        previous_status = application.get("status")
        if previous_status and previous_status != "rejected":
            history = application.setdefault("status_history", [])
            history.append(previous_status)
            application["status_history"] = history[-10:]
        application["status"] = "rejected"
        application["progress"] = get_application_progress("rejected")
        application["hr_feedback"] = payload.hr_feedback or ""
        application["rejection_message"] = rejection_message
        application["rejected_at"] = datetime.now().isoformat(timespec="seconds")
        add_notification(candidate, "Application update", rejection_message, "decision", payload.position_id)
        sync_current_application(candidate, application)
    else:
        previous_status = candidate.get("status")
        if previous_status and previous_status != "rejected":
            history = candidate.setdefault("status_history", [])
            history.append(previous_status)
            candidate["status_history"] = history[-10:]
        candidate["status"] = "rejected"
        candidate["hr_feedback"] = payload.hr_feedback or ""
        candidate["rejection_message"] = rejection_message
        candidate["rejected_at"] = datetime.now().isoformat(timespec="seconds")
        add_notification(candidate, "Application update", rejection_message, "decision")

    email_receipt = send_decision_email(email_clean, "Application update", rejection_message)
    save_db(db)
    result = serialize_application_candidate(candidate, email_clean, application) if application else serialize_candidate(candidate, email_clean)
    result["email_sent"] = _email_sent(email_receipt)
    result["email_receipt"] = email_receipt
    result["smtp_configured"] = is_smtp_configured()
    return result

@router.post("/{email}/schedule-interview")
def schedule_interview(email: str, payload: InterviewSlotPayload):
    db = load_db()
    email_clean = email.strip().lower()
    candidate = db.setdefault("candidates", {}).get(email_clean)
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found.")

    application = find_application(candidate, payload.position_id)
    existing_slot = application.get("interview_slot") if application else candidate.get("interview_slot")
    interview_slot = {
        "date": payload.interview_date,
        "time": payload.interview_time,
        "location": payload.interview_location,
        "notes": payload.interview_notes or ""
    }
    if application:
        previous_status = application.get("status")
        if previous_status and previous_status != "interview_scheduled":
            history = application.setdefault("status_history", [])
            history.append(previous_status)
            application["status_history"] = history[-10:]
        application["status"] = "interview_scheduled"
        application["progress"] = get_application_progress("interview_scheduled")
        application["interview_slot"] = interview_slot
        application["interview_scheduled_at"] = datetime.now().isoformat(timespec="seconds")
        add_notification(
            candidate,
            "Interview updated" if existing_slot else "Interview scheduled",
            f"Your interview is set for {payload.interview_date} at {payload.interview_time}.",
            "interview",
            payload.position_id
        )
        sync_current_application(candidate, application)
    else:
        previous_status = candidate.get("status")
        if previous_status and previous_status != "interview_scheduled":
            history = candidate.setdefault("status_history", [])
            history.append(previous_status)
            candidate["status_history"] = history[-10:]
        candidate["status"] = "interview_scheduled"
        candidate["interview_slot"] = interview_slot
        add_notification(
            candidate,
            "Interview updated" if existing_slot else "Interview scheduled",
            f"Your interview is set for {payload.interview_date} at {payload.interview_time}.",
            "interview"
        )

    # Send SMTP notification email to candidate
    candidate_name = candidate.get("name", "Candidate")
    position_id = payload.position_id or candidate.get("position_id")
    job = db.get("positions", {}).get(str(position_id), {}) if position_id else {}
    position_title = job.get("title", "the position")
    interview_body = (
        f"Dear {candidate_name},\n\n"
        f"Congratulations! We are pleased to invite you for an interview for {position_title}.\n\n"
        f"Interview Details:\n"
        f"  Date: {payload.interview_date}\n"
        f"  Time: {payload.interview_time}\n"
        f"  Location: {payload.interview_location}\n"
        + (f"  Notes: {payload.interview_notes}\n" if payload.interview_notes else "") +
        f"\nPlease confirm your attendance by replying to this email.\n\n"
        f"We look forward to meeting you.\n\nBest regards,\nHiring Team"
    )
    smtp_configured = is_smtp_configured()
    email_receipt: Dict[str, Any] = {"sent": False, "smtp_configured": smtp_configured}
    if smtp_configured:
        try:
            email_receipt = send_recruitment_email(
                to_email=email_clean,
                subject=f"Interview Invitation - {position_title}",
                body=interview_body
            )
        except Exception as e:
            print(f"Interview invite SMTP failure: {e}")
            email_receipt = {
                "sent": False,
                "smtp_configured": smtp_configured,
                "reason": "Interview invitation email dispatch failed.",
                "error_type": e.__class__.__name__,
                "provider_message": str(e),
            }

    save_db(db)
    result = serialize_application_candidate(candidate, email_clean, application) if application else serialize_candidate(candidate, email_clean)
    result["interview_email_sent"] = _email_sent(email_receipt)
    result["email_receipt"] = email_receipt
    result["smtp_configured"] = smtp_configured
    return result

def role_search_terms(job: Dict[str, Any], limit: int = 8) -> List[str]:
    criteria = job.get("sourcing_criteria") or {}
    raw_values: List[Any] = [
        job.get("title", ""),
        job.get("department", ""),
        job.get("requirements", []),
        criteria.get("generated_requirements", []),
        criteria.get("must_have_signals", []),
        criteria.get("must_have_skills", ""),
        criteria.get("candidate_profile", ""),
        criteria.get("domain_context", ""),
        criteria.get("success_signals", ""),
        criteria.get("search_keywords", "")
    ]
    terms: List[str] = []
    for value in raw_values:
        values = value if isinstance(value, list) else re.split(r"[,;\n]| and | or ", str(value or ""))
        for item in values:
            cleaned = re.sub(r"\s+", " ", str(item)).strip(" .:-")
            if cleaned and len(cleaned) <= 70 and cleaned.lower() not in {term.lower() for term in terms}:
                terms.append(cleaned)
            if len(terms) >= limit:
                return terms
    return terms

def infer_auto_source_family(role_text: str) -> str:
    role_text = role_text.lower()
    if any(term in role_text for term in ("baker", "bakery", "pastry", "chef", "cook", "kitchen", "food")):
        return "culinary"
    if any(term in role_text for term in ("sales", "account executive", "business development", "customer")):
        return "sales"
    if any(term in role_text for term in ("marketing", "campaign", "content", "seo", "brand")):
        return "marketing"
    if any(term in role_text for term in ("designer", "design", "ux", "ui", "figma")):
        return "design"
    if any(term in role_text for term in ("engineer", "developer", "software", "data", "python", "react", "node", "api")):
        return "technical"
    return "general"

def build_auto_source_profiles(job: Dict[str, Any], count: int) -> List[Dict[str, Any]]:
    title = job.get("title", "Open Role")
    department = job.get("department", "Hiring Team")
    role_text = f"{title} {department} {' '.join(job.get('requirements', []))}"
    family = infer_auto_source_family(role_text)
    terms = role_search_terms(job, limit=8)
    primary = terms[0] if terms else title
    secondary = terms[1] if len(terms) > 1 else department
    tertiary = terms[2] if len(terms) > 2 else "role-specific delivery"
    skills = list(dict.fromkeys([*terms, title, department]))[:12]

    templates = {
        "culinary": [
            ("Nadia Lim", "Bakery Production Lead", "Prepared dough, managed oven timing, monitored freshness, and followed hygiene routines."),
            ("Hafiz Rahman", "Pastry Cook", "Produced pastries, maintained recipe consistency, checked storage standards, and handled early shift preparation."),
            ("Mei Wong", "Kitchen Quality Assistant", "Supported batch preparation, ingredient handling, food safety checks, and customer-ready presentation.")
        ],
        "sales": [
            ("Maya Tan", "Sales Development Specialist", "Owned prospect research, customer qualification, pipeline follow-up, and conversion tracking."),
            ("Daniel Lim", "Account Executive", "Managed client conversations, negotiated requirements, handled objections, and delivered quota outcomes."),
            ("Aisha Rahman", "Business Development Associate", "Built lead lists, ran outreach, qualified accounts, and summarized customer needs for the team.")
        ],
        "marketing": [
            ("Maya Tan", "Campaign Marketing Specialist", "Planned content calendars, reviewed campaign analytics, optimized audience targeting, and reported performance."),
            ("Daniel Lim", "Growth Marketing Analyst", "Worked across SEO, paid campaigns, conversion tracking, and landing-page experiments."),
            ("Aisha Rahman", "Brand Content Strategist", "Produced social content, managed brand messaging, measured engagement, and coordinated campaign launches.")
        ],
        "design": [
            ("Maya Tan", "Product Designer", "Created wireframes, Figma prototypes, user flows, visual systems, and handoff documentation."),
            ("Daniel Lim", "UX Designer", "Ran user research synthesis, mapped journeys, tested prototypes, and improved form conversion."),
            ("Aisha Rahman", "UI Designer", "Built responsive interface components, interaction states, design specs, and brand-consistent layouts.")
        ],
        "technical": [
            ("Maya Tan", "Senior Frontend Engineer", "Built React interfaces, improved performance, integrated APIs, and maintained testable component systems."),
            ("Daniel Lim", "Backend Engineer", "Designed Node.js services, SQL schemas, API integrations, queues, and deployment workflows."),
            ("Aisha Rahman", "Full-Stack Product Engineer", "Delivered frontend features, backend endpoints, analytics workflows, and production support.")
        ],
        "general": [
            ("Maya Tan", f"{title} Specialist", "Handled role-specific operations, stakeholder coordination, quality checks, and measurable delivery."),
            ("Daniel Lim", f"{title} Associate", "Supported daily execution, documentation, team communication, and practical problem solving."),
            ("Aisha Rahman", f"{title} Coordinator", "Managed task follow-through, service standards, reporting, and continuous improvement.")
        ]
    }

    profiles = []
    selected_templates = templates.get(family, templates["general"])
    for index in range(count):
        name, headline, description = selected_templates[index % len(selected_templates)]
        if index >= len(selected_templates):
            name = f"{name} {index + 1}"
        email_slug = re.sub(r"[^a-z0-9]+", ".", name.lower()).strip(".")
        matched_terms = ", ".join(terms[:5]) or primary
        profiles.append({
            "name": name,
            "email": f"{email_slug}@example.com",
            "headline": f"{headline} aligned with {title}",
            "location": "Kuala Lumpur, MY" if index != 1 else "Selangor, MY",
            "about": (
                f"Prototype sourced profile for {title}. This candidate profile intentionally includes evidence for "
                f"{matched_terms} so hiring managers can test the automatic sourcing workflow."
            ),
            "work_experience": f"Hands-on experience with {matched_terms}.",
            "skills": skills,
            "experiences": [
                {
                    "title": headline,
                    "company": "Verified Prototype Talent Pool",
                    "duration": "2021 - Present",
                    "description": f"{description} Recent work demonstrates {primary}, {secondary}, and {tertiary}."
                }
            ],
            "education": [{"school": "Professional Training Institute", "degree": f"Certificate related to {primary}"}],
            "scrape_status": "prototype_auto_source",
            "scrape_warning": "Automatically generated prototype candidate; not scraped from LinkedIn. Verify manually before outreach.",
            "source_type": "linkedin",
            "source_method": "prototype_auto_source"
        })
    return profiles

def calibrate_auto_source_match(match_results: Dict[str, Any], profile_data: Dict[str, Any], job: Dict[str, Any], rank: int) -> Dict[str, Any]:
    calibrated = dict(match_results or {})
    scores = dict(calibrated.get("scores", {}))
    target_scores = [
        {"technical": 88, "domain": 85, "culture": 82, "trajectory_slope": 86, "overall_position_fit": 86},
        {"technical": 82, "domain": 80, "culture": 78, "trajectory_slope": 83, "overall_position_fit": 81},
        {"technical": 76, "domain": 75, "culture": 74, "trajectory_slope": 80, "overall_position_fit": 76},
    ]
    floor_scores = target_scores[min(rank, len(target_scores) - 1)]
    for key, floor_value in floor_scores.items():
        scores[key] = max(int(scores.get(key, 0) or 0), floor_value)
    calibrated["scores"] = scores
    title = job.get("title", "this role")
    evidence = ", ".join(role_search_terms(job, limit=4)) or title
    calibrated["position_fit_summary"] = (
        f"{profile_data.get('name', 'Candidate')} is a prototype auto-source match for {title}. "
        f"The generated profile includes direct evidence around {evidence}, so the score is calibrated for demo sourcing rather than live LinkedIn verification."
    )
    debate = calibrated.setdefault("debate", {})
    debate["talent_advocate_pros"] = [
        f"Prototype profile includes direct signals for {evidence}.",
        f"Experience summary is intentionally aligned to the {title} requirements for sourcing workflow testing.",
        *(debate.get("talent_advocate_pros") or [])[:1]
    ]
    debate["critical_recruiter_cons"] = [
        "This is an automatically generated prototype candidate, so employment history must be verified before outreach.",
        *(debate.get("critical_recruiter_cons") or [])[:2]
    ]
    return calibrated

@router.get("/interview-calendar")
def get_interview_calendar():
    db = load_db()
    results = []
    for email, candidate in db.get("candidates", {}).items():
        applications = normalize_candidate_applications(candidate)
        for app in applications:
            if app.get("status") == "interview_scheduled" and app.get("interview_slot"):
                slot = app["interview_slot"]
                position_id = app.get("position_id")
                job = db.get("positions", {}).get(str(position_id), {}) if position_id else {}
                results.append({
                    "email": email,
                    "name": candidate.get("name", ""),
                    "position_id": position_id,
                    "position_title": job.get("title", "Unknown Position"),
                    "application_id": app.get("application_id"),
                    "interview_date": slot.get("date"),
                    "interview_time": slot.get("time"),
                    "interview_location": slot.get("location"),
                    "interview_notes": slot.get("notes", "")
                })
    return results

@router.patch("/{email}/outreach-notes")
def update_candidate_outreach_notes(email: str, payload: UpdateCandidateOutreachNotesPayload):
    db = load_db()
    email_clean = email.strip().lower()
    candidate = db.setdefault("candidates", {}).get(email_clean)
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found.")

    application = find_application(candidate, payload.position_id)
    
    if payload.outreach_email is not None:
        candidate["outreach_email"] = payload.outreach_email
        record_outreach_history(candidate, payload.outreach_email, "draft", "Draft saved by hiring manager.", payload.position_id)
        if application:
            application["outreach_email"] = payload.outreach_email
            
    if payload.hr_feedback is not None:
        candidate["hr_feedback"] = payload.hr_feedback
        if application:
            application["hr_feedback"] = payload.hr_feedback
            
    if application:
        sync_current_application(candidate, application)

    save_db(db)
    if application:
        return serialize_application_candidate(candidate, email_clean, application)
    return serialize_candidate(candidate, email_clean)
