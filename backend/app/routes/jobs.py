from datetime import datetime
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Any, Dict, List, Optional
from ..database import load_db, save_db
from ..services.agents import run_requirement_agent, run_requirement_intake_agent
from ..services.job_windows import is_open_for_applications, serialize_position, validate_position_window

router = APIRouter(prefix="/jobs", tags=["Jobs"])

class JobCreate(BaseModel):
    title: str
    department: str
    description: Optional[str] = None
    requirements: Optional[List[str]] = None
    active: bool = True
    open_time: Optional[str] = None
    end_time: Optional[str] = None
    sourcing_criteria: Optional[Dict[str, Any]] = None
    intake_chat: Optional[List[Dict[str, str]]] = None

class JobUpdate(BaseModel):
    title: Optional[str] = None
    department: Optional[str] = None
    description: Optional[str] = None
    requirements: Optional[List[str]] = None
    active: Optional[bool] = None
    open_time: Optional[str] = None
    end_time: Optional[str] = None
    sourcing_criteria: Optional[Dict[str, Any]] = None
    intake_chat: Optional[List[Dict[str, str]]] = None

class JobIntakePayload(BaseModel):
    title: str
    department: str
    chat_messages: List[Dict[str, str]] = []

@router.get("")
def get_jobs(active_only: bool = False):
    db = load_db()
    application_counts: Dict[int, int] = {}
    for candidate in db.get("candidates", {}).values():
        applications = candidate.get("applications") or []
        if not applications and candidate.get("position_id"):
            applications = [{"position_id": candidate.get("position_id")}]
        for application in applications:
            position_id = application.get("position_id")
            if position_id:
                application_counts[position_id] = application_counts.get(position_id, 0) + 1
    positions = [
        {**serialize_position(position), "application_count": application_counts.get(position.get("id"), 0)}
        for position in db.get("positions", {}).values()
    ]
    if active_only:
        return [position for position in positions if is_open_for_applications(position)]
    return positions

@router.post("/intake")
def get_next_intake_turn(payload: JobIntakePayload):
    if not payload.title.strip() or not payload.department.strip():
        raise HTTPException(status_code=400, detail="Title and department are required before starting intake.")
    return run_requirement_intake_agent(payload.title.strip(), payload.department.strip(), payload.chat_messages)

@router.post("")
def create_job(payload: JobCreate):
    validate_position_window(payload.open_time, payload.end_time)
    db = load_db()
    positions = db.setdefault("positions", {})
    
    # Calculate unique incremental ID
    new_id = 1
    if positions:
        new_id = max(int(k) for k in positions.keys()) + 1
        
    intake_context = payload.sourcing_criteria or {}
    provided_description = payload.description or intake_context.get("generated_description") or ""
    provided_requirements = payload.requirements or intake_context.get("generated_requirements") or []

    # Trigger the Employer Requirement Agent to generate the role spec and search profile.
    try:
        req_analysis = run_requirement_agent(
            payload.title,
            f"{provided_description}\n\nHiring Manager Intake: {intake_context}"
        )
        generated_description = req_analysis.get("job_description") or provided_description
        generated_requirements = req_analysis.get("requirements") or provided_requirements
        boolean_queries = req_analysis.get("boolean_queries", "")
        pillars = req_analysis.get("pillars", generated_requirements[:3])
        behavioral = req_analysis.get("behavioral", [])
    except Exception as e:
        print(f"Error in requirement profiling: {e}")
        generated_description = provided_description or f"{payload.title} role in {payload.department}."
        generated_requirements = provided_requirements or [f"Relevant experience for {payload.title}"]
        boolean_queries = f'("{payload.title}")'
        pillars = generated_requirements[:3]
        behavioral = []

    new_job = {
        "id": new_id,
        "title": payload.title,
        "department": payload.department,
        "description": generated_description,
        "requirements": generated_requirements,
        "active": payload.active,
        "open_time": payload.open_time,
        "end_time": payload.end_time,
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "sourcing_criteria": payload.sourcing_criteria or {},
        "intake_chat": payload.intake_chat or [],
        "pillars": pillars,
        "behavioral": behavioral,
        "boolean_queries": boolean_queries
    }
    
    positions[str(new_id)] = new_job
    save_db(db)
    
    return serialize_position(new_job)

@router.patch("/{job_id}")
def update_job(job_id: int, payload: JobUpdate):
    db = load_db()
    positions = db.setdefault("positions", {})
    job = positions.get(str(job_id))
    if not job:
        raise HTTPException(status_code=404, detail="Position not found.")

    update_data = payload.model_dump(exclude_unset=True)
    next_open_time = update_data.get("open_time", job.get("open_time"))
    next_end_time = update_data.get("end_time", job.get("end_time"))
    validate_position_window(next_open_time, next_end_time)
    should_rebuild_query = any(key in update_data for key in ("title", "description", "requirements", "sourcing_criteria"))
    job.update(update_data)

    if should_rebuild_query:
        intake_context = job.get("sourcing_criteria", {})
        provided_description = job.get("description") or intake_context.get("generated_description") or ""
        provided_requirements = job.get("requirements") or intake_context.get("generated_requirements") or []
        try:
            req_analysis = run_requirement_agent(
                job["title"],
                f"{provided_description}\n\nHiring Manager Intake: {intake_context}"
            )
            job["description"] = req_analysis.get("job_description") or provided_description
            job["requirements"] = req_analysis.get("requirements") or provided_requirements
            job["boolean_queries"] = req_analysis.get("boolean_queries", job.get("boolean_queries", ""))
            job["pillars"] = req_analysis.get("pillars", job.get("requirements", [])[:3])
            job["behavioral"] = req_analysis.get("behavioral", job.get("behavioral", []))
        except Exception as e:
            print(f"Error refreshing requirement profile: {e}")

    save_db(db)
    return serialize_position(job)
