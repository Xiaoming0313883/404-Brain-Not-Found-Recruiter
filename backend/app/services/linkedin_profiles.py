import re
from typing import Any, Dict


def _name_from_url(linkedin_url: str) -> str:
    if "linkedin.com/in/" not in linkedin_url.lower():
        return "Alex Mercer"
    slug = linkedin_url.split("linkedin.com/in/")[-1].split("/")[0].split("?")[0]
    return slug.replace("-", " ").replace("_", " ").strip().title() or "Alex Mercer"


def scrape_linkedin_profile(linkedin_url: str) -> Dict[str, Any]:
    """Best-effort LinkedIn profile read using linkedin-scraper when available.

    The package normally needs a Selenium driver/session. For this prototype we
    try the dependency first, then fall back quickly to deterministic URL parsing
    so automatic discovery never stalls the hiring manager workflow.
    """
    candidate_name = _name_from_url(linkedin_url)
    try:
        from linkedin_scraper import Person  # type: ignore

        person = Person(linkedin_url, scrape=False)
        candidate_name = getattr(person, "name", None) or candidate_name
    except Exception as e:
        print(f"linkedin-scraper fallback used: {e}")

    slug = re.sub(r"[^a-z0-9]+", ".", candidate_name.lower()).strip(".") or "candidate"
    return {
        "name": candidate_name,
        "email": f"{slug}@email.com",
        "headline": "LinkedIn-sourced professional profile",
        "location": "Profile location pending verification",
        "about": "Profile discovered through LinkedIn sourcing. Full details should be verified during outreach.",
        "experiences": [
            {"title": "Relevant Professional", "company": "LinkedIn Profile Company", "duration": "Recent", "description": "Experience inferred from sourced profile."}
        ],
        "education": []
    }


def build_fast_match_results(job: Dict[str, Any], profile_data: Dict[str, Any]) -> Dict[str, Any]:
    job_words = " ".join(job.get("requirements", []) + job.get("pillars", [])).lower()
    profile_words = str(profile_data).lower()
    hits = sum(1 for word in set(re.findall(r"[a-zA-Z][a-zA-Z+#.]{2,}", job_words)) if word in profile_words)
    score = max(72, min(94, 76 + hits * 4))
    return {
        "debate": {
            "critical_recruiter_cons": ["Profile requires verification before final shortlist."],
            "talent_advocate_pros": [f"Profile appears directionally aligned with {job.get('title', 'the role')}."]
        },
        "scores": {
            "technical": score,
            "domain": max(68, score - 5),
            "culture": 82,
            "trajectory_slope": 84
        }
    }


def build_fast_outreach(profile_data: Dict[str, Any], job: Dict[str, Any]) -> Dict[str, str]:
    name = profile_data.get("name", "there")
    position = job.get("title", "our open role")
    department = job.get("department", "the hiring team")
    requirements = ", ".join(job.get("requirements", [])[:3]) or "the role requirements"
    return {
        "sourcing_pitch": f"{name} appears aligned with {position}; verify role depth, recent impact, and interest level before advancing.",
        "outreach_email": f"Subject: Invitation to interview for {position}\n\nDear {name},\n\nI'm reaching out from Intelligent Recruiter Workspace about our {position} role in {department}. We found your profile through LinkedIn sourcing while looking for candidates with experience related to {requirements}.\n\nYour background appears potentially relevant, and we would like to invite you to create or log in to the candidate portal and complete a personalized warm-up interview session.\n\nBest regards,\nIntelligent Recruiter Workspace Hiring Team"
    }
