import json
from typing import Dict, Any, List
from app.config import settings
from .base_agent import get_openai_client, parse_llm_json

# B. EMPLOYER REQUIREMENT AGENT
# ==========================================
def run_requirement_intake_agent(job_title: str, department: str, chat_messages: List[Dict[str, str]]) -> Dict[str, Any]:
    client = get_openai_client()
    system_prompt = """You are the Employer Requirement Agent inside a hiring-manager job builder.
Your job is to interview the hiring manager, one question at a time, until you have enough information to generate a useful job description and requirements.

Rules:
- Do not use a fixed script.
- Ask the single most useful next question based on the position title, department, and previous answers.
- Avoid repeating questions that were already answered.
- Ask about missing context only: outcomes, seniority, problems solved, technical depth, domain context, success evidence, disqualifiers, team constraints, or qualification expectations.
- When enough context exists, stop asking and return a generated role specification.

Return ONLY valid JSON in this shape:
{
  "is_complete": false,
  "question": "One concise next question for the hiring manager",
  "context": {
    "agent_summary": "Short summary of what is known so far"
  }
}

When complete, return:
{
  "is_complete": true,
  "question": "",
  "context": {
    "agent_summary": "Short summary of the final search profile",
    "generated_description": "Candidate-facing job description",
    "generated_requirements": ["Requirement 1", "Requirement 2"],
    "must_have_signals": ["Signal 1"],
    "avoid_signals": ["Concern 1"]
  }
}
"""

    user_payload = {
        "job_title": job_title,
        "department": department,
        "chat_messages": chat_messages,
        "manager_answer_count": len([m for m in chat_messages if m.get("role") == "manager"])
    }

    if client:
        try:
            response = client.chat.completions.create(
                model=settings.OPENAI_MODEL,
                temperature=settings.REQUIREMENT_AGENT_TEMP,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": json.dumps(user_payload)}
                ]
            )
            parsed = parse_llm_json(response.choices[0].message.content)
            if "context" not in parsed:
                parsed["context"] = {}
            return parsed
        except Exception as e:
            print(f"Requirement Intake Agent API error: {e}. Falling back to adaptive local intake.")

    return build_fallback_intake_turn(job_title, department, chat_messages)

def build_fallback_intake_turn(job_title: str, department: str, chat_messages: List[Dict[str, str]]) -> Dict[str, Any]:
    manager_answers = [m.get("content", "").strip() for m in chat_messages if m.get("role") == "manager" and m.get("content")]
    combined = " ".join(manager_answers).lower()
    role = job_title or "this position"
    team = department or "this team"

    if len(manager_answers) >= 5:
        description = (
            f"{role} will help the {team} team deliver {manager_answers[0] if manager_answers else 'important business outcomes'}. "
            f"The best candidates should show relevant experience, practical problem solving, and evidence of impact."
        )
        requirements = extract_requirement_phrases(manager_answers, role, team)
        return {
            "is_complete": True,
            "question": "",
            "context": {
                "agent_summary": f"Search for {role} candidates with evidence of {', '.join(requirements[:3]).lower()}.",
                "generated_description": description,
                "generated_requirements": requirements,
                "must_have_signals": requirements[:3],
                "avoid_signals": ["Major mismatch with the stated role outcomes"]
            }
        }

    if not manager_answers:
        question = f"What should the {role} accomplish for the {team} team in the first 6 months?"
    elif "senior" not in combined and "junior" not in combined and "lead" not in combined and "manager" not in combined:
        question = f"What level of candidate should this be, and what previous titles or responsibilities would make them credible for {role}?"
    elif "experience" not in combined and "built" not in combined and "solved" not in combined:
        question = f"What specific problems should this candidate have solved before, not just tools they have used?"
    elif "domain" not in combined and "industry" not in combined and "user" not in combined and "product" not in combined:
        question = f"What domain, product, users, scale, or business context should they already understand?"
    else:
        question = f"What evidence would make you excited about a profile, and what signals should the agent treat as concerns?"

    return {
        "is_complete": False,
        "question": question,
        "context": {
            "agent_summary": "Requirement intake in progress."
        }
    }

def extract_requirement_phrases(answers: List[str], role: str, team: str) -> List[str]:
    source = " ".join(answers)
    chunks = [
        chunk.strip(" -")
        for chunk in source.replace("\n", ",").split(",")
        if len(chunk.strip()) > 4
    ]
    requirements = chunks[:6]
    if len(requirements) < 3:
        requirements.extend([
            f"Relevant experience for {role}",
            f"Ability to deliver outcomes for {team}",
            "Clear evidence of practical problem solving"
        ])
    return requirements[:6]

def run_requirement_agent(job_title: str, job_description: str) -> Dict[str, Any]:
    client = get_openai_client()
    system_prompt = """You are a professional recruiting operations profiler.
Analyze the provided job description and title, and extract the exact skill requirements.

Tasks:
1. Generate a concise, candidate-facing job description from the hiring manager intake.
2. Extract 3-6 practical requirements that candidates should meet.
3. Extract 3-5 primary technical skill pillars.
4. Extract 2-3 core behavioral or domain competency pillars.
5. Generate a highly optimized Boolean query string designed to search LinkedIn directories for matching passive candidates.
   - Use Boolean operators (AND, OR, NOT, parenthetical grouping).
   - Example: ("Senior Backend Engineer" OR "Staff Developer") AND ("React" OR "Vite") AND ("Distributed Systems" OR "Microservices") NOT "Manager"

Output JSON Format:
{
  "job_description": "Concise role description generated from the intake",
  "requirements": ["5+ years building React applications", "Hands-on Node.js service design"],
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
    requirements = [f"Hands-on experience with {pillar}" for pillar in pillars[:5]]
        
    return {
        "job_description": f"{job_title} role focused on {', '.join(pillars[:3]).lower()} and practical delivery in a cross-functional team.",
        "requirements": requirements,
        "pillars": pillars[:3],
        "behavioral": ["Collaborative Problem Solving", "Technical Leadership"],
        "boolean_queries": f'("{job_title}") AND ("' + '" OR "'.join(pillars[:2]) + '")'
    }

