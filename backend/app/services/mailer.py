import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Dict, Any
from ..config import settings

PLACEHOLDER_VALUES = {
    "your_email@gmail.com",
    "recruiter-bot@company.com",
    "your_app_specific_password",
    "your-app-specific-password",
    "your_app_specific_password",
    "your-app-specific-password",
    ""
}

def resolve_smtp_settings(smtp_settings: Dict[str, Any] = None) -> Dict[str, Any]:
    return {
        "host": (smtp_settings or {}).get("SMTP_HOST") or settings.SMTP_HOST,
        "port": (smtp_settings or {}).get("SMTP_PORT") or settings.SMTP_PORT,
        "user": (smtp_settings or {}).get("SMTP_USER") or settings.SMTP_USER,
        "password": (smtp_settings or {}).get("SMTP_PASSWORD") or settings.SMTP_PASSWORD,
    }

def smtp_status(smtp_settings: Dict[str, Any] = None) -> Dict[str, Any]:
    resolved = resolve_smtp_settings(smtp_settings)
    host = str(resolved.get("host") or "").strip()
    port = str(resolved.get("port") or "").strip()
    user = str(resolved.get("user") or "").strip()
    password = str(resolved.get("password") or "").strip()
    missing = []
    if not host:
        missing.append("SMTP_HOST")
    if not port:
        missing.append("SMTP_PORT")
    if not user or user in PLACEHOLDER_VALUES:
        missing.append("SMTP_USER")
    if not password or password in PLACEHOLDER_VALUES:
        missing.append("SMTP_PASSWORD")
    configured = not missing
    return {
        "configured": configured,
        "host": host,
        "port": int(port) if str(port).isdigit() else port,
        "user": user if configured else "",
        "reason": "SMTP is configured." if configured else f"Missing or placeholder SMTP settings: {', '.join(missing)}.",
        "missing": missing,
    }

def is_smtp_configured(smtp_settings: Dict[str, Any] = None) -> bool:
    return bool(smtp_status(smtp_settings).get("configured"))

def _smtp_error_type(exc: Exception) -> str:
    if isinstance(exc, smtplib.SMTPAuthenticationError):
        return "authentication_failed"
    if isinstance(exc, smtplib.SMTPConnectError):
        return "connection_failed"
    if isinstance(exc, smtplib.SMTPRecipientsRefused):
        return "recipient_refused"
    if isinstance(exc, smtplib.SMTPSenderRefused):
        return "sender_refused"
    if isinstance(exc, smtplib.SMTPServerDisconnected):
        return "server_disconnected"
    return exc.__class__.__name__

def send_recruitment_email(
    to_email: str,
    subject: str,
    body: str,
    html_body: str | None = None,
    smtp_settings: Dict[str, Any] = None
) -> Dict[str, Any]:
    """Dispatches a structured email to the target candidate using SMTP."""
    resolved = resolve_smtp_settings(smtp_settings)
    host = resolved["host"]
    port = resolved["port"]
    user = resolved["user"]
    password = resolved["password"]
    status = smtp_status(smtp_settings)

    receipt = {
        "sent": False,
        "smtp_configured": bool(status.get("configured")),
        "reason": status.get("reason", ""),
        "error_type": "",
        "provider_message": "",
        "to_email": to_email,
        "subject": subject,
    }

    if not status.get("configured"):
        print("SMTP credentials not configured. Skipping email dispatch.")
        return receipt

    try:
        # Create message container
        msg = MIMEMultipart()
        msg['From'] = user
        msg['To'] = to_email
        msg['Subject'] = subject

        # Attach text body
        msg.attach(MIMEText(body, 'plain', 'utf-8'))
        if html_body:
            msg.attach(MIMEText(html_body, 'html', 'utf-8'))

        if int(port) == 465:
            server = smtplib.SMTP_SSL(host, int(port), timeout=10)
        else:
            server = smtplib.SMTP(host, int(port), timeout=10)
            server.starttls()
        try:
            server.login(user, password)
            server.sendmail(user, to_email, msg.as_string())
        finally:
            server.quit()
        
        print(f"SMTP Outreach email sent successfully to {to_email}!")
        return {**receipt, "sent": True, "reason": "SMTP delivery accepted by provider."}
    except Exception as e:
        print(f"Failed to dispatch SMTP email to {to_email}: {e}")
        return {
            **receipt,
            "reason": "SMTP delivery failed. Check host, port, username, app password, TLS mode, and provider access settings.",
            "error_type": _smtp_error_type(e),
            "provider_message": str(e),
        }

def send_candidate_verification_email(to_email: str, code: str) -> Dict[str, Any]:
    """Prototype candidate email verification sender.

    This attempts real SMTP delivery when credentials are configured. During
    local prototype work, the code is also printed by the route that calls this
    function and returned to the frontend as a demo-only value.
    """
    subject = "Verify your candidate account"
    body = (
        "Welcome to 404 Brain Not Found Recruiter.\n\n"
        f"Your candidate account verification code is: {code}\n\n"
        "Enter this code in the Candidate Portal to verify your email address."
    )
    return send_recruitment_email(to_email=to_email, subject=subject, body=body)

def verify_smtp_connection(smtp_settings: Dict[str, Any]) -> Dict[str, Any]:
    """Verifies that an SMTP connection can be established and authenticated."""
    resolved = resolve_smtp_settings(smtp_settings)
    host = resolved["host"]
    port = resolved["port"]
    user = resolved["user"]
    password = resolved["password"]
    status = smtp_status(smtp_settings)

    if not status.get("configured"):
        return {"authenticated": False, **status}

    try:
        if int(port) == 465:
            server = smtplib.SMTP_SSL(host, int(port), timeout=10)
        else:
            server = smtplib.SMTP(host, int(port), timeout=10)
            server.starttls()
        try:
            server.login(user, password)
        finally:
            server.quit()
        return {"authenticated": True, **status, "reason": "SMTP credentials authenticated successfully."}
    except Exception as e:
        print(f"SMTP Connection verification failed: {e}")
        return {
            "authenticated": False,
            **status,
            "reason": "SMTP authentication failed. Verify provider app password, TLS/SSL port, and account SMTP access.",
            "error_type": _smtp_error_type(e),
            "provider_message": str(e),
        }
