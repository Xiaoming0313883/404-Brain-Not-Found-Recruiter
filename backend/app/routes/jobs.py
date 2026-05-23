from datetime import datetime
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Any, Dict, List, Optional
from ..database import load_db, save_db
from ..services.agents import run_requirement_agent
from ..services.job_windows import is_open_for_applications, serialize_position, validate_position_window

router = APIRouter(prefix="/jobs", tags=["Jobs"])

class JobCreate(BaseModel):
    title: str
    department: str
    description: str
    requirements: List[str]
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

@router.post("")
def create_job(payload: JobCreate):
    validate_position_window(payload.open_time, payload.end_time)
    db = load_db()
    positions = db.setdefault("positions", {})
    
    # Calculate unique incremental ID
    new_id = 1
    if positions:
        new_id = max(int(k) for k in positions.keys()) + 1
        
    # Trigger the Employer Requirement Agent to extract skill pillars and Boolean queries
    try:
        req_analysis = run_requirement_agent(
            payload.title,
            f"{payload.description}\n\nHiring Manager Intake: {payload.sourcing_criteria or {}}"
        )
        boolean_queries = req_analysis.get("boolean_queries", "")
        pillars = req_analysis.get("pillars", payload.requirements[:3])
        behavioral = req_analysis.get("behavioral", [])
    except Exception as e:
        print(f"Error in requirement profiling: {e}")
        boolean_queries = f'("{payload.title}")'
        pillars = payload.requirements[:3]
        behavioral = []

    new_job = {
        "id": new_id,
        "title": payload.title,
        "department": payload.department,
        "description": payload.description,
        "requirements": payload.requirements,
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
        try:
            req_analysis = run_requirement_agent(
                job["title"],
                f"{job['description']}\n\nHiring Manager Intake: {job.get('sourcing_criteria', {})}"
            )
            job["boolean_queries"] = req_analysis.get("boolean_queries", job.get("boolean_queries", ""))
            job["pillars"] = req_analysis.get("pillars", job.get("requirements", [])[:3])
            job["behavioral"] = req_analysis.get("behavioral", job.get("behavioral", []))
        except Exception as e:
            print(f"Error refreshing requirement profile: {e}")

    save_db(db)
    return serialize_position(job)
