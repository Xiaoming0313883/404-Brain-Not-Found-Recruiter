import json
import os
import threading
from typing import Dict, Any
from .config import settings

# Thread lock for safe concurrent JSON reading/writing
db_lock = threading.Lock()

def get_db_path() -> str:
    # Resolve database path relative to settings configuration
    if os.path.isabs(settings.DATABASE_PATH):
        return settings.DATABASE_PATH
    # Otherwise make it relative to uvicorn execution directory (backend/).
    base_dir = os.path.dirname(os.path.dirname(__file__))
    return os.path.abspath(os.path.join(base_dir, settings.DATABASE_PATH))

def init_db():
    db_path = get_db_path()
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    
    with db_lock:
        if not os.path.exists(db_path) or os.path.getsize(db_path) == 0:
            initial_data = {
                "positions": {
                    "1": {
                        "id": 1,
                        "title": "Senior Full-Stack Engineer",
                        "department": "Engineering",
                        "description": "We are seeking an experienced full-stack engineer to build scalable distributed systems.",
                        "requirements": ["5+ years experience", "React & Node.js", "Distributed systems"],
                        "active": True,
                        "open_time": "2026-01-01T00:00",
                        "end_time": "2026-12-31T23:59",
                        "created_at": "2026-01-15T09:00",
                        "sourcing_criteria": {},
                        "intake_chat": [],
                        "pillars": ["React", "Node.js", "Distributed Systems"],
                        "behavioral": ["Collaborative Problem Solving", "Technical Leadership"],
                        "boolean_queries": "(\"Senior Full-Stack Engineer\") AND (\"React\" OR \"Node.js\") AND (\"Distributed Systems\")"
                    }
                },
                "candidates": {}
            }
            with open(db_path, "w", encoding="utf-8") as f:
                json.dump(initial_data, f, indent=4)

def load_db() -> Dict[str, Any]:
    db_path = get_db_path()
    if not os.path.exists(db_path):
        init_db()
    with db_lock:
        try:
            with open(db_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except json.JSONDecodeError:
            print("Database JSON corrupted. Re-initializing...")
            
    # If we reached here, the JSON was corrupted
    init_db()
    with db_lock:
        with open(db_path, "r", encoding="utf-8") as f:
            return json.load(f)

def save_db(data: Dict[str, Any]):
    db_path = get_db_path()
    with db_lock:
        with open(db_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=4)
