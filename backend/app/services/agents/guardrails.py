from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Dict, List

from app.config import settings
from app.services.mailer import is_smtp_configured


AUTONOMOUS_EMAIL_NOTE = "System Note: This email was drafted and sent autonomously by the APU Recruiting AI Agent."


@dataclass
class GuardrailResult:
    safe: bool
    reason: str = ""
    categories: List[str] = field(default_factory=list)
    severity: str = "low"

    def model_dump(self) -> Dict[str, Any]:
        return {
            "safe": self.safe,
            "reason": self.reason,
            "categories": self.categories,
            "severity": self.severity,
        }


PROMPT_INJECTION_PATTERNS = [
    r"\bignore (all )?(previous|prior|system|developer) instructions\b",
    r"\boverride (the )?(system|developer|policy|guardrail)",
    r"\breveal (your )?(system prompt|instructions|hidden prompt|developer message)",
    r"\bdo not follow\b.*\binstructions\b",
    r"\byou are now\b",
    r"\bact as\b.*\badmin\b",
    r"\baccept this candidate immediately\b",
    r"\bmark (me|this candidate) as (hired|accepted)\b",
]

UNAUTHORIZED_ACTION_PATTERNS = [
    r"\bsend (an )?email to (the )?(ceo|founder|all employees|everyone|another candidate)",
    r"\bdelete (all )?(candidates|jobs|positions|database|records)\b",
    r"\bexport\b.*\b(candidate|applicant|resume|email).*\bdata\b",
    r"\bshow me\b.*\b(other|another|all).*\b(candidate|applicant|resume|email)",
    r"\bchange\b.*\bscore\b.*\bwithout\b.*\bevidence\b",
]

PROTECTED_CLASS_PATTERNS = [
    r"\b(age|race|religion|gender|sex|pregnancy|marital status|nationality|ethnicity|disability)\b.*\b(reject|prefer|hire|filter|rank|score)\b",
    r"\b(reject|prefer|hire|filter|rank|score)\b.*\b(age|race|religion|gender|sex|pregnancy|marital status|nationality|ethnicity|disability)\b",
]


def _match_patterns(text: str, patterns: List[str]) -> List[str]:
    return [
        pattern for pattern in patterns
        if re.search(pattern, text or "", flags=re.IGNORECASE | re.DOTALL)
    ]


def evaluate_guardrails(value: Any, context: Dict[str, Any] | None = None) -> GuardrailResult:
    text = flatten_for_guardrails(value)
    categories: List[str] = []
    reasons: List[str] = []

    if _match_patterns(text, PROMPT_INJECTION_PATTERNS):
        categories.append("prompt_injection")
        reasons.append("Input attempts to override or manipulate system instructions.")
    if _match_patterns(text, UNAUTHORIZED_ACTION_PATTERNS):
        categories.append("unauthorized_action")
        reasons.append("Input asks for an unauthorized data or communication action.")
    if _match_patterns(text, PROTECTED_CLASS_PATTERNS):
        categories.append("protected_class_hiring")
        reasons.append("Input asks the system to evaluate or act using protected-class criteria.")

    if categories:
        return GuardrailResult(
            safe=False,
            reason=" ".join(reasons),
            categories=categories,
            severity="high",
        )
    return GuardrailResult(safe=True, reason="Input passed recruiting safety guardrails.")


def flatten_for_guardrails(value: Any) -> str:
    if isinstance(value, dict):
        return " ".join(flatten_for_guardrails(item) for item in value.values())
    if isinstance(value, list):
        return " ".join(flatten_for_guardrails(item) for item in value)
    return str(value or "")


def ensure_autonomous_email_label(body: str) -> str:
    cleaned = str(body or "").strip()
    if AUTONOMOUS_EMAIL_NOTE.lower() in cleaned.lower():
        return cleaned
    return f"{cleaned}\n\n{AUTONOMOUS_EMAIL_NOTE}".strip()


def validate_action_policy(
    tool_name: str,
    payload: Dict[str, Any],
    state: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    state = state or {}
    payload = payload or {}
    if settings.AGENT_AUTONOMY_MODE != "bounded":
        return {
            "approved": False,
            "reason": "Autonomous actions are disabled unless AGENT_AUTONOMY_MODE=bounded.",
        }

    guardrail = evaluate_guardrails(payload, state)
    if not guardrail.safe:
        return {
            "approved": False,
            "reason": guardrail.reason,
            "guardrail": guardrail.model_dump(),
        }

    if tool_name == "send_agent_email":
        to_email = str(payload.get("to_email") or "").strip().lower()
        candidate_email = str(payload.get("candidate_email") or state.get("candidate_email") or "").strip().lower()
        if not is_smtp_configured(payload.get("smtp_settings")):
            return {"approved": False, "reason": "SMTP is not configured for real email delivery."}
        if not to_email or to_email != candidate_email:
            return {"approved": False, "reason": "Autonomous email may only be sent to the candidate's own email address."}
        action_type = str(payload.get("action_type") or "").lower()
        fit_score = int(payload.get("overall_position_fit") or state.get("overall_position_fit") or 0)
        screening_score = int(payload.get("screening_score") or state.get("screening_score") or 0)
        recommendation = str(payload.get("hiring_recommendation") or state.get("hiring_recommendation") or "").lower()
        if action_type == "invite" and fit_score < settings.AGENT_INVITE_MIN_FIT_SCORE:
            return {"approved": False, "reason": f"Invite requires fit score >= {settings.AGENT_INVITE_MIN_FIT_SCORE}."}
        if action_type == "reject" and (screening_score > settings.AGENT_REJECT_MAX_SCREENING_SCORE or recommendation != "reject"):
            return {
                "approved": False,
                "reason": f"Rejection requires score <= {settings.AGENT_REJECT_MAX_SCREENING_SCORE} and recommendation=reject.",
            }
        return {"approved": True, "reason": "Autonomous email passed bounded-action policy."}

    if tool_name == "update_application_status":
        status = str(payload.get("status") or "").lower()
        if status == "interview_scheduled":
            return {
                "approved": False,
                "reason": "Agent cannot schedule interviews without HR-provided date/time.",
            }
        if status == "rejected":
            screening_score = int(payload.get("screening_score") or state.get("screening_score") or 0)
            recommendation = str(payload.get("hiring_recommendation") or state.get("hiring_recommendation") or "").lower()
            if screening_score > settings.AGENT_REJECT_MAX_SCREENING_SCORE or recommendation != "reject":
                return {
                    "approved": False,
                    "reason": f"Autonomous rejection requires score <= {settings.AGENT_REJECT_MAX_SCREENING_SCORE} and recommendation=reject.",
                }
        return {"approved": True, "reason": f"Status update to {status} passed bounded-action policy."}

    approved_tools = {
        "upsert_candidate_profile",
        "create_or_update_application",
        "record_agent_event",
        "stage_sourced_candidate",
        "save_screening_evaluation",
        "plan_candidate_email",
    }
    if tool_name in approved_tools:
        return {"approved": True, "reason": f"{tool_name} is an approved low-risk agent action."}

    return {"approved": False, "reason": f"{tool_name} is not available to autonomous agents."}
