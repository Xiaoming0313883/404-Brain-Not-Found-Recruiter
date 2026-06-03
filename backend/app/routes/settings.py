from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional
from ..database import load_db, save_db
from ..database import get_supabase_client
from ..config import settings
from ..services.bias_settings import get_bias_controls, update_bias_controls
from ..services.agents.base_agent import get_openai_client
from ..services.agents.bias_agent import analyze_prestige_indicators
from ..services.agents.matching_agent import build_position_fit_assessment
from ..services.mailer import is_smtp_configured, verify_smtp_connection

router = APIRouter(prefix="/settings", tags=["Settings"])

class SMTPVerifyPayload(BaseModel):
    SMTP_HOST: str
    SMTP_PORT: int
    SMTP_USER: str
    SMTP_PASSWORD: str

class BiasControlsPayload(BaseModel):
    neutralize_prestige: Optional[bool] = None
    anonymized_blind_hiring: Optional[bool] = None
    scoring_mode: Optional[str] = None
    prestige_weight: Optional[int] = None

def reapply_bias_scoring(db: dict, controls: dict) -> None:
    positions = db.get("positions", {})
    for candidate in db.get("candidates", {}).values():
        profile_data = candidate.get("profile_data", {})
        analysis = candidate.get("bias_analysis") or analyze_prestige_indicators(profile_data, candidate.get("resume_text", ""), use_llm=False)
        candidate["bias_analysis"] = analysis
        applications = candidate.setdefault("applications", [])
        if not applications and candidate.get("position_id"):
            applications.append({
                "application_id": f"position-{candidate['position_id']}",
                "position_id": candidate.get("position_id"),
                "status": candidate.get("status", "applied"),
                "applied_at": candidate.get("applied_at"),
                "custom_questions": candidate.get("custom_questions", []),
                "answers": candidate.get("answers", []),
                "evaluation": candidate.get("evaluation", {}),
            })
        for application in applications:
            position_id = application.get("position_id")
            job = positions.get(str(position_id))
            if not job:
                continue
            application["match_results"] = build_position_fit_assessment(job, profile_data, controls, analysis)
            if position_id == candidate.get("position_id"):
                candidate["match_results"] = application["match_results"]
                candidate["status"] = application.get("status", candidate.get("status"))
                candidate["custom_questions"] = application.get("custom_questions", candidate.get("custom_questions", []))
                candidate["answers"] = application.get("answers", candidate.get("answers", []))
                candidate["evaluation"] = application.get("evaluation", candidate.get("evaluation", {}))

@router.post("/smtp/verify")
def verify_smtp(payload: SMTPVerifyPayload):
    success = verify_smtp_connection(payload.model_dump())
    return {
        "status": "success" if success else "failed",
        "message": "SMTP credentials authenticated successfully!" if success else "Failed to establish a secure SMTP connection."
    }

@router.get("/integrations/status")
def read_integration_status():
    openai_ready = bool(get_openai_client())
    supabase_ready = False
    supabase_detail = "not checked"
    try:
        get_supabase_client().table("positions").select("id").limit(1).execute()
        supabase_ready = True
        supabase_detail = "connected"
    except Exception as e:
        supabase_detail = str(e)

    apify_ready = bool(settings.APIFY_API_TOKEN.strip())
    smtp_ready = is_smtp_configured()
    return {
        "openai": {
            "configured": openai_ready,
            "model": settings.OPENAI_MODEL,
            "supervisor_model": settings.AGENT_SUPERVISOR_MODEL,
            "base_url": settings.OPENAI_BASE_URL,
        },
        "supabase": {
            "configured": bool(settings.SUPABASE_URL.strip() and settings.SUPABASE_SERVICE_ROLE_KEY.strip()),
            "connected": supabase_ready,
            "detail": supabase_detail if not supabase_ready else "connected",
        },
        "apify_linkedin": {
            "configured": apify_ready,
            "profile_actor_id": settings.APIFY_PROFILE_ACTOR_ID,
            "search_actor_id": settings.APIFY_SEARCH_ACTOR_ID,
        },
        "smtp": {
            "configured": smtp_ready,
            "host": settings.SMTP_HOST,
            "user": settings.SMTP_USER if smtp_ready else "",
        },
        "agent_graph": {
            "autonomy_mode": settings.AGENT_AUTONOMY_MODE,
            "max_steps": settings.AGENT_MAX_STEPS,
            "invite_min_fit_score": settings.AGENT_INVITE_MIN_FIT_SCORE,
            "reject_max_screening_score": settings.AGENT_REJECT_MAX_SCREENING_SCORE,
        }
    }

@router.get("/bias-controls")
def read_bias_controls():
    db = load_db()
    controls = get_bias_controls(db)
    save_db(db)
    return controls

@router.patch("/bias-controls")
def patch_bias_controls(payload: BiasControlsPayload):
    db = load_db()
    updates = {
        key: value
        for key, value in payload.model_dump().items()
        if value is not None
    }
    controls = update_bias_controls(db, updates)
    if "scoring_mode" in updates or "prestige_weight" in updates:
        reapply_bias_scoring(db, controls)
    save_db(db)
    return controls
