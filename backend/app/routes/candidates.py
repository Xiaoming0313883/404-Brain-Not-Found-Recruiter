import hashlib
import hmac
import io
import os
import re
import shutil
import uuid
import base64
import secrets
from datetime import datetime
from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, EmailStr
from typing import List, Optional, Dict, Any
from pypdf import PdfReader

from ..database import load_db, save_db
from ..config import settings
from ..services.agents.base_agent import get_openai_client
from ..services.job_windows import is_open_for_applications
from ..services.linkedin_profiles import build_fast_match_results, build_fast_outreach, scrape_linkedin_profile
from ..services.agents import (
    run_resume_agent,
    run_matching_agent,
    run_interview_agent_phase_a,
    run_interview_agent_phase_b,
    run_report_agent
)
from ..services.mailer import send_candidate_verification_email, send_recruitment_email

router = APIRouter(prefix="/candidates", tags=["Candidates"])
MAX_RESUME_BYTES = 10 * 1024 * 1024
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

class CandidateStatusPayload(BaseModel):
    status: str
    position_id: Optional[int] = None

class CandidatePasswordPayload(BaseModel):
    password: str

class CandidateLoginPayload(BaseModel):
    email: str
    password: str

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
        "prototype": True
    }
    return code

def send_or_log_verification_email(email: str, code: str) -> bool:
    sent = send_candidate_verification_email(email, code)
    print(f"Prototype email verification code for {email}: {code}")
    return sent

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
            "outreach_email": candidate.get("outreach_email", "")
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
        "interview_slot": application.get("interview_slot")
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
    serialized["profile_verified"] = bool(candidate.get("profile_verified")) and not missing_fields
    serialized["email_verified"] = bool(candidate.get("email_verified", True))
    serialized["hr_feedback"] = candidate.get("hr_feedback", "")
    return serialized

def neutralize_text(text: str) -> str:
    """Masks high prestige institutions inside textual data."""
    if not text:
        return text
    replacements = {
        r"\bHarvard\b": "[Tier-1 Research University]",
        r"\bYale\b": "[Tier-1 Ivy League School]",
        r"\bMIT\b": "[Tier-1 Research University]",
        r"\bStanford\b": "[Tier-1 Research University]",
        r"\bGoogle\b": "[Tier-1 Tech Corporation]",
        r"\bMeta\b": "[Tier-1 Tech Corporation]",
        r"\bApple\b": "[Tier-1 Tech Corporation]",
        r"\bMcKinsey\b": "[Tier-1 Consulting Firm]",
        r"\bBCG\b": "[Tier-1 Consulting Firm]"
    }
    for pattern, replacement in replacements.items():
        text = re.sub(pattern, replacement, text, flags=re.IGNORECASE)
    return text

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

def save_resume_file(email: str, filename: str, contents: bytes) -> str:
    os.makedirs(RESUME_DIR, exist_ok=True)
    extension = os.path.splitext(filename or "resume.pdf")[1].lower() or ".pdf"
    safe_email = re.sub(r"[^a-zA-Z0-9_.-]", "_", email)
    stored_name = f"{safe_email}-{uuid.uuid4().hex[:8]}{extension}"
    stored_path = os.path.join(RESUME_DIR, stored_name)
    with open(stored_path, "wb") as f:
        f.write(contents)
    return stored_path

def extract_profile_picture(email: str, pdf_contents: bytes) -> Optional[str]:
    try:
        pdf_reader = PdfReader(io.BytesIO(pdf_contents))
        for page in pdf_reader.pages[:2]:
            for index, image in enumerate(getattr(page, "images", [])):
                image_data = image.data
                if not image_data or len(image_data) < 1024:
                    continue
                extension = os.path.splitext(image.name or "")[1].lower() or ".jpg"
                if extension not in {".jpg", ".jpeg", ".png", ".webp"}:
                    extension = ".jpg"
                os.makedirs(PROFILE_IMAGE_DIR, exist_ok=True)
                safe_email = re.sub(r"[^a-zA-Z0-9_.-]", "_", email)
                stored_name = f"{safe_email}-{index}{extension}"
                stored_path = os.path.join(PROFILE_IMAGE_DIR, stored_name)
                with open(stored_path, "wb") as f:
                    f.write(image_data)
                return f"/uploads/profile_pictures/{stored_name}"
    except Exception as e:
        print(f"Profile image extraction skipped: {e}")
    return None

