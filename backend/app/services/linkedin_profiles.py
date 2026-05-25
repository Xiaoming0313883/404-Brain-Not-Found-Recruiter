import html
import asyncio
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict
from ..config import settings
from .agents.matching_agent import build_position_fit_assessment


def _get_run_field(run: Any, field_snake: str, field_camel: str) -> Any:
    if run is None:
        return None
    if isinstance(run, dict):
        return run.get(field_camel) or run.get(field_snake)
    return getattr(run, field_snake, None) or getattr(run, field_camel, None)



def normalize_linkedin_profile_url(linkedin_url: str) -> str:
    raw_url = (linkedin_url or "").strip()
    if not raw_url:
        raise ValueError("Please enter a LinkedIn profile URL.")
    if not re.match(r"^https?://", raw_url, flags=re.IGNORECASE):
        raw_url = f"https://{raw_url}"

    parsed = urllib.parse.urlparse(raw_url)
    host = (parsed.netloc or "").lower().split(":")[0]
    if not host.endswith("linkedin.com"):
        raise ValueError("Please enter a valid LinkedIn profile URL such as https://www.linkedin.com/in/username.")

    path_parts = [urllib.parse.unquote(part) for part in parsed.path.split("/") if part]
    profile_prefixes = {"in", "pub"}
    slug = ""
    for index, part in enumerate(path_parts):
        if part.lower() in profile_prefixes and index + 1 < len(path_parts):
            slug = path_parts[index + 1].strip()
            break
    if not slug:
        raise ValueError("Please enter a LinkedIn profile URL containing /in/username or /pub/username.")

    safe_slug = urllib.parse.quote(slug.strip("/"), safe="-_%")
    return f"https://www.linkedin.com/in/{safe_slug}"


def _name_from_url(linkedin_url: str) -> str:
    try:
        linkedin_url = normalize_linkedin_profile_url(linkedin_url)
    except ValueError:
        return "Alex Mercer"
    slug = urllib.parse.urlparse(linkedin_url).path.split("/in/")[-1].strip("/")
    return slug.replace("-", " ").replace("_", " ").strip().title() or "Alex Mercer"


def _is_linkedin_profile_url(linkedin_url: str) -> bool:
    try:
        normalize_linkedin_profile_url(linkedin_url)
        return True
    except ValueError:
        return False


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


def _model_dump(value: Any) -> Dict[str, Any]:
    if hasattr(value, "model_dump"):
        return value.model_dump()
    if hasattr(value, "dict"):
        return value.dict()
    return dict(value or {})


def _date_range(item: Dict[str, Any]) -> str:
    start = item.get("from_date") or ""
    end = item.get("to_date") or ""
    duration = item.get("duration") or ""
    if start or end:
        return f"{start} - {end or 'Present'}".strip()
    return duration


async def _scrape_authenticated_profile(linkedin_url: str) -> Dict[str, Any]:
    from linkedin_scraper import BrowserManager, PersonScraper, login_with_cookie

    async with BrowserManager(headless=settings.LINKEDIN_HEADLESS) as browser:
        page = browser.page
        await login_with_cookie(page, settings.LINKEDIN_LI_AT_COOKIE.strip())
        person = await PersonScraper(page).scrape(linkedin_url)

    person_data = _model_dump(person)
    experiences = []
    for item in person_data.get("experiences", []) or []:
        exp = _model_dump(item)
        experiences.append({
            "title": exp.get("position_title") or "",
            "company": exp.get("institution_name") or "",
            "duration": _date_range(exp),
            "description": exp.get("description") or ""
        })

    education = []
    for item in person_data.get("educations", []) or []:
        edu = _model_dump(item)
        education.append({
            "school": edu.get("institution_name") or "",
            "degree": edu.get("degree") or "",
            "duration": _date_range(edu),
            "description": edu.get("description") or ""
        })

    contact_email = ""
    for item in person_data.get("contacts", []) or []:
        contact = _model_dump(item)
        if contact.get("type") == "email" and contact.get("value"):
            contact_email = contact["value"]
            break

    name = person_data.get("name") or _name_from_url(linkedin_url)
    slug = re.sub(r"[^a-z0-9]+", ".", name.lower()).strip(".") or "candidate"
    return {
        "name": name,
        "email": contact_email or f"{slug}@email.com",
        "headline": (experiences[0].get("title") if experiences else "LinkedIn profile"),
        "location": person_data.get("location") or "Pending manual verification",
        "about": person_data.get("about") or "",
        "experiences": experiences,
        "education": education,
        "profile_image_url": "",
        "scrape_status": "linkedin_authenticated",
        "scrape_warning": "LinkedIn profile details were captured with the authenticated linkedin-scraper session. Verify before outreach.",
        "source_url": linkedin_url,
        "source_type": "linkedin",
        "source_method": "manual_authenticated"
    }


