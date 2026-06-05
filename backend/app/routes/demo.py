from fastapi import APIRouter

from ..database import reset_demo_data

router = APIRouter(prefix="/demo", tags=["Demo"])


@router.post("/reset")
def reset_demo():
    deleted = reset_demo_data()
    return {
        "status": "reset",
        "message": "Demo data reset. Create the Software Engineer job from the hiring manager portal.",
        "deleted": deleted,
    }