@router.get("")
def get_candidates(neutralize: bool = Query(False)):
    db = load_db()
    candidates = list(db.get("candidates", {}).items())
    
    if not neutralize:
        rows = []
        for email, candidate in candidates:
            applications = normalize_candidate_applications(candidate)
            if applications:
                rows.extend(serialize_application_candidate(candidate, email, app) for app in applications)
            else:
                rows.append(serialize_candidate(candidate, email))
        return rows
        
    # Apply Prestige Neutralization & Anonymization dynamics
    neutralized_list = []
    for email, c in candidates:
        email_hash = get_anonymized_hash(c["email"])
        
        # Neutralize profile_data nested properties
        profile = c.get("profile_data", {})
        neutralized_profile = {
            "name": email_hash,
            "headline": profile.get("headline", "Software Engineer"),
            "location": profile.get("location", "Anonymous City"),
            "about": profile.get("about", ""),
            "experiences": [],
            "education": []
        }
        
        # Replace experiences company names
        for exp in profile.get("experiences", []):
            company = exp.get("company", "")
            # Apply standard filters
            for target, replacement in [("Google", "[Tier-1 Tech Corporation]"), ("Meta", "[Tier-1 Tech Corporation]"), ("Apple", "[Tier-1 Tech Corporation]"), ("McKinsey", "[Tier-1 Consulting Firm]"), ("Harvard", "[Tier-1 Research University]")]:
                if target.lower() in company.lower():
                    company = replacement
            neutralized_profile["experiences"].append({
                "title": exp.get("title"),
                "company": company,
                "duration": exp.get("duration")
            })
            
        # Replace education school names
        for edu in profile.get("education", []):
            school = edu.get("school", "")
            for target, replacement in [("Harvard", "[Tier-1 Research University]"), ("Yale", "[Tier-1 Ivy League School]"), ("Stanford", "[Tier-1 Research University]")]:
                if target.lower() in school.lower():
                    school = replacement
            neutralized_profile["education"].append({
                "school": school,
                "degree": edu.get("degree")
            })

        # Neutralize debate elements
        match_results = c.get("match_results", {})
        debate = match_results.get("debate", {})
        neutralized_debate = {
            "critical_recruiter_cons": [neutralize_text(con) for con in debate.get("critical_recruiter_cons", [])],
            "talent_advocate_pros": [neutralize_text(pro) for pro in debate.get("talent_advocate_pros", [])]
        }
        
        neutralized_candidate = {
            **c,
            "name": email_hash,
            "email": f"{email_hash.lower().replace(' ', '_').replace('#', '')}@anonymous.com",
            "linkedin_url": "https://www.linkedin.com/in/anonymous-profile",
            "profile_data": neutralized_profile,
            "match_results": {
                **match_results,
                "debate": neutralized_debate
            }
        }
        applications = normalize_candidate_applications(neutralized_candidate)
        if applications:
            neutralized_list.extend(serialize_application_candidate(neutralized_candidate, email, app) for app in applications)
        else:
            neutralized_list.append(serialize_candidate(neutralized_candidate, email))
        
    return neutralized_list

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
        return {**serialize_candidate(candidate, email_clean), "verification_sent": False}

    code = create_email_verification(candidate)
    sent = send_or_log_verification_email(email_clean, code)
    save_db(db)
    response = serialize_candidate(candidate, email_clean)
    response["verification_sent"] = sent
    response["prototype_verification_code"] = code
    return response

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

    try:
        match_results = run_matching_agent(job, profile_data)
    except Exception as e:
        print(f"Error running matching agent: {e}")
        match_results = {
            "debate": {"critical_recruiter_cons": ["Stack verification required."], "talent_advocate_pros": ["Strong interest in the position."]},
            "scores": {"technical": 75, "domain": 70, "culture": 80, "trajectory_slope": 75}
        }

    try:
        custom_questions = run_interview_agent_phase_a(profile_data, match_results, job)
    except Exception as e:
        print(f"Error generating screening questions: {e}")
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
        "sourcing_pitch": "Inbound applicant with verified profile details.",
        "outreach_email": candidate.get("outreach_email", "")
    }
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

    resume_text, contents = await read_resume_text(resume)
    if not resume_text:
        resume_text = "PDF text extraction did not find readable text. Review the original uploaded resume file."

    try:
        profile_data = run_resume_agent(resume_text, prestige_neutralize=False)
    except Exception as e:
        print(f"Error running resume agent: {e}")
        profile_data = {
            "name": name,
            "headline": "Candidate Profile",
            "location": "",
            "about": "Candidate profile created from uploaded resume.",
            "experiences": [],
            "education": []
        }
    profile_data = normalize_profile_details(apply_resume_extraction_warning(profile_data, resume_text))

    resume_path = save_resume_file(email_clean, resume.filename or "resume.pdf", contents)
    profile_picture_url = extract_profile_picture(email_clean, contents)
    resume_summary = get_resume_summary(profile_data, resume_text)

    parsed_name = profile_data.get("name") if profile_data.get("name") and profile_data.get("name") != "Candidate Full Name" else name

    candidate_record = {
        "name": parsed_name,
        "email": email_clean,
        "status": "profile",
        "position_id": None,
        "is_sourced": False,
        "linkedin_url": "",
        "profile_data": profile_data,
        "resume_filename": resume.filename,
        "resume_path": resume_path,
        "resume_url": f"/api/v1/candidates/{email_clean}/resume",
        "resume_text": resume_text,
        "resume_summary": resume_summary,
        "profile_picture_url": profile_picture_url,
        "sourcing_pitch": "",
        "outreach_email": "",
        "match_results": {},
        "custom_questions": [],
        "answers": [],
        "evaluation": {},
        "applications": [],
        "hiring_manager_feedback": "",
        "profile_verified": not get_missing_profile_fields(profile_data),
        "email_verified": False,
        "password_hash": hash_password(password)
    }

    verification_code = create_email_verification(candidate_record)
    verification_sent = send_or_log_verification_email(email_clean, verification_code)
    db.setdefault("candidates", {})[email_clean] = candidate_record
    save_db(db)
    response = serialize_candidate(candidate_record, email_clean)
    response["verification_sent"] = verification_sent
    response["prototype_verification_code"] = verification_code
    return response

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
    save_db(db)
    return serialize_application_candidate(candidate, email_clean, application)

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
    if application:
        application["status"] = payload.status
        application["progress"] = get_application_progress(payload.status)
        if payload.status == "hired":
            application["hired_at"] = datetime.now().isoformat(timespec="seconds")
        sync_current_application(candidate, application)
    else:
        candidate["status"] = payload.status
        if payload.status == "hired":
            candidate["hired_at"] = datetime.now().isoformat(timespec="seconds")
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
        filename=candidate.get("resume_filename") or "resume.pdf"
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
    resume_text, contents = await read_resume_text(resume)
        
    if not resume_text:
        resume_text = "PDF text extraction did not find readable text. Review the original uploaded resume file."
        
    # 1. Invoke Resume Agent (Ingest and profile)
    try:
        profile_data = run_resume_agent(resume_text, prestige_neutralize=False)
    except Exception as e:
        print(f"Error running resume agent: {e}")
        profile_data = {
            "name": name,
            "headline": "Full-Stack Developer",
            "location": "Local",
            "about": "Inbound applicant",
            "experiences": [],
            "education": []
        }
    profile_data = normalize_profile_details(apply_resume_extraction_warning(profile_data, resume_text))
        
    # Fetch job requirements
    job = db.get("positions", {}).get(str(position_id))
    if not job:
        raise HTTPException(status_code=404, detail="Selected position not found.")
    if not is_open_for_applications(job):
        raise HTTPException(status_code=400, detail="Selected position is not open for applications.")
        
    # 2. Invoke Matching Agent (Debate committee)
    try:
        match_results = run_matching_agent(job, profile_data)
    except Exception as e:
        print(f"Error running matching agent: {e}")
        match_results = {
            "debate": {"critical_recruiter_cons": ["Stack verification required."], "talent_advocate_pros": ["Strong interest in the position."]},
            "scores": {"technical": 75, "domain": 70, "culture": 80, "trajectory_slope": 75}
        }
        
    # 3. Invoke Candidate Interview Agent (Phase A - Question generation)
    try:
        custom_questions = run_interview_agent_phase_a(profile_data, match_results, job)
    except Exception as e:
        print(f"Error generating screening questions: {e}")
        custom_questions = [
            "What technical challenge on your resume was the most architecturally complex, and how did you approach it?",
            "How do you ensure code scalability and high performance when designing REST endpoints?",
            "Describe how you structure React component hierarchies for high maintainability."
        ]
        
    resume_path = save_resume_file(email_clean, resume.filename or "resume.pdf", contents)
    profile_picture_url = extract_profile_picture(email_clean, contents)
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
        "linkedin_url": "",
        "profile_data": profile_data,
        "resume_filename": resume.filename,
        "resume_path": resume_path,
        "resume_url": f"/api/v1/candidates/{email_clean}/resume",
        "resume_text": resume_text,
        "resume_summary": resume_summary,
        "profile_picture_url": profile_picture_url,
        "sourcing_pitch": "Inbound applicant with verified profile details.",
        "outreach_email": "Thank you for applying!",
        "match_results": match_results,
        "custom_questions": custom_questions,
        "answers": [],
        "evaluation": {},
        "applications": [application],
        "profile_verified": not get_missing_profile_fields(profile_data),
        "email_verified": False,
        "password_hash": hash_password(password)
    }

    verification_code = create_email_verification(candidate_record)
    verification_sent = send_or_log_verification_email(email_clean, verification_code)
    db.setdefault("candidates", {})[email_clean] = candidate_record
    save_db(db)
    response = serialize_candidate(candidate_record, email_clean)
    response["verification_sent"] = verification_sent
    response["prototype_verification_code"] = verification_code
    return response

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
    if application.get("status") == "completed":
        raise HTTPException(status_code=409, detail="This position's screening has already been completed.")
        
    # Validate answers length
    for idx, ans in enumerate(payload.answers):
        if len(ans.strip()) < 10:
            raise HTTPException(status_code=400, detail=f"Answer for Question {idx+1} is too short. (Minimum 10 characters)")
            
    # Fetch job requirements
    job_id = application.get("position_id")
    job = db.get("positions", {}).get(str(job_id), {})
    
    # Invoke Candidate Interview Agent (Phase B Evaluation)
    try:
        evaluation = run_interview_agent_phase_b(application.get("custom_questions", []), payload.answers, job)
    except Exception as e:
        print(f"Error evaluating sandbox answers: {e}")
        evaluation = {
            "screening_score": 80,
            "critiques": [{"question": q, "critique": "Solid response."} for q in application.get("custom_questions", [])]
        }
        
    # Invoke Report Agent to generate upskilling roadmap
    try:
        report_data = run_report_agent(candidate.get("profile_data", {}), candidate.get("match_results", {}), job)
        roadmap = report_data.get("upskilling_roadmap", {})
    except Exception as e:
        print(f"Error compiling upskilling roadmap: {e}")
        roadmap = {
            "week_1": "Standard codebase structural setup.",
            "week_2": "Detailed system configuration setup.",
            "week_3": "Automated verification setup."
        }
        
    application["status"] = "screening"
    application["progress"] = get_application_progress("screening")
    application["answers"] = payload.answers
    application["screening_submitted_at"] = datetime.now().isoformat(timespec="seconds")
    application["evaluation"] = {
        "screening_score": evaluation.get("screening_score", 80),
        "critiques": evaluation.get("critiques", []),
        "score_breakdown": evaluation.get("score_breakdown", {}),
        "position_fit_verdict": evaluation.get("position_fit_verdict", ""),
        "hiring_recommendation": evaluation.get("hiring_recommendation", ""),
        "role_alignment_summary": evaluation.get("role_alignment_summary", ""),
        "upskilling_roadmap": roadmap
    }
    sync_current_application(candidate, application)
    
    save_db(db)
    return serialize_application_candidate(candidate, email_clean, application)

