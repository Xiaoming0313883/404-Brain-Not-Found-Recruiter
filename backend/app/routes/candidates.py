import hashlib
import hmac
import io
import os
import re
import uuid
from datetime import datetime
from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, EmailStr
from typing import List, Optional, Dict, Any
from pypdf import PdfReader

from ..database import load_db, save_db
from ..config import settings
from ..services.job_windows import is_open_for_applications
from ..services.linkedin_profiles import build_fast_match_results, build_fast_outreach, scrape_linkedin_profile
from ..services.agents import (
    run_resume_agent,
    run_matching_agent,
    run_interview_agent_phase_a,
    run_interview_agent_phase_b,
    run_report_agent
)
from ..services.mailer import send_recruitment_email

router = APIRouter(prefix="/candidates", tags=["Candidates"])
MAX_RESUME_BYTES = 10 * 1024 * 1024
UPLOAD_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "uploads"))
RESUME_DIR = os.path.join(UPLOAD_ROOT, "resumes")
PROFILE_IMAGE_DIR = os.path.join(UPLOAD_ROOT, "profile_pictures")

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

class CandidateApplyPositionPayload(BaseModel):
    position_id: int

class ScrapePayload(BaseModel):
    position_id: int
    linkedin_url: str
    smtp_settings: Optional[Dict[str, Any]] = None

class InvitePayload(BaseModel):
    email: str
    outreach_email: Optional[str] = None
    smtp_settings: Optional[Dict[str, Any]] = None

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

def build_application_id(position_id: int) -> str:
    return f"position-{position_id}"

def get_application_progress(status: str) -> int:
    return {
        "profile": 10,
        "staged": 20,
        "invited": 30,
        "applied": 40,
        "screening": 70,
        "completed": 100
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
        "outreach_email": application.get("outreach_email", candidate.get("outreach_email", ""))
    })
    return serialized

def serialize_candidate(candidate: Dict[str, Any], management_email: Optional[str] = None) -> Dict[str, Any]:
    normalize_candidate_applications(candidate)
    serialized = {k: v for k, v in candidate.items() if k != "password_hash"}
    serialized["management_email"] = management_email or candidate.get("email")
    serialized["has_password"] = bool(candidate.get("password_hash"))
    serialized["application_count"] = len(candidate.get("applications", []))
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
    candidate = db.get("candidates", {}).get(email.strip().lower())
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate session not found.")
    return serialize_candidate(candidate, email.strip().lower())

@router.post("/login")
def login_candidate(payload: CandidateLoginPayload):
    db = load_db()
    email_clean = payload.email.strip().lower()
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
    email_clean = email.strip().lower()
    candidate = db.get("candidates", {}).get(email_clean)
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate account not found.")

    candidate["password_hash"] = hash_password(payload.password)
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
        resume_text = ""
        for page in pdf_reader.pages:
            resume_text += page.extract_text() or ""
        return resume_text, contents
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read PDF resume: {e}")

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
        custom_questions = run_interview_agent_phase_a(profile_data, match_results)
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
    email_clean = email.strip().lower()

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

    resume_path = save_resume_file(email_clean, resume.filename or "resume.pdf", contents)
    profile_picture_url = extract_profile_picture(email_clean, contents)
    resume_summary = get_resume_summary(profile_data, resume_text)

    candidate_record = {
        "name": name,
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
        "password_hash": hash_password(password)
    }

    db.setdefault("candidates", {})[email_clean] = candidate_record
    save_db(db)
    return serialize_candidate(candidate_record, email_clean)

@router.post("/{email}/apply-position")
def apply_candidate_to_position(email: str, payload: CandidateApplyPositionPayload):
    db = load_db()
    email_clean = email.strip().lower()
    candidate = db.setdefault("candidates", {}).get(email_clean)
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate account not found.")

    application = build_interview_for_position(db, candidate, payload.position_id)
    save_db(db)
    return serialize_application_candidate(candidate, email_clean, application)

