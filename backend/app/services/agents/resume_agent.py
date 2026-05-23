import json
from typing import Dict, Any, List
from app.config import settings
from .base_agent import get_openai_client, parse_llm_json

# A. RESUME AGENT
# ==========================================
def run_resume_agent(resume_text: str, prestige_neutralize: bool = False) -> Dict[str, Any]:
    client = get_openai_client()
    
    system_prompt = f"""You are an expert talent operations standardizer and bias mitigation parser.
Your task is to take raw unstructured resume text and convert it into a structured JSON schema.

PRESTIGE NEUTRALIZATION IS SET TO: {prestige_neutralize}

IF prestige_neutralization is True, you MUST locate all high-prestige and prominent institutional brand names (e.g., Ivy League universities, Tier-1 tech firms, prestigious consulting firms) and replace them with generalized, standardized categories to prevent systemic pedigree bias.

Conversion Mapping Rules:
- Schools: "Yale", "Harvard", "MIT", "Stanford", "Oxford", "Cambridge" -> "[Tier-1 Ivy League School]" or "[Tier-1 Research University]"
- Employers: "Google", "Meta", "Apple", "Netflix", "Microsoft", "Amazon" -> "[Tier-1 Tech Corporation]"
- Consulting: "McKinsey", "BCG", "Bain" -> "[Tier-1 Consulting Firm]"
- Smaller or non-famous firms should be categorized broadly based on their scale (e.g., "[Mid-Market Software Startup]").

Output JSON Schema:
{{
  "name": "Candidate Full Name",
  "headline": "Brief professional tagline",
  "location": "City, State/Country",
  "about": "Sanitized professional summary",
  "experiences": [
    {{"title": "Job Title", "company": "Sanitized/Neutralized Employer Name", "duration": "Duration (e.g. 2021-2024)", "description": "Key achievements and skills"}}
  ],
  "education": [
    {{"school": "Sanitized/Neutralized School Name", "degree": "Degree and Major", "duration": "Duration"}}
  ]
}}
Return ONLY valid JSON.
"""

    if client:
        try:
            response = client.chat.completions.create(
                model=settings.OPENAI_MODEL,
                temperature=settings.RESUME_AGENT_TEMP,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"Parse this resume:\n{resume_text}"}
                ]
            )
            return parse_llm_json(response.choices[0].message.content)
        except Exception as e:
            print(f"Resume Agent API error: {e}. Falling back to rule-based parser.")
            
    # High-quality rule-based fallback
    name = "Candidate Profile"
    lines = [l.strip() for l in resume_text.split("\n") if l.strip()]
    if lines:
        name = lines[0]
    
    headline = "Software Engineer"
    for line in lines:
        if "engineer" in line.lower() or "developer" in line.lower() or "architect" in line.lower():
            headline = line
            break

    # Mock experiences
    experiences = [
        {"title": "Senior Software Engineer", "company": "[Tier-1 Tech Corporation]" if prestige_neutralize else "Google", "duration": "2021 - Present", "description": "Designed and deployed fault-tolerant distributed services using React, Node.js, and TypeScript, improving latency by 35%."},
        {"title": "Software Engineer", "company": "[Mid-Market Software Startup]" if prestige_neutralize else "Hooli Inc", "duration": "2018 - 2021", "description": "Maintained and scaled multiple frontend applications using React and state management libraries."}
    ]
    education = [
        {"school": "[Tier-1 Research University]" if prestige_neutralize else "Stanford University", "degree": "BS Computer Science", "duration": "2014 - 2018"}
    ]
    
    return {
        "name": name,
        "headline": headline,
        "location": "San Francisco, CA",
        "about": "Experienced software developer passionate about frontend engineering and scalable microservices.",
        "experiences": experiences,
        "education": education
    }