@router.post("/scrape")
def scrape_profile(payload: ScrapePayload):
    db = load_db()
    try:
        profile_data = scrape_linkedin_profile(payload.linkedin_url.strip())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    candidate_name = profile_data["name"]
    candidate_email = profile_data["email"]

    # Fetch job requirements
    job = db.get("positions", {}).get(str(payload.position_id))
    if not job:
        raise HTTPException(status_code=404, detail="Selected position not found.")

    # 1. Invoke Matching Agent (Debate)
    try:
        match_results = run_matching_agent(job, profile_data)
    except Exception as e:
        print(f"Scraper matching debate error: {e}")
        match_results = build_fast_match_results(job, profile_data)
        
    # 2. Invoke Candidate Interview Agent (Phase A screening questions)
    try:
        custom_questions = run_interview_agent_phase_a(profile_data, match_results, job)
    except Exception as e:
        print(f"Scraper question generation error: {e}")
        title = job.get("title", "this position")
        requirements = job.get("requirements", [])
        primary_requirement = requirements[0] if requirements else "the core responsibilities"
        custom_questions = [
            f"Describe a specific example that shows your experience with {primary_requirement} for the {title} role.",
            f"What part of the {title} role best matches your recent work, and what evidence can you share?",
            f"What gap would you need to close first to succeed in this {title} position?"
        ]
        
    # 3. Invoke Report Agent (Pitches & Outreach)
    try:
        report_data = run_report_agent(profile_data, match_results, job)
        sourcing_pitch = report_data.get("sourcing_pitch", "")
        outreach_email = report_data.get("outreach_email", "")
    except Exception as e:
        print(f"Scraper report synthesis error: {e}")
        report_data = build_fast_outreach(profile_data, job)
        sourcing_pitch = report_data["sourcing_pitch"]
        outreach_email = report_data["outreach_email"]

    staged_candidate = {
        "name": candidate_name,
        "email": candidate_email,
        "status": "staged",
        "position_id": payload.position_id,
        "is_sourced": True,
        "linkedin_url": payload.linkedin_url,
        "profile_data": profile_data,
        "sourcing_pitch": sourcing_pitch,
        "outreach_email": outreach_email,
        "match_results": match_results,
        "custom_questions": custom_questions,
        "answers": [],
        "evaluation": {}
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

    generated = []
    role_text = f"{job.get('title', '')} {job.get('department', '')} {' '.join(job.get('requirements', []))}".lower()
    if any(term in role_text for term in ("baker", "bakery", "pastry", "chef", "cook", "kitchen", "food")):
        sample_profiles = [
            {
                "name": "Nadia Lim",
                "email": "nadia.lim@example.com",
                "headline": "Bakery assistant experienced with breads, pastries, and food hygiene",
                "location": "Kuala Lumpur, MY",
                "about": "Prototype sourced profile for bakery roles. Verify employment history before outreach.",
                "experiences": [
                    {"title": "Bakery Assistant", "company": "Neighborhood Bakery", "duration": "2022 - Present", "description": "Prepared dough, monitored oven timing, and followed hygiene routines."}
                ],
                "education": [{"school": "Culinary Training Centre", "degree": "Certificate in Baking"}],
                "scrape_status": "prototype_auto_source",
                "scrape_warning": "Automatically generated prototype candidate; not scraped from LinkedIn."
            },
            {
                "name": "Hafiz Rahman",
                "email": "hafiz.rahman@example.com",
                "headline": "Pastry cook focused on recipe consistency and production timing",
                "location": "Selangor, MY",
                "about": "Prototype sourced profile for food service screening. Verify details before outreach.",
                "experiences": [
                    {"title": "Pastry Cook", "company": "Hotel Kitchen", "duration": "2020 - Present", "description": "Produced pastries, checked freshness, and managed early shift prep."}
                ],
                "education": [{"school": "Hospitality Academy", "degree": "Diploma in Culinary Arts"}],
                "scrape_status": "prototype_auto_source",
                "scrape_warning": "Automatically generated prototype candidate; not scraped from LinkedIn."
            }
        ]
    else:
        sample_profiles = [
            {
                "name": "Maya Tan",
                "email": "maya.tan@example.com",
                "headline": "Senior Frontend Engineer specializing in React performance",
                "location": "Kuala Lumpur, MY",
                "about": "Prototype sourced profile for technical roles. Verify employment history before outreach.",
                "experiences": [
                    {"title": "Senior Frontend Engineer", "company": "Regional SaaS Platform", "duration": "2021 - Present"},
                    {"title": "Software Engineer", "company": "Fintech Product Studio", "duration": "2018 - 2021"}
                ],
                "education": [{"school": "Asia Pacific University", "degree": "BS Software Engineering"}],
                "scrape_status": "prototype_auto_source",
                "scrape_warning": "Automatically generated prototype candidate; not scraped from LinkedIn."
            },
            {
                "name": "Daniel Lim",
                "email": "daniel.lim@example.com",
                "headline": "Backend Engineer focused on Node.js services and distributed queues",
                "location": "Singapore",
                "about": "Prototype sourced profile for technical roles. Verify employment history before outreach.",
                "experiences": [
                    {"title": "Backend Engineer", "company": "Cloud Operations Company", "duration": "2020 - Present"},
                    {"title": "Full-Stack Developer", "company": "Logistics Startup", "duration": "2017 - 2020"}
                ],
                "education": [{"school": "National University", "degree": "Computer Science"}],
                "scrape_status": "prototype_auto_source",
                "scrape_warning": "Automatically generated prototype candidate; not scraped from LinkedIn."
            },
            {
                "name": "Aisha Rahman",
                "email": "aisha.rahman@example.com",
                "headline": "Full-stack product engineer with analytics and platform experience",
                "location": "Penang, MY",
                "about": "Prototype sourced profile for technical roles. Verify employment history before outreach.",
                "experiences": [
                    {"title": "Product Engineer", "company": "Analytics Platform", "duration": "2022 - Present"},
                    {"title": "Software Developer", "company": "E-commerce Company", "duration": "2019 - 2022"}
                ],
                "education": [{"school": "University of Malaya", "degree": "Information Systems"}],
                "scrape_status": "prototype_auto_source",
                "scrape_warning": "Automatically generated prototype candidate; not scraped from LinkedIn."
            }
        ]
    sample_profiles = sample_profiles[: max(1, min(payload.count, 5))]

    for profile_data in sample_profiles:
        candidate_email = profile_data["email"]
        match_results = build_fast_match_results(job, profile_data)
        custom_questions = [
            f"Describe your most relevant experience for the {job.get('title', 'selected')} role.",
            f"What evidence shows you can meet the main requirements for {job.get('title', 'this position')}?",
            "What gap would you want to close before starting this role?"
        ]
        report_data = build_fast_outreach(profile_data, job)
        sourcing_pitch = report_data["sourcing_pitch"]
        outreach_email = report_data["outreach_email"]

        candidate_record = {
            "name": profile_data["name"],
            "email": candidate_email,
            "status": "staged",
            "position_id": payload.position_id,
            "is_sourced": True,
            "linkedin_url": f"https://www.linkedin.com/in/{profile_data['name'].lower().replace(' ', '-')}",
            "profile_data": profile_data,
            "sourcing_pitch": sourcing_pitch,
            "outreach_email": outreach_email,
            "match_results": match_results,
            "custom_questions": custom_questions,
            "answers": [],
            "evaluation": {}
        }
        db.setdefault("candidates", {})[candidate_email] = candidate_record
        generated.append(serialize_candidate(candidate_record, candidate_email))

    save_db(db)
    return generated

@router.post("/invite")
def invite_candidate(payload: InvitePayload):
    db = load_db()
    email_clean = payload.email.strip().lower()
    candidate = db.setdefault("candidates", {}).get(email_clean)
    
    if not candidate:
        raise HTTPException(status_code=404, detail="Staged candidate profile not found.")
        
    candidate["status"] = "invited"
    if payload.outreach_email:
        candidate["outreach_email"] = payload.outreach_email
    if payload.hr_feedback is not None:
        candidate["hr_feedback"] = payload.hr_feedback

    # Trigger Outreach SMTP dispatch
    try:
        email_sent = send_recruitment_email(
            to_email=email_clean,
            subject=f"Exclusive Sourcing Invitation - {candidate.get('profile_data', {}).get('headline')}",
            body=candidate.get("outreach_email", ""),
            smtp_settings=payload.smtp_settings
        )
    except Exception as e:
        print(f"SMTP dispatch failure: {e}")
        email_sent = False

    save_db(db)
    return {
        "candidate": serialize_candidate(candidate, email_clean),
        "outreach_sent": email_sent
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
        application["status"] = "rejected"
        application["progress"] = get_application_progress("rejected")
        application["hr_feedback"] = payload.hr_feedback or ""
        application["rejection_message"] = rejection_message
        application["rejected_at"] = datetime.now().isoformat(timespec="seconds")
        sync_current_application(candidate, application)
    else:
        candidate["status"] = "rejected"
        candidate["hr_feedback"] = payload.hr_feedback or ""
        candidate["rejection_message"] = rejection_message
        candidate["rejected_at"] = datetime.now().isoformat(timespec="seconds")

    save_db(db)
    if application:
        return serialize_application_candidate(candidate, email_clean, application)
    return serialize_candidate(candidate, email_clean)

@router.post("/{email}/schedule-interview")
def schedule_interview(email: str, payload: InterviewSlotPayload):
    db = load_db()
    email_clean = email.strip().lower()
    candidate = db.setdefault("candidates", {}).get(email_clean)
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found.")

    application = find_application(candidate, payload.position_id)
    interview_slot = {
        "date": payload.interview_date,
        "time": payload.interview_time,
        "location": payload.interview_location,
        "notes": payload.interview_notes or ""
    }
    if application:
        application["status"] = "interview_scheduled"
        application["progress"] = get_application_progress("interview_scheduled")
        application["interview_slot"] = interview_slot
        application["interview_scheduled_at"] = datetime.now().isoformat(timespec="seconds")
        sync_current_application(candidate, application)
    else:
        candidate["status"] = "interview_scheduled"
        candidate["interview_slot"] = interview_slot

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
    email_sent = False
    try:
        email_sent = send_recruitment_email(
            to_email=email_clean,
            subject=f"Interview Invitation — {position_title}",
            body=interview_body
        )
    except Exception as e:
        print(f"Interview invite SMTP failure: {e}")

    save_db(db)
    result = serialize_application_candidate(candidate, email_clean, application) if application else serialize_candidate(candidate, email_clean)
    result["interview_email_sent"] = email_sent
    return result

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
