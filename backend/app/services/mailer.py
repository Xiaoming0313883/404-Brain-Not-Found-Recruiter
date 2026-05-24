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

def is_smtp_configured(smtp_settings: Dict[str, Any] = None) -> bool:
    resolved = resolve_smtp_settings(smtp_settings)
    user = str(resolved.get("user") or "").strip()
    password = str(resolved.get("password") or "").strip()
    return bool(user and password and user not in PLACEHOLDER_VALUES and password not in PLACEHOLDER_VALUES)

def send_recruitment_email(
    to_email: str,
    subject: str,
    body: str,
    smtp_settings: Dict[str, Any] = None
) -> bool:
    """Dispatches a structured email to the target candidate using SMTP."""
    resolved = resolve_smtp_settings(smtp_settings)
    host = resolved["host"]
    port = resolved["port"]
    user = resolved["user"]
    password = resolved["password"]

    if not is_smtp_configured(smtp_settings):
        print("SMTP Credentials not configured. Skipping email dispatch.")
        return False

    try:
        # Create message container
        msg = MIMEMultipart()
        msg['From'] = user
        msg['To'] = to_email
        msg['Subject'] = subject

        # Attach text body
        msg.attach(MIMEText(body, 'plain', 'utf-8'))

        # Connect to SMTP server
        server = smtplib.SMTP(host, int(port), timeout=10)
        server.starttls()  # Force secure TLS communication
        server.login(user, password)
        server.sendmail(user, to_email, msg.as_string())
        server.quit()
        
        print(f"SMTP Outreach email sent successfully to {to_email}!")
        return True
    except Exception as e:
        print(f"Failed to dispatch SMTP email to {to_email}: {e}")
        return False

def send_candidate_verification_email(to_email: str, code: str) -> bool:
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

def verify_smtp_connection(smtp_settings: Dict[str, Any]) -> bool:
    """Verifies that an SMTP connection can be established and authenticated."""
    resolved = resolve_smtp_settings(smtp_settings)
    host = resolved["host"]
    port = resolved["port"]
    user = resolved["user"]
    password = resolved["password"]

    if not is_smtp_configured(smtp_settings):
        return False

    try:
        server = smtplib.SMTP(host, int(port), timeout=10)
        server.starttls()
        server.login(user, password)
        server.quit()
        return True
    except Exception as e:
        print(f"SMTP Connection verification failed: {e}")
        return False
