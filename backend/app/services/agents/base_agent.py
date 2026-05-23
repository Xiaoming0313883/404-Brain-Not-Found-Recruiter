import json
import re
from typing import Dict, Any, List, Optional
from openai import OpenAI
from app.config import settings

def get_openai_client() -> Optional[OpenAI]:
    if not settings.OPENAI_API_KEY or "your_openai" in settings.OPENAI_API_KEY:
        return None
    try:
        return OpenAI(
            api_key=settings.OPENAI_API_KEY,
            base_url=settings.OPENAI_BASE_URL,
            max_retries=0,
            timeout=settings.LLM_TIMEOUT
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
