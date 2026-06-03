from __future__ import annotations

import base64
import json
from datetime import datetime
from typing import Any, Dict, List
import threading

from .config import settings

try:
    from supabase import Client, create_client
except Exception:  # pragma: no cover - exercised only when dependencies are missing
    Client = Any  # type: ignore
    create_client = None  # type: ignore


db_lock = threading.Lock()
_supabase_client: Client | None = None


def _decode_supabase_jwt_role(key: str) -> str:
    parts = (key or "").split(".")
    if len(parts) < 2:
        return ""
    try:
        payload = parts[1] + "=" * (-len(parts[1]) % 4)
        decoded = json.loads(base64.urlsafe_b64decode(payload.encode()).decode())
        return str(decoded.get("role") or "")
    except Exception:
        return ""


def require_supabase_settings() -> None:
    if not settings.SUPABASE_URL.strip() or not settings.SUPABASE_SERVICE_ROLE_KEY.strip():
        raise RuntimeError(
            "Supabase is required for this agentic build. Set SUPABASE_URL and "
            "SUPABASE_SERVICE_ROLE_KEY, then run backend/supabase_schema.sql."
        )
    key_role = _decode_supabase_jwt_role(settings.SUPABASE_SERVICE_ROLE_KEY.strip())
    if key_role and key_role != "service_role":
        raise RuntimeError(
            "SUPABASE_SERVICE_ROLE_KEY is not a service-role key. "
            f"It decodes as role '{key_role}', which is blocked by row-level security. "
            "Use the Supabase Project Settings > API > service_role secret key on the backend only."
        )
    if create_client is None:
        raise RuntimeError("The supabase package is not installed. Run pip install -r backend/requirements.txt.")


def get_supabase_client() -> Client:
    global _supabase_client
    require_supabase_settings()
    if _supabase_client is None:
        _supabase_client = create_client(
            settings.SUPABASE_URL.strip(),
            settings.SUPABASE_SERVICE_ROLE_KEY.strip(),
        )
    return _supabase_client


def _execute(query: Any) -> List[Dict[str, Any]]:
    try:
        response = query.execute()
        return list(getattr(response, "data", None) or [])
    except Exception as exc:
        message = str(exc)
        if "row-level security" in message.lower() or "42501" in message:
            raise RuntimeError(
                "Supabase row-level security blocked this backend write. "
                "This almost always means SUPABASE_SERVICE_ROLE_KEY is set to the anon/public key "
                "or another non-service key. Use the service_role secret key in backend/.env, never in frontend env."
            ) from exc
        raise


def _row_payload(row: Dict[str, Any]) -> Dict[str, Any]:
    payload = row.get("payload")
    return payload if isinstance(payload, dict) else {}


def _table_key_set(table: str, key: str) -> set[str]:
    rows = _execute(get_supabase_client().table(table).select(key))
    return {str(row.get(key)) for row in rows if row.get(key) is not None}


def init_db() -> None:
    """Validate the Supabase connection and seed the default job when empty."""
    client = get_supabase_client()
    try:
        rows = _execute(client.table("positions").select("id").limit(1))
    except Exception as exc:
        raise RuntimeError(
            "Supabase tables are unavailable. Run backend/supabase_schema.sql in the Supabase SQL editor."
        ) from exc

    if rows:
        return

    default_job = {
        "id": 1,
        "title": "Senior Full-Stack Engineer",
        "department": "Engineering",
        "description": "We are seeking an experienced full-stack engineer to build scalable distributed systems.",
        "requirements": ["5+ years experience", "React & Node.js", "Distributed systems"],
        "active": True,
        "open_time": "2026-01-01T00:00",
        "end_time": "2026-12-31T23:59",
        "created_at": "2026-01-15T09:00",
        "sourcing_criteria": {},
        "intake_chat": [],
        "pillars": ["React", "Node.js", "Distributed Systems"],
        "behavioral": ["Collaborative Problem Solving", "Technical Leadership"],
        "boolean_queries": "(\"Senior Full-Stack Engineer\") AND (\"React\" OR \"Node.js\") AND (\"Distributed Systems\")",
    }
    save_db({"positions": {"1": default_job}, "candidates": {}, "settings": {}})


def load_db() -> Dict[str, Any]:
    """Load Supabase rows into the legacy app dictionary shape."""
    with db_lock:
        client = get_supabase_client()
        positions = {
            str(row["id"]): _row_payload(row)
            for row in _execute(client.table("positions").select("id,payload"))
        }
        candidates = {
            str(row["email"]).lower(): _row_payload(row)
            for row in _execute(client.table("candidates").select("email,payload"))
        }
        settings_rows = _execute(client.table("settings").select("key,value"))
        loaded_settings = {
            str(row["key"]): row.get("value")
            for row in settings_rows
            if row.get("key") is not None
        }
        pending_rows = _execute(client.table("pending_email_verifications").select("email,payload"))
        pending_email_verifications = {
            str(row["email"]).lower(): _row_payload(row)
            for row in pending_rows
            if row.get("email")
        }
        return {
            "positions": positions,
            "candidates": candidates,
            "settings": loaded_settings,
            "pending_email_verifications": pending_email_verifications,
        }