@router.patch("/{email}/status")
def update_candidate_status(email: str, payload: CandidateStatusPayload):
    allowed_statuses = {"profile", "staged", "invited", "applied", "screening", "completed", "inactive"}
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
        sync_current_application(candidate, application)
    else:
        candidate["status"] = payload.status
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
    email_clean = email.strip().lower()
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
        custom_questions = run_interview_agent_phase_a(profile_data, match_results)
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

    candidate_record = {
        "name": name,
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
        "password_hash": hash_password(password)
    }
    
    db.setdefault("candidates", {})[email_clean] = candidate_record
    save_db(db)
    return serialize_candidate(candidate_record, email_clean)

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
        
    application["status"] = "completed"
    application["progress"] = get_application_progress("completed")
    application["answers"] = payload.answers
    application["completed_at"] = datetime.now().isoformat(timespec="seconds")
    application["evaluation"] = {
        "screening_score": evaluation.get("screening_score", 80),
        "critiques": evaluation.get("critiques", []),
        "upskilling_roadmap": roadmap
    }
    sync_current_application(candidate, application)
    
    save_db(db)
    return serialize_application_candidate(candidate, email_clean, application)

@router.post("/scrape")
def scrape_profile(payload: ScrapePayload):
    db = load_db()
    profile_data = scrape_linkedin_profile(payload.linkedin_url.strip())
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
        match_results = {
            "debate": {"critical_recruiter_cons": ["Lacks direct local stack exposure."], "talent_advocate_pros": ["Strong cloud scaling abilities."]},
            "scores": {"technical": 85, "domain": 80, "culture": 85, "trajectory_slope": 90}
        }
        
    # 2. Invoke Candidate Interview Agent (Phase A screening questions)
    try:
        custom_questions = run_interview_agent_phase_a(profile_data, match_results)
    except Exception as e:
        print(f"Scraper question generation error: {e}")
        custom_questions = [
            "Describe your experience setting up robust high-availability clusters using Playwright.",
            "How do you manage secret keys in multi-tiered cloud infrastructure pipelines?",
            "What is your approach to handling service discovery crashes under load?"
        ]
        
    # 3. Invoke Report Agent (Pitches & Outreach)
    try:
        report_data = run_report_agent(profile_data, match_results, job)
        sourcing_pitch = report_data.get("sourcing_pitch", "")
        outreach_email = report_data.get("outreach_email", "")
    except Exception as e:
        print(f"Scraper report synthesis error: {e}")
        sourcing_pitch = "Highly recommended systems engineer."
        outreach_email = "Hello, we found your LinkedIn profile..."

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
    sample_profiles = [
        {
            "name": "Maya Tan",
            "email": "maya.tan@example.com",
            "headline": "Senior Frontend Engineer specializing in React performance",
            "location": "Kuala Lumpur, MY",
            "about": "Builds design systems, high-traffic React interfaces, and API-driven product workflows.",
            "experiences": [
                {"title": "Senior Frontend Engineer", "company": "Regional SaaS Platform", "duration": "2021 - Present"},
                {"title": "Software Engineer", "company": "Fintech Product Studio", "duration": "2018 - 2021"}
            ],
            "education": [{"school": "Asia Pacific University", "degree": "BS Software Engineering"}]
        },
        {
            "name": "Daniel Lim",
            "email": "daniel.lim@example.com",
            "headline": "Backend Engineer focused on Node.js services and distributed queues",
            "location": "Singapore",
            "about": "Owns microservice APIs, event-driven processing, and observability for B2B systems.",
            "experiences": [
                {"title": "Backend Engineer", "company": "Cloud Operations Company", "duration": "2020 - Present"},
                {"title": "Full-Stack Developer", "company": "Logistics Startup", "duration": "2017 - 2020"}
            ],
            "education": [{"school": "National University", "degree": "Computer Science"}]
        },
        {
            "name": "Aisha Rahman",
            "email": "aisha.rahman@example.com",
            "headline": "Full-stack product engineer with analytics and platform experience",
            "location": "Penang, MY",
            "about": "Connects frontend UX, backend APIs, and product analytics for fast-moving teams.",
            "experiences": [
                {"title": "Product Engineer", "company": "Analytics Platform", "duration": "2022 - Present"},
                {"title": "Software Developer", "company": "E-commerce Company", "duration": "2019 - 2022"}
            ],
            "education": [{"school": "University of Malaya", "degree": "Information Systems"}]
        }
    ][: max(1, min(payload.count, 5))]

    for profile_data in sample_profiles:
        candidate_email = profile_data["email"]
        match_results = build_fast_match_results(job, profile_data)
        custom_questions = [
            "Describe the most complex system you owned end-to-end.",
            "How do you debug performance regressions in production?",
            "How do you balance delivery speed with maintainable architecture?"
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
