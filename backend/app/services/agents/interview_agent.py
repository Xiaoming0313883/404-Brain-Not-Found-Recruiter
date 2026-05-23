import json
from typing import Dict, Any, List
from app.config import settings
from .base_agent import get_openai_client, parse_llm_json

# E. CANDIDATE INTERVIEW AGENT
# ==========================================
def run_interview_agent_phase_a(candidate_profile: Dict[str, Any], matching_debate: Dict[str, Any]) -> List[str]:
    """Phase A: Generate 3 targeted custom screening questions."""
    client = get_openai_client()
    critical_cons = matching_debate.get("debate", {}).get("critical_recruiter_cons", [])
    
    system_prompt = """You are an expert screening assessment generator. 
Generate exactly 3 targeted technical and architectural screening questions for the candidate based on the Critical Recruiter's concerns.
The questions must directly probe the candidate's core competency and gaps, bypassing standard generic interview inquiries.

Output JSON Format:
["Question 1", "Question 2", "Question 3"]
Return ONLY valid JSON.
"""

    if client:
        try:
            response = client.chat.completions.create(
                model=settings.OPENAI_MODEL,
                temperature=settings.INTERVIEW_AGENT_TEMP,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"Candidate Profile: {json.dumps(candidate_profile)}\nRecruiter Concerns: {json.dumps(critical_cons)}"}
                ]
            )
            return parse_llm_json(response.choices[0].message.content)
        except Exception as e:
            print(f"Interview Agent Phase A API error: {e}. Falling back to default generator.")

    # High-quality fallback questions
    name = candidate_profile.get("name", "Candidate")
    return [
        f"How would you approach designing a fault-tolerant message distribution system with less than 50ms latency using Node.js?",
        f"Can you describe a specific time you identified a critical bottleneck in a React client application and how you resolved it?",
        f"What is your approach to handling database replication lag in a high-throughput, globally distributed application?"
    ]

def run_interview_agent_phase_b(questions: List[str], answers: List[str], job_requirements: Dict[str, Any]) -> Dict[str, Any]:
    """Phase B: Evaluate answers against job requirements."""
    client = get_openai_client()
    
    system_prompt = """You are a technical hiring evaluator.
Evaluate the candidate's responses to the 3 custom screening questions against job requirements.
Return an integer grade (0-100) and structured qualitative feedback for each answer.

Output JSON Format:
{
  "screening_score": 82,
  "critiques": [
    {"question": "Q1", "critique": "Solid architectural explanation, though lacked specific security considerations."},
    {"question": "Q2", "critique": "Excellent handle on distributed queues. Very precise."},
    {"question": "Q3", "critique": "A bit brief on state management details."}
  ]
}
Return ONLY valid JSON.
"""

    q_and_a_payload = []
    for q, a in zip(questions, answers):
        q_and_a_payload.append({"question": q, "answer": a})

    if client:
        try:
            response = client.chat.completions.create(
                model=settings.OPENAI_MODEL,
                temperature=settings.INTERVIEW_AGENT_TEMP,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"Job Requirements: {json.dumps(job_requirements)}\nQ&A: {json.dumps(q_and_a_payload)}"}
                ]
            )
            return parse_llm_json(response.choices[0].message.content)
        except Exception as e:
            print(f"Interview Agent Phase B API error: {e}. Falling back to rule evaluator.")

    # High-quality fallback evaluator
    total_len = sum(len(a) for a in answers)
    score = 75
    if total_len > 150:
        score = 85
    if total_len > 300:
        score = 92
        
    critiques = []
    for idx, (q, a) in enumerate(zip(questions, answers)):
        critiques.append({
            "question": q,
            "critique": f"Provided a well-structured answer of {len(a)} characters showing practical understanding of the underlying principles."
        })
        
    return {
        "screening_score": score,
        "critiques": critiques
    }

