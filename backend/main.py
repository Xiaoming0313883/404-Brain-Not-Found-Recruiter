import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
import os
from app.database import init_db
from app.config import settings
from app.routes import agents, jobs, candidates, settings as settings_router

DATABASE_STARTUP_ERROR = ""
try:
    init_db()
except RuntimeError as exc:
    DATABASE_STARTUP_ERROR = str(exc)
    print(f"Supabase startup warning: {DATABASE_STARTUP_ERROR}")

app = FastAPI(
    title="Intelligent Recruiter Workspace Backend",
    description="Agentic recruiter API hosting a guarded supervisor graph, live integrations, and Supabase persistence.",
    version="1.0.0"
)

uploads_dir = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(uploads_dir, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=uploads_dir), name="uploads")

# Set up CORS to enable React/Vite frontend client calls
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify the deployed frontend host URL.
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register REST endpoints under /api/v1
app.include_router(jobs.router, prefix="/api/v1")
app.include_router(candidates.router, prefix="/api/v1")
app.include_router(settings_router.router, prefix="/api/v1")
app.include_router(agents.router, prefix="/api/v1")

@app.exception_handler(RuntimeError)
async def runtime_error_handler(_request: Request, exc: RuntimeError):
    message = str(exc)
    if "Supabase" in message or "supabase" in message:
        return JSONResponse(
            status_code=503,
            content={
                "detail": message,
                "hint": "Check SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, network access, and that backend/supabase_schema.sql has been run.",
            },
        )
    return JSONResponse(status_code=500, content={"detail": message})

@app.get("/")
def read_root():
    return {
        "status": "online",
        "service": "Intelligent Recruiter Workspace API",
        "version": "1.0.0",
        "database_startup_error": DATABASE_STARTUP_ERROR,
    }

if __name__ == "__main__":
    uvicorn.run("main:app", host=settings.HOST, port=settings.PORT, reload=settings.DEBUG)
