from fastapi import APIRouter, Query
from typing import Optional

from ..database import get_recent_agent_events


router = APIRouter(prefix="/agents", tags=["Agents"])


@router.get("/events")
def read_agent_events(
    candidate_email: Optional[str] = Query(default=None),
    position_id: Optional[int] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=250),
):
    return get_recent_agent_events(candidate_email=candidate_email, position_id=position_id, limit=limit)