def save_db(data: Dict[str, Any]) -> None:
    """Persist the legacy app dictionary shape into Supabase tables.

    Routes still mutate a dictionary in memory. This adapter keeps those routes
    stable while making Supabase the single runtime persistence backend.
    """
    with db_lock:
        client = get_supabase_client()
        now = datetime.utcnow().isoformat(timespec="seconds")
        positions = data.get("positions") or {}
        candidates = data.get("candidates") or {}
        settings_data = data.get("settings") or {}
        pending_email_verifications = data.get("pending_email_verifications") or {}

        position_rows = []
        for key, payload in positions.items():
            row_payload = dict(payload or {})
            row_id = int(row_payload.get("id") or key)
            row_payload["id"] = row_id
            position_rows.append({
                "id": row_id,
                "title": row_payload.get("title", ""),
                "department": row_payload.get("department", ""),
                "active": bool(row_payload.get("active", True)),
                "payload": row_payload,
                "updated_at": now,
            })
        if position_rows:
            client.table("positions").upsert(position_rows, on_conflict="id").execute()

        candidate_rows = []
        application_rows = []
        for email, payload in candidates.items():
            email_clean = str(payload.get("email") or email).strip().lower()
            if not email_clean:
                continue
            row_payload = dict(payload or {})
            row_payload["email"] = email_clean
            candidate_rows.append({
                "email": email_clean,
                "name": row_payload.get("name", ""),
                "status": row_payload.get("status", ""),
                "position_id": row_payload.get("position_id"),
                "source_type": row_payload.get("source_type", ""),
                "source_method": row_payload.get("source_method", ""),
                "payload": row_payload,
                "updated_at": now,
            })
            for application in row_payload.get("applications") or []:
                if not isinstance(application, dict):
                    continue
                position_id = application.get("position_id")
                application_id = application.get("application_id") or (
                    f"{email_clean}:{position_id}" if position_id else email_clean
                )
                application_rows.append({
                    "id": str(application_id),
                    "candidate_email": email_clean,
                    "position_id": position_id,
                    "status": application.get("status", ""),
                    "payload": application,
                    "updated_at": now,
                })
        if candidate_rows:
            client.table("candidates").upsert(candidate_rows, on_conflict="email").execute()
        if application_rows:
            client.table("applications").upsert(application_rows, on_conflict="id").execute()

        settings_rows = [
            {"key": str(key), "value": value, "updated_at": now}
            for key, value in settings_data.items()
        ]
        if settings_rows:
            client.table("settings").upsert(settings_rows, on_conflict="key").execute()

        pending_rows = []
        for email, payload in pending_email_verifications.items():
            email_clean = str(email).strip().lower()
            if email_clean:
                pending_rows.append({
                    "email": email_clean,
                    "payload": payload or {},
                    "updated_at": now,
                })
        if pending_rows:
            client.table("pending_email_verifications").upsert(pending_rows, on_conflict="email").execute()

        existing_positions = _table_key_set("positions", "id")
        for removed_id in existing_positions - {str(row["id"]) for row in position_rows}:
            client.table("positions").delete().eq("id", removed_id).execute()

        existing_candidates = _table_key_set("candidates", "email")
        for removed_email in existing_candidates - {row["email"] for row in candidate_rows}:
            client.table("candidates").delete().eq("email", removed_email).execute()

        existing_pending = _table_key_set("pending_email_verifications", "email")
        for removed_email in existing_pending - {row["email"] for row in pending_rows}:
            client.table("pending_email_verifications").delete().eq("email", removed_email).execute()


def record_agent_event(event: Dict[str, Any]) -> Dict[str, Any]:
    payload = dict(event or {})
    row = {
        "candidate_email": payload.get("candidate_email"),
        "position_id": payload.get("position_id"),
        "event_type": payload.get("event_type", "agent_event"),
        "node": payload.get("node", ""),
        "message": payload.get("message", ""),
        "payload": payload,
    }
    rows = _execute(get_supabase_client().table("agent_events").insert(row).select("*"))
    return rows[0] if rows else row


def record_agent_action(action: Dict[str, Any]) -> Dict[str, Any]:
    payload = dict(action or {})
    row = {
        "candidate_email": payload.get("candidate_email"),
        "position_id": payload.get("position_id"),
        "tool_name": payload.get("tool_name", ""),
        "approved": bool(payload.get("approved", False)),
        "payload": payload,
    }
    rows = _execute(get_supabase_client().table("agent_actions").insert(row).select("*"))
    return rows[0] if rows else row


def record_email_event(email_event: Dict[str, Any]) -> Dict[str, Any]:
    payload = dict(email_event or {})
    row = {
        "candidate_email": payload.get("candidate_email"),
        "position_id": payload.get("position_id"),
        "to_email": payload.get("to_email", ""),
        "subject": payload.get("subject", ""),
        "sent": bool(payload.get("sent", False)),
        "autonomous": bool(payload.get("autonomous", False)),
        "payload": payload,
    }
    rows = _execute(get_supabase_client().table("email_events").insert(row).select("*"))
    return rows[0] if rows else row


def get_recent_agent_events(candidate_email: str | None = None, position_id: int | None = None, limit: int = 100) -> List[Dict[str, Any]]:
    query = get_supabase_client().table("agent_events").select("*").order("created_at", desc=True).limit(limit)
    if candidate_email:
        query = query.eq("candidate_email", candidate_email.strip().lower())
    if position_id:
        query = query.eq("position_id", position_id)
    return _execute(query)
