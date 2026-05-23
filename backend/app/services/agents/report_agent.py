import json
from typing import Dict, Any, List
from app.config import settings
from .base_agent import get_openai_client, parse_llm_json

# F. REPORT AGENT
# ==========================================
def run_report_agent(candidate_profile: Dict[str, Any], match_results: Dict[str, Any], job_requirements: Dict[str, Any] | None = None) -> Dict[str, Any]:
    client = get_openai_client()
    
    system_prompt = """Synthesize the candidate's evaluations and draft:
1. A highly persuasive, 2-sentence "Why This Person?" executive pitch for hiring managers.
2. A personalized outreach email inviting them to the company's workspace technical sandbox.
The outreach email must include:
- A clear subject line.
- The company/workspace name.
- The exact position title and department.
- Why the candidate was contacted, based on concrete profile signals.
- A concise summary of the role requirements and how their profile relates.
- How we found/reached them, such as LinkedIn sourcing or inbound application review.
- The next step: create/login to the candidate portal and complete the personalized warm-up sandbox.
Never use vague placeholders like [Your Name] or [Your Title].
3. A personalized 3-week on-boarding/upskilling roadmap detailing actionable milestones for weeks 1, 2, and 3.

Output JSON Format:
{
  "sourcing_pitch": "Why This Person pitch goes here...",
  "outreach_email": "Subject: Welcome back, [Candidate]!...",
  "upskilling_roadmap": {
    "week_1": "Focus area and learning milestones for week 1",
    "week_2": "Focus area and learning milestones for week 2",
    "week_3": "Focus area and learning milestones for week 3"
  }
}
Return ONLY valid JSON.
"""

    if client:
        try:
            response = client.chat.completions.create(
                model=settings.OPENAI_MODEL,
                temperature=settings.REPORT_AGENT_TEMP,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"Company: Intelligent Recruiter Workspace\nJob Requirements: {json.dumps(job_requirements or {})}\nCandidate Profile: {json.dumps(candidate_profile)}\nMatch Results: {json.dumps(match_results)}"}
                ]
            )
            return parse_llm_json(response.choices[0].message.content)
        except Exception as e:
            print(f"Report Agent API error: {e}. Falling back to static generator.")

    # High-quality fallback report generator
    name = candidate_profile.get("name", "Candidate")
    headline = candidate_profile.get("headline", "Software Engineer")
    job = job_requirements or {}
    position = job.get("title", "one of our open roles")
    department = job.get("department", "the hiring team")
    requirements = ", ".join(job.get("requirements", [])[:3]) or "the core role requirements"
    
    pitch = f"{name} stands out due to an exceptional technical growth rate and strong architectural foundations. Their experience matches key core technologies perfectly, presenting them as a highly capable addition to the engineering team."
    
    email = f"Subject: Invitation to interview for {position}\n\nDear {name},\n\nI'm reaching out from Intelligent Recruiter Workspace about our {position} role in {department}. We found your profile through LinkedIn sourcing and noticed signals that align with the role, including your background as a {headline}.\n\nThis position focuses on {requirements}. Based on your profile and our matching review, we think your experience may be relevant and would like to invite you to continue in our candidate portal.\n\nNext step: create or log in to your candidate account and complete a personalized warm-up sandbox tailored to your profile and this position.\n\nBest regards,\nIntelligent Recruiter Workspace Hiring Team"
    
    return {
        "sourcing_pitch": pitch,
        "outreach_email": email,
        "upskilling_roadmap": {
            "week_1": "Onboarding & Stack Familiarity: Deep dive into the core architecture, tooling pipelines, and testing suites.",
            "week_2": "Component Ownership: Take ownership of a minor system component and optimize state routing.",
            "week_3": "Architectural Contributions: Collaboratively contribute to backend scaling strategies and distributed message broker setups."
        }
    }
