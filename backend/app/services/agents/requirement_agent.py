import json
from typing import Dict, Any, List
from app.config import settings
from .base_agent import get_openai_client, parse_llm_json

# B. EMPLOYER REQUIREMENT AGENT
# ==========================================
def run_requirement_agent(job_title: str, job_description: str) -> Dict[str, Any]:
    client = get_openai_client()
    system_prompt = """You are a professional recruiting operations profiler.
Analyze the provided job description and title, and extract the exact skill requirements.

Tasks:
1. Extract 3-5 primary technical skill pillars.
2. Extract 2-3 core behavioral or domain competency pillars.
3. Generate a highly optimized Boolean query string designed to search LinkedIn directories for matching passive candidates.
   - Use Boolean operators (AND, OR, NOT, parenthetical grouping).
   - Example: ("Senior Backend Engineer" OR "Staff Developer") AND ("React" OR "Vite") AND ("Distributed Systems" OR "Microservices") NOT "Manager"

Output JSON Format:
{
  "pillars": ["React", "Node.js", "Distributed Systems"],
  "behavioral": ["Collaborative Architecture", "Technical Mentorship"],
  "boolean_queries": "(\"Senior Full-Stack Engineer\") AND (\"React\" OR \"Node.js\") AND (\"Distributed Systems\")"
}
Return ONLY valid JSON.
"""

    if client:
        try:
            response = client.chat.completions.create(
                model=settings.OPENAI_MODEL,
                temperature=settings.REQUIREMENT_AGENT_TEMP,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"Title: {job_title}\nDescription: {job_description}"}
                ]
            )
            return parse_llm_json(response.choices[0].message.content)
        except Exception as e:
            print(f"Requirement Agent API error: {e}. Falling back to rule-based extractor.")

    # High-quality fallback
    words = job_description.lower()
    pillars = []
    if "react" in words or "frontend" in words:
        pillars.append("React")
    if "node" in words or "backend" in words:
        pillars.append("Node.js")
    if "distributed" in words or "system" in words:
        pillars.append("Distributed Systems")
    if not pillars:
        pillars = ["Software Development", "System Architecture", "Cloud Engineering"]
        
    return {
        "pillars": pillars[:3],
        "behavioral": ["Collaborative Problem Solving", "Technical Leadership"],
        "boolean_queries": f'("{job_title}") AND ("' + '" OR "'.join(pillars[:2]) + '")'
    }

