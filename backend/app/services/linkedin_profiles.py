import html
import re
import urllib.error
import urllib.request
from typing import Any, Dict
from .agents.matching_agent import build_position_fit_assessment


def _name_from_url(linkedin_url: str) -> str:
    if "linkedin.com/in/" not in linkedin_url.lower():
        return "Alex Mercer"
    slug = linkedin_url.split("linkedin.com/in/")[-1].split("/")[0].split("?")[0]
    return slug.replace("-", " ").replace("_", " ").strip().title() or "Alex Mercer"


def _is_linkedin_profile_url(linkedin_url: str) -> bool:
    return bool(re.match(r"^https?://([a-z]{2,3}\.)?www\.linkedin\.com/in/[^/?#]+", linkedin_url.strip(), flags=re.IGNORECASE))


def _extract_meta(html_text: str, property_name: str) -> str:
    patterns = [
        rf'<meta[^>]+property=["\']{re.escape(property_name)}["\'][^>]+content=["\']([^"\']+)["\']',
        rf'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']{re.escape(property_name)}["\']'
    ]
    for pattern in patterns:
        match = re.search(pattern, html_text, flags=re.IGNORECASE)
        if match:
            return html.unescape(match.group(1)).strip()
    return ""


def _fetch_public_metadata(linkedin_url: str) -> Dict[str, str]:
    request = urllib.request.Request(
        linkedin_url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; RecruitingWorkspace/1.0; +https://localhost)",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        }
    )
    with urllib.request.urlopen(request, timeout=8) as response:
        html_text = response.read(400_000).decode("utf-8", errors="ignore")

    return {
        "title": _extract_meta(html_text, "og:title"),
        "description": _extract_meta(html_text, "og:description"),
        "image": _extract_meta(html_text, "og:image"),
    }


def scrape_linkedin_profile(linkedin_url: str) -> Dict[str, Any]:
    """Best-effort LinkedIn profile read from public metadata.

    LinkedIn frequently blocks unauthenticated scraping, so this function never
    fabricates work history. If public metadata is unavailable, it returns only
    URL-derived identity with an explicit verification warning.
    """
    if not _is_linkedin_profile_url(linkedin_url):
        raise ValueError("Please enter a valid LinkedIn profile URL such as https://www.linkedin.com/in/username.")

    candidate_name = _name_from_url(linkedin_url)
    headline = "LinkedIn profile pending verification"
    about = ""
    profile_image_url = ""
    scrape_status = "url_only"
    scrape_warning = (
        "LinkedIn did not expose public profile details to this scraper. "
        "Only the profile URL/name were captured; verify the candidate manually before outreach."
    )

    try:
        metadata = _fetch_public_metadata(linkedin_url)
        title = metadata.get("title", "")
        description = metadata.get("description", "")
        if title and "linkedin" not in title.lower():
            candidate_name = title.split("|")[0].split("-")[0].strip() or candidate_name
        if description:
            headline = description[:180]
            about = description
            scrape_status = "public_metadata"
            scrape_warning = (
                "Only public LinkedIn metadata was available. Experience, education, location, and skills still need verification."
            )
        profile_image_url = metadata.get("image", "")
    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as e:
        # LinkedIn blocks unauthenticated scrapers — this is expected. Fall back to url_only mode.
        import logging
        logging.getLogger(__name__).debug("LinkedIn public metadata unavailable (expected): %s", e)

    slug = re.sub(r"[^a-z0-9]+", ".", candidate_name.lower()).strip(".") or "candidate"
    return {
        "name": candidate_name,
        "email": f"{slug}@email.com",
        "headline": headline,
        "location": "Pending manual verification",
        "about": about,
        "experiences": [],
        "education": [],
        "profile_image_url": profile_image_url,
        "scrape_status": scrape_status,
        "scrape_warning": scrape_warning,
        "source_url": linkedin_url
    }


def build_fast_match_results(job: Dict[str, Any], profile_data: Dict[str, Any]) -> Dict[str, Any]:
    return build_position_fit_assessment(job, profile_data)


def build_fast_outreach(profile_data: Dict[str, Any], job: Dict[str, Any]) -> Dict[str, str]:
    name = profile_data.get("name", "there")
    position = job.get("title", "our open role")
    department = job.get("department", "the hiring team")
    requirements = ", ".join(job.get("requirements", [])[:3]) or "the role requirements"
    return {
        "sourcing_pitch": f"{name} appears aligned with {position}; verify role depth, recent impact, and interest level before advancing.",
        "outreach_email": f"Subject: Invitation to interview for {position}\n\nDear {name},\n\nI'm reaching out from Intelligent Recruiter Workspace about our {position} role in {department}. We found your profile through LinkedIn sourcing while looking for candidates with experience related to {requirements}.\n\nYour background appears potentially relevant, and we would like to invite you to create or log in to the candidate portal and complete a personalized warm-up interview session.\n\nBest regards,\nIntelligent Recruiter Workspace Hiring Team"
    }
