import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os
from app.database import init_db
from app.config import settings
from app.routes import jobs, candidates, settings as settings_router

# Initialize Database flat-file
init_db()

app = FastAPI(
    title="Intelligent Recruiter Workspace Backend",
    description="Decoupled API server hosting 6-Agent AI Core, Playwright scraper, and JSON relational store.",
    version="1.0.0"
)

uploads_dir = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(uploads_dir, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=uploads_dir), name="uploads")

# Set up CORS to enable React/Vite frontend client calls
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify frontend host URL (e.g. http://localhost:5173)
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register REST endpoints under /api/v1
app.include_router(jobs.router, prefix="/api/v1")
app.include_router(candidates.router, prefix="/api/v1")
app.include_router(settings_router.router, prefix="/api/v1")

@app.get("/")
def read_root():
    return {
        "status": "online",
        "service": "Intelligent Recruiter Workspace API",
        "version": "1.0.0"
    }

if __name__ == "__main__":
    uvicorn.run("main:app", host=settings.HOST, port=settings.PORT, reload=settings.DEBUG)
