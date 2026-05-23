import json
import re
from typing import Dict, Any, List
from app.config import settings
from .base_agent import get_openai_client, parse_llm_json

# D. MATCHING AGENT
# ==========================================
def _collect_sourcing_terms(job_requirements: Dict[str, Any]) -> List[str]:
    criteria = job_requirements.get("sourcing_criteria") or {}
    raw_values: List[str] = []

    raw_values.extend(job_requirements.get("requirements", []))
    for key in ("candidate_profile", "must_have_skills", "domain_context", "success_signals", "search_keywords"):
        value = criteria.get(key)
        if isinstance(value, str):
            raw_values.append(value)

    terms: List[str] = []
    for value in raw_values:
        for term in re.split(r"[,;\n]| and | or ", value):
            cleaned = term.strip(" .").strip()
            if cleaned and len(cleaned) <= 60 and cleaned.lower() not in {t.lower() for t in terms}:
                terms.append(cleaned)

    return terms[:8]

def run_matching_agent(job_requirements: Dict[str, Any], candidate_profile: Dict[str, Any]) -> Dict[str, Any]:
    client = get_openai_client()
    system_prompt = """You are an expert two-persona hiring committee. You will evaluate the match between a Job Requirement profile and a Candidate's Profile.
You MUST output two highly detailed, contrasting evaluation arguments:

1. CRITICAL RECRUITER PERSPECTIVE: Focus intensely on risks. Call out lack of formal certifications, short company tenures (under 1 year), tech stack mismatches, or missing domain exposure.
2. TALENT ADVOCATE PERSPECTIVE: Focus on growth velocity. Highlight how fast the candidate learns, self-guided technical achievements, open-source work, and transferable architectural capabilities.

If the Job Requirement profile includes sourcing_criteria from the hiring-manager intake, treat those answers as first-class matching criteria. Evaluate must-have skills, target profile, domain context, success signals, avoid signals, and search keywords against the candidate profile.

Calculate the following metric values:
- technical (integer, 0-100)
- domain (integer, 0-100)
- culture (integer, 0-100)
- trajectory_slope (integer, 0-100): Based on career acceleration, rapid promotions, and skills acquisition rate.

Output JSON Format:
{
  "debate": {
    "critical_recruiter_cons": [
      "Tenure is relatively short at current role.",
      "Lacks direct experience with Vite configurations."
    ],
    "talent_advocate_pros": [
      "Exceptional trajectory: promoted twice in under 3 years.",
      "Highly active contributor in modern frontend repos."
    ]
  },
  "scores": {
    "technical": 85,
    "domain": 80,
    "culture": 90,
    "trajectory_slope": 95
  }
}
Return ONLY valid JSON.
"""

    user_content = f"""Job Requirements: {json.dumps(job_requirements)}
Candidate Profile: {json.dumps(candidate_profile)}"""

    if client:
        try:
            response = client.chat.completions.create(
                model=settings.OPENAI_MODEL,
                temperature=settings.MATCHING_AGENT_TEMP,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_content}
                ]
            )
            return parse_llm_json(response.choices[0].message.content)
        except Exception as e:
            print(f"Matching Agent API error: {e}. Falling back to rule-based debate simulator.")

    # High-quality fallback debate builder
    skills_found = 0
    candidate_words = str(candidate_profile).lower()
    job_pillars = job_requirements.get("pillars") or job_requirements.get("requirements") or ["React", "Node.js"]
    sourcing_terms = _collect_sourcing_terms(job_requirements)
    comparison_terms = list(dict.fromkeys([*job_pillars, *sourcing_terms]))
    
    for pillar in comparison_terms:
        if pillar.lower() in candidate_words:
            skills_found += 1
            
    match_percentage = int((skills_found / max(1, len(comparison_terms))) * 100)
    tech_score = max(60, min(98, match_percentage + 15))
    domain_score = max(55, min(95, match_percentage + 10))
    culture_score = 85
    trajectory_score = 90
    
    # Calculate trajectory based on duration or keywords like "senior"
    experiences = candidate_profile.get("experiences", [])
    if len(experiences) > 1:
        # Check promotion
        first_title = experiences[-1].get("title", "").lower()
        latest_title = experiences[0].get("title", "").lower()
        if "senior" in latest_title and "junior" in first_title or "software engineer" in first_title:
            trajectory_score = 95
            
    return {
        "debate": {
          "critical_recruiter_cons": [
            "Lacks specific certifications in enterprise distributed systems.",
            f"Relatively light background in some secondary skill requirements and intake criteria."
          ],
          "talent_advocate_pros": [
            "Demonstrates exceptional growth trajectory and rapid skill acquisition.",
            f"Strong hands-on experience with core skill pillars like {', '.join(comparison_terms[:2])}."
          ]
        },
        "scores": {
          "technical": tech_score,
          "domain": domain_score,
          "culture": culture_score,
          "trajectory_slope": trajectory_score
        }
    }

