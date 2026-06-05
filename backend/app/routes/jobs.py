from datetime import datetime
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Any, Dict, List, Optional
from ..database import load_db, save_db
from ..demo_fixtures import DEMO_POSITION_ID, demo_job_context, demo_job_intake_response, demo_job_payload
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
    address: Optional[str] = None
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
    address: Optional[str] = None
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
    return demo_job_intake_response(payload.chat_messages)

@router.post("")
def create_job(payload: JobCreate):
    validate_position_window(payload.open_time, payload.end_time)
    db = load_db()
    positions = db.setdefault("positions", {})
    positions.clear()
    new_job = demo_job_payload(
        DEMO_POSITION_ID,
        active=payload.active,
        open_time=payload.open_time,
        end_time=payload.end_time,
        address=payload.address,
        created_at=datetime.now().isoformat(timespec="seconds"),
        sourcing_criteria={**demo_job_context(), **(payload.sourcing_criteria or {})},
        intake_chat=payload.intake_chat or [],
    )
    positions[str(DEMO_POSITION_ID)] = new_job
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
    demo_job = demo_job_payload(
        job_id,
        active=update_data.get("active", job.get("active", True)),
        open_time=next_open_time,
        end_time=next_end_time,
        address=update_data.get("address", job.get("address", "")),
        created_at=job.get("created_at") or datetime.now().isoformat(timespec="seconds"),
        sourcing_criteria={**demo_job_context(), **(update_data.get("sourcing_criteria") or job.get("sourcing_criteria") or {})},
        intake_chat=update_data.get("intake_chat", job.get("intake_chat", [])),
    )
    job.clear()
    job.update(demo_job)

    save_db(db)
    return serialize_position(job)

@router.delete("/{job_id}")
def delete_job(job_id: int):
    db = load_db()
    positions = db.setdefault("positions", {})
    job_key = str(job_id)
    job = positions.get(job_key)
    if not job:
        raise HTTPException(status_code=404, detail="Position not found.")

    deleted = positions.pop(job_key)
    save_db(db)
    return {"deleted": True, "position": serialize_position(deleted)}
