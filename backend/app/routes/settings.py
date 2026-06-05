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
from ..services.mailer import is_smtp_configured, smtp_status, verify_smtp_connection

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
    result = verify_smtp_connection(payload.model_dump())
    success = bool(result.get("authenticated"))
    return {
        "status": "success" if success else "failed",
        "message": result.get("reason") or ("SMTP credentials authenticated successfully!" if success else "Failed to establish a secure SMTP connection."),
        "smtp": result,
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
    smtp_detail = smtp_status()
    smtp_ready = bool(smtp_detail.get("configured"))
    ranking_ready = bool(settings.RANKING_API_URL.strip())
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
            "host": smtp_detail.get("host"),
            "port": smtp_detail.get("port"),
            "user": smtp_detail.get("user") if smtp_ready else "",
            "detail": smtp_detail.get("reason"),
        },
        "agent_graph": {
            "autonomy_mode": settings.AGENT_AUTONOMY_MODE,
            "supervisor_mode": settings.AGENT_SUPERVISOR_MODE,
            "async_graph": settings.AGENT_ASYNC_GRAPH,
            "decision_reasons": settings.AGENT_DECISION_REASONS,
            "email_review_mode": settings.AGENT_EMAIL_REVIEW_MODE,
            "worker_timeout_seconds": settings.AGENT_WORKER_TIMEOUT_SECONDS,
            "max_steps": settings.AGENT_MAX_STEPS,
            "invite_min_fit_score": settings.AGENT_INVITE_MIN_FIT_SCORE,
            "reject_max_screening_score": settings.AGENT_REJECT_MAX_SCREENING_SCORE,
            "structured_outputs": settings.OPENAI_STRUCTURED_OUTPUTS,
        },
        "ranking_provider": {
            "configured": ranking_ready,
            "cache_table": "institution_ranking_cache",
            "detail": "live provider configured" if ranking_ready else "cache-only; rankings unknown until cached or provider is configured",
        },
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
    save_db(db)
    return controls