def _scrape_with_optional_cookie(linkedin_url: str) -> Dict[str, Any]:
    if not settings.LINKEDIN_LI_AT_COOKIE.strip():
        return {}
    try:
        return asyncio.run(_scrape_authenticated_profile(linkedin_url))
    except RuntimeError:
        loop = asyncio.new_event_loop()
        try:
            return loop.run_until_complete(_scrape_authenticated_profile(linkedin_url))
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning("LinkedIn authenticated scrape failed, falling back to public metadata: %s", e)
            return {}
        finally:
            loop.close()
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning("LinkedIn authenticated scrape failed, falling back to public metadata: %s", e)
        return {}


def parse_apify_profile(item: Dict[str, Any], linkedin_url: str) -> Dict[str, Any]:
    # Name
    first_name = item.get("firstName") or ""
    last_name = item.get("lastName") or ""
    name = item.get("name") or item.get("fullName") or ""
    if not name and (first_name or last_name):
        name = f"{first_name} {last_name}".strip()
    if not name:
        name = _name_from_url(linkedin_url)
        
    # Headline
    headline = item.get("headline") or item.get("subTitle") or item.get("position") or "LinkedIn Candidate"
    if isinstance(headline, dict):
        headline = headline.get("text") or "LinkedIn Candidate"
    
    # Location
    location = item.get("location") or item.get("city") or "Pending manual verification"
    if isinstance(location, dict):
        location = location.get("linkedinText") or location.get("parsed", {}).get("text") or location.get("text") or "Pending manual verification"
    
    # About
    about = item.get("about") or item.get("summary") or item.get("description") or ""
    
    # Profile picture
    profile_image_url = item.get("avatar") or item.get("profilePicUrl") or item.get("profilePicture") or item.get("photo") or ""
    if isinstance(profile_image_url, dict):
        profile_image_url = profile_image_url.get("url") or ""
    
    # Experiences
    experiences = []
    apify_exp = item.get("experiences") or item.get("experience") or item.get("positions") or item.get("jobs") or []
    for exp in apify_exp:
        title = exp.get("title") or exp.get("position") or exp.get("position_title") or exp.get("role") or ""
        company = exp.get("companyName") or exp.get("company") or exp.get("institution_name") or ""
        
        # duration
        duration = exp.get("duration") or ""
        if not duration:
            start = exp.get("startDate") or ""
            if isinstance(start, dict):
                start = start.get("text") or start.get("year") or ""
            end = exp.get("endDate") or "Present"
            if isinstance(end, dict):
                end = end.get("text") or end.get("year") or "Present"
            if start:
                if isinstance(start, str) and start.startswith("undefined "):
                    start = start.replace("undefined ", "")
                if isinstance(end, str) and end.startswith("undefined "):
                    end = end.replace("undefined ", "")
                duration = f"{start} - {end}"
                
        experiences.append({
            "title": title,
            "company": company,
            "duration": duration,
            "description": exp.get("description") or ""
        })
        
    # Education
    education = []
    apify_edu = item.get("education") or item.get("educations") or item.get("schools") or []
    for edu in apify_edu:
        school = edu.get("schoolName") or edu.get("school") or edu.get("institution_name") or ""
        
        # degree name
        degree = edu.get("degree") or edu.get("degreeName") or ""
        field = edu.get("fieldOfStudy") or ""
        if degree and field:
            degree_str = f"{degree} in {field}"
        elif degree:
            degree_str = degree
        else:
            degree_str = field or "Degree details pending verification"
            
        # duration
        duration = edu.get("duration") or edu.get("dateRange") or ""
        if not duration:
            start = edu.get("startDate") or ""
            if isinstance(start, dict):
                start = start.get("text") or start.get("year") or ""
            end = edu.get("endDate") or "Present"
            if isinstance(end, dict):
                end = end.get("text") or end.get("year") or "Present"
            if start:
                if isinstance(start, str) and start.startswith("undefined "):
                    start = start.replace("undefined ", "")
                if isinstance(end, str) and end.startswith("undefined "):
                    end = end.replace("undefined ", "")
                duration = f"{start} - {end}"
                
        education.append({
            "school": school,
            "degree": degree_str,
            "duration": duration,
            "description": edu.get("description") or edu.get("activities") or ""
        })
        
    # Email
    email = item.get("email") or item.get("emailAddress") or ""
    if not email:
        emails = item.get("emails") or []
        if isinstance(emails, list) and emails:
            email = emails[0]
    if not email:
        contact_details = item.get("contactInfo", {})
        if isinstance(contact_details, dict):
            email = contact_details.get("email") or ""
            
    if not email:
        slug = re.sub(r"[^a-z0-9]+", ".", name.lower()).strip(".") or "candidate"
        email = f"{slug}@email.com"
        
    return {
        "name": name,
        "email": email,
        "headline": headline,
        "location": location,
        "about": about,
        "experiences": experiences,
        "education": education,
        "profile_image_url": profile_image_url,
        "scrape_status": "apify_scraped",
        "scrape_warning": "LinkedIn profile details were captured via Apify live scraper. Verify before outreach.",
        "source_url": linkedin_url,
        "source_type": "linkedin",
        "source_method": "manual_apify"
    }


