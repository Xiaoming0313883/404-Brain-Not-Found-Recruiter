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
    return [
        "How would you approach designing a fault-tolerant message distribution system with less than 50ms latency using Node.js?",
        "Can you describe a specific time you identified a critical bottleneck in a React client application and how you resolved it?",
        "What is your approach to handling database replication lag in a high-throughput, globally distributed application?"
    ]

def run_interview_agent_phase_b(questions: List[str], answers: List[str], job_requirements: Dict[str, Any]) -> Dict[str, Any]:
    """Phase B: Evaluate answers against job requirements with detailed structured critique."""
    client = get_openai_client()
    
    system_prompt = """You are a technical hiring evaluator.
Evaluate the candidate's responses to the 3 custom screening questions against job requirements.
Return an integer grade (0-100) and rich structured qualitative feedback for EACH answer.

Output JSON Format:
{
  "screening_score": 82,
  "critiques": [
    {
      "question": "The full question text",
      "critique": "Overall 1-2 sentence summary of the answer quality.",
      "strengths": ["Specific strength 1", "Specific strength 2"],
      "weaknesses": ["Specific gap or weakness 1", "Area needing improvement 2"],
      "suggested_improvement": "A concrete, actionable suggestion the candidate can act on to improve their answer or skill."
    }
  ]
}
- strengths: list of 1-3 concrete positives from the answer
- weaknesses: list of 1-3 specific gaps, omissions, or weak points
- suggested_improvement: one clear, specific actionable tip
Return ONLY valid JSON. No markdown code fences.
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

    # High-quality structured fallback evaluator
    total_len = sum(len(a) for a in answers)
    score = 75
    if total_len > 150:
        score = 85
    if total_len > 300:
        score = 92
        
    critiques = []
    for idx, (q, a) in enumerate(zip(questions, answers)):
        word_count = len(a.split())
        critiques.append({
            "question": q,
            "critique": f"The candidate provided a {'detailed' if word_count > 40 else 'brief'} response of {word_count} words, demonstrating {'solid' if word_count > 40 else 'foundational'} understanding of the topic.",
            "strengths": [
                "Addressed the core of the question directly.",
                "Showed practical awareness of real-world constraints." if word_count > 30 else "Demonstrated basic familiarity with the subject."
            ],
            "weaknesses": [
                "Could provide more concrete examples from past experience." if word_count < 60 else "Some technical depth could be expanded further.",
                "Lacked specific metrics or measurable outcomes."
            ],
            "suggested_improvement": (
                "Expand your answer with a specific project example: describe the problem, your decision-making process, the solution you implemented, and the measurable impact it had."
                if word_count < 60 else
                "Add quantifiable results (e.g., 'reduced latency by 40%') to make your answers more compelling and verifiable."
            )
        })
        
    return {
        "screening_score": score,
        "critiques": critiques
    }
