from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional
from ..services.mailer import verify_smtp_connection

router = APIRouter(prefix="/settings", tags=["Settings"])

class SMTPVerifyPayload(BaseModel):
    SMTP_HOST: str
    SMTP_PORT: int
    SMTP_USER: str
    SMTP_PASSWORD: str

@router.post("/smtp/verify")
def verify_smtp(payload: SMTPVerifyPayload):
    success = verify_smtp_connection(payload.model_dump())
    return {
        "status": "success" if success else "failed",
        "message": "SMTP credentials authenticated successfully!" if success else "Failed to establish a secure SMTP connection."
    }