def scrape_linkedin_profile_apify(linkedin_url: str) -> Dict[str, Any] | None:
    if not settings.APIFY_API_TOKEN.strip():
        return None
    try:
        from apify_client import ApifyClient
        from apify_client.errors import ApifyApiError
        from datetime import timedelta
        client = ApifyClient(settings.APIFY_API_TOKEN.strip())
        
        run_input = {
            "profileUrls": [linkedin_url],
            "urls": [linkedin_url]
        }
        if settings.LINKEDIN_LI_AT_COOKIE.strip():
            run_input["cookies"] = [{"name": "li_at", "value": settings.LINKEDIN_LI_AT_COOKIE.strip()}]
            
        run = client.actor(settings.APIFY_PROFILE_ACTOR_ID).call(
            run_input=run_input,
            wait_duration=timedelta(seconds=settings.APIFY_TIMEOUT_SECONDS)
        )
        
        if not run:
            import logging
            logging.getLogger(__name__).warning("Apify profile scraper run failed to start or return run object.")
            return None
            
        status = _get_run_field(run, "status", "status")
        if status != "SUCCEEDED":
            import logging
            logging.getLogger(__name__).warning("Apify profile scraper run finished with status: %s", status)
            return None
            
        dataset_id = _get_run_field(run, "default_dataset_id", "defaultDatasetId")
        dataset_items = list(client.dataset(dataset_id).iterate_items())
        if dataset_items:
            return parse_apify_profile(dataset_items[0], linkedin_url)
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning("Apify profile scrape failed: %s", e)
    return None


def scrape_linkedin_profile(linkedin_url: str) -> Dict[str, Any]:
    """Best-effort LinkedIn profile read.

    When LINKEDIN_LI_AT_COOKIE is configured, linkedin-scraper is used with that
    authenticated browser cookie. Without it, the app keeps the original public
    metadata path and marks the record for manual verification.
    """
    linkedin_url = normalize_linkedin_profile_url(linkedin_url)

    # 1. Prefer Apify live scraper if API key is configured
    apify_profile = scrape_linkedin_profile_apify(linkedin_url)
    if apify_profile:
        return apify_profile

    # 2. Fall back to local authenticated browser scrape
    authenticated_profile = _scrape_with_optional_cookie(linkedin_url)
    if authenticated_profile:
        return authenticated_profile

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
        "source_url": linkedin_url,
        "source_type": "linkedin",
        "source_method": "manual_public"
    }


def build_fast_match_results(job: Dict[str, Any], profile_data: Dict[str, Any], bias_controls: Dict[str, Any] | None = None, prestige_analysis: Dict[str, Any] | None = None) -> Dict[str, Any]:
    return build_position_fit_assessment(job, profile_data, bias_controls, prestige_analysis)


def build_fast_outreach(profile_data: Dict[str, Any], job: Dict[str, Any]) -> Dict[str, str]:
    name = profile_data.get("name", "there")
    position = job.get("title", "our open role")
    department = job.get("department", "the hiring team")
    requirements = ", ".join(job.get("requirements", [])[:3]) or "the role requirements"
    return {
        "sourcing_pitch": f"{name} appears aligned with {position}; verify role depth, recent impact, and interest level before advancing.",
        "outreach_email": f"Subject: Invitation to interview for {position}\n\nDear {name},\n\nI'm reaching out from Intelligent Recruiter Workspace about our {position} role in {department}. We found your profile through LinkedIn sourcing while looking for candidates with experience related to {requirements}.\n\nYour background appears potentially relevant, and we would like to invite you to create or log in to the candidate portal and complete a personalized warm-up interview session.\n\nBest regards,\nIntelligent Recruiter Workspace Hiring Team"
    }
