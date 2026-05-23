import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Dict, Any
from ..config import settings

def send_recruitment_email(
    to_email: str,
    subject: str,
    body: str,
    smtp_settings: Dict[str, Any] = None
) -> bool:
    """Dispatches a structured email to the target candidate using SMTP."""
    # Resolve SMTP configurations (use customized settings if passed, else fallback to .env config)
    host = (smtp_settings or {}).get("SMTP_HOST") or settings.SMTP_HOST
    port = (smtp_settings or {}).get("SMTP_PORT") or settings.SMTP_PORT
    user = (smtp_settings or {}).get("SMTP_USER") or settings.SMTP_USER
    password = (smtp_settings or {}).get("SMTP_PASSWORD") or settings.SMTP_PASSWORD

    if not user or not password:
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
        server = smtplib.SMTP(host, int(port))
        server.starttls()  # Force secure TLS communication
        server.login(user, password)
        server.sendmail(user, to_email, msg.as_string())
        server.quit()
        
        print(f"SMTP Outreach email sent successfully to {to_email}!")
        return True
    except Exception as e:
        print(f"Failed to dispatch SMTP email to {to_email}: {e}")
        return False

def verify_smtp_connection(smtp_settings: Dict[str, Any]) -> bool:
    """Verifies that an SMTP connection can be established and authenticated."""
    host = smtp_settings.get("SMTP_HOST") or settings.SMTP_HOST
    port = smtp_settings.get("SMTP_PORT") or settings.SMTP_PORT
    user = smtp_settings.get("SMTP_USER") or settings.SMTP_USER
    password = smtp_settings.get("SMTP_PASSWORD") or settings.SMTP_PASSWORD

    if not user or not password:
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
