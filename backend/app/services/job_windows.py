from datetime import datetime
from typing import Any, Dict, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException

from ..config import settings


def get_app_timezone() -> ZoneInfo:
    try:
        return ZoneInfo(settings.APP_TIMEZONE)
    except ZoneInfoNotFoundError:
        raise HTTPException(status_code=500, detail=f"Invalid APP_TIMEZONE setting: {settings.APP_TIMEZONE}")


def parse_position_time(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        normalized = value.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(normalized)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=get_app_timezone())
        return parsed
    except ValueError:
        raise HTTPException(status_code=400, detail="Position dates must be valid ISO date-time values.")


def validate_position_window(open_time: Optional[str], end_time: Optional[str]) -> None:
    starts_at = parse_position_time(open_time)
    ends_at = parse_position_time(end_time)
    if starts_at and ends_at and ends_at <= starts_at:
        raise HTTPException(status_code=400, detail="Position end time must be after open time.")


def get_position_window_status(position: Dict[str, Any]) -> str:
    if not position.get("active", True):
        return "inactive"

    starts_at = parse_position_time(position.get("open_time"))
    ends_at = parse_position_time(position.get("end_time"))
    reference = starts_at or ends_at
    now = datetime.now(reference.tzinfo) if reference and reference.tzinfo else datetime.now()

    if starts_at and now < starts_at:
        return "scheduled"
    if ends_at and now > ends_at:
        return "closed"
    return "open"


def is_open_for_applications(position: Dict[str, Any]) -> bool:
    return get_position_window_status(position) == "open"


def serialize_position(position: Dict[str, Any]) -> Dict[str, Any]:
    status = get_position_window_status(position)
    return {
        **position,
        "application_status": status,
        "is_open_for_applications": status == "open"
    }
