import json
import re
from typing import Dict, Any, List, Optional
from openai import OpenAI
from app.config import settings

CAPACITY_ERROR_PATTERNS = (
    "429",
    "maximum capacity",
    "rate limit",
    "rate_limit",
    "too many requests",
)

STRUCTURED_OUTPUT_UNSUPPORTED_PATTERNS = (
    "response_format",
    "json_schema",
    "unsupported",
    "not supported",
)

def get_openai_client() -> Optional[OpenAI]:
    if not settings.OPENAI_API_KEY or "your_openai" in settings.OPENAI_API_KEY:
        return None
    try:
        return OpenAI(
            api_key=settings.OPENAI_API_KEY,
            base_url=settings.OPENAI_BASE_URL,
            max_retries=0,
            timeout=min(settings.LLM_TIMEOUT, settings.AGENT_WORKER_TIMEOUT_SECONDS or settings.LLM_TIMEOUT)
        )
    except Exception:
        return None

def parse_llm_json(text: str) -> Dict[str, Any]:
    text = text.strip()
    # Strip Qwen3 / thinking-model <think>...</think> blocks before parsing
    text = re.sub(r"<think>[\s\S]*?</think>", "", text, flags=re.IGNORECASE).strip()
    match = re.search(r"```json\s*([\s\S]*?)\s*```", text)
    if match:
        json_str = match.group(1)
    else:
        json_str = text
    try:
        return json.loads(json_str)
    except Exception as e:
        raise ValueError(f"Failed to parse LLM JSON: {e}. Raw text: {text}")

def sanitize_provider_error(exc: Any, fallback: str = "LLM provider was unavailable; deterministic fallback was used.") -> str:
    """Return a concise user-safe explanation for model/provider failures."""
    message = str(exc or "")
    lowered = message.lower()
    if any(pattern in lowered for pattern in CAPACITY_ERROR_PATTERNS):
        return "LLM provider is at capacity; deterministic fallback was used."
    if any(pattern in lowered for pattern in STRUCTURED_OUTPUT_UNSUPPORTED_PATTERNS):
        return "Structured output was not supported by this provider; schema-normalized JSON fallback was used."
    return fallback

def provider_supports_structured_outputs() -> bool:
    base_url = (settings.OPENAI_BASE_URL or "").lower()
    if not settings.OPENAI_STRUCTURED_OUTPUTS:
        return False
    # OpenAI-compatible routers vary. Enable by default for official OpenAI and
    # still catch provider-side unsupported errors at call time.
    return True if base_url else False

def json_schema_response_format(name: str, schema: Dict[str, Any]) -> Dict[str, Any] | None:
    if not provider_supports_structured_outputs():
        return None
    return {
        "type": "json_schema",
        "json_schema": {
            "name": name,
            "strict": True,
            "schema": schema,
        },
    }

def is_structured_output_error(exc: Any) -> bool:
    lowered = str(exc or "").lower()
    return any(pattern in lowered for pattern in STRUCTURED_OUTPUT_UNSUPPORTED_PATTERNS)
