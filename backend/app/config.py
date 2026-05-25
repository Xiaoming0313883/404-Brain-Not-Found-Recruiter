from pydantic_settings import BaseSettings
from pydantic import field_validator
import os

class Settings(BaseSettings):
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    DEBUG: bool = True
    SECRET_KEY: str = "94bc9ee9542a17088b902166a988d5e167e4368a5d3f8263158c56fa8de8ee12"
    DATABASE_PATH: str = "data/recruiting_db.json"
    OPENAI_API_KEY: str = "your_openai_key_here"
    OPENAI_BASE_URL: str = "https://api.openai.com/v1"
    OPENAI_MODEL: str = "gpt-4o-mini"
    LLM_TIMEOUT: float = 120.0
    RESUME_AGENT_TEMP: float = 0.1
    REQUIREMENT_AGENT_TEMP: float = 0.2
    MATCHING_AGENT_TEMP: float = 0.4
    INTERVIEW_AGENT_TEMP: float = 0.3
    REPORT_AGENT_TEMP: float = 0.3
    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SMTP_USER: str = "recruiter-bot@company.com"
    SMTP_PASSWORD: str = "your-app-specific-password"
    LINKEDIN_LI_AT_COOKIE: str = ""
    LINKEDIN_HEADLESS: bool = True
    APIFY_API_TOKEN: str = ""
    APIFY_PROFILE_ACTOR_ID: str = "curious_coder/linkedin-profile-scraper"
    APIFY_SEARCH_ACTOR_ID: str = "curious_coder/linkedin-people-search-scraper"
    APIFY_TIMEOUT_SECONDS: int = 90

    @field_validator("DEBUG", mode="before")
    @classmethod
    def parse_debug_flag(cls, value):
        if isinstance(value, bool) or value is None:
            return value
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"1", "true", "yes", "on", "debug", "dev", "development"}:
                return True
            if normalized in {"0", "false", "no", "off", "release", "prod", "production"}:
                return False
        return value

    @field_validator("DATABASE_PATH", mode="before")
    @classmethod
    def normalize_database_path(cls, value):
        if isinstance(value, str) and value.strip().replace("\\", "/") in {"../recruiting_db.json", "recruiting_db.json"}:
            return "data/recruiting_db.json"
        return value

    class Config:
        # Load backend-specific settings from backend/.env.
        env_file = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env")
        env_file_encoding = "utf-8"
        extra = "ignore"

settings = Settings()
