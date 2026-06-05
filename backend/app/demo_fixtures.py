from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta
import re
from typing import Any, Dict, List


DEMO_POSITION_ID = 1
DEMO_JOB_TITLE = "Software Engineer"
DEMO_DEPARTMENT = "Engineering"
DEMO_RESUME_TEXT = """
Goh Sheng Kai
Artificial Intelligence Undergraduate
No 30, Jalan Bukit Cendana 4, Taman Bukit Cendana,
71250 Pasir Panjang, Negeri Sembilan, Malaysia
goh138014@gmail.com
+60 10-8785050

Profile
Dedicated Artificial Intelligence undergraduate with a 4.0 CGPA and a strong
foundation in Python and Web Development. Proven leadership ability as a student
ambassador and extensive experience in peer tutoring.

Education
Universiti Teknologi Malaysia (current), Bachelor of Artificial Intelligence with Honours.
Selangor Matriculation College, 2024/2025, PNGK 4.0.
SMK Pasir Panjang, SPM 2018-2023, 9A 1B+.

Skills
Microsoft Office, Canva, Capcut, Python, PHP, Javascript, HTML, CSS, MySQL.
""".strip()

DEMO_RESUME_SUMMARY = (
    "Artificial Intelligence undergraduate with a 4.0 CGPA, Python and web "
    "development skills, student ambassador leadership, and peer tutoring experience."
)

DEMO_PROFILE_DATA: Dict[str, Any] = {
    "name": "Goh Sheng Kai",
    "email": "goh138014@gmail.com",
    "phone": "+60 10-8785050",
    "age": "19",
    "address": "No 30, Jalan Bukit Cendana 4, Taman Bukit Cendana, 71250 Pasir Panjang, Negeri Sembilan, Malaysia",
    "came_from": "Universiti Teknologi Malaysia Artificial Intelligence undergraduate",
    "headline": "Artificial Intelligence Undergraduate | Python, Web Development, MySQL",
    "location": "Pasir Panjang, Negeri Sembilan, Malaysia",
    "about": (
        "Dedicated Artificial Intelligence undergraduate with a 4.0 CGPA and a "
        "strong foundation in Python and Web Development. Proven leadership ability "
        "as a student ambassador and extensive experience in peer tutoring."
    ),
    "work_experience": (
        "Resume highlights leadership and teaching experience rather than formal employment: "
        "student ambassador for Physics, Peer Assisted Learning for Mathematics and Science, "
        "practical teaching at SJKC Chung Hwa Telok Kemang, ICT Club chairmanship, and "
        "technology competition participation."
    ),
    "qualification": "Bachelor of Artificial Intelligence with Honours",
    "grade_results": "PNGK 4.0; SPM 9A 1B+",
    "awards": [
        "Practical Teacher at SJKC Chung Hwa Telok Kemang, invited by PPD Port Dickson",
        "PNGS 4.0 Award in Semester 1",
        "Outstanding Academic Award in Semester 1",
        "Excellent SPM Student Award",
        "State-level Digital Utilization and Technology Awards (DUTA) Award in 2024",
        "Commendable Personality Award for Male Students",
        "First place in the national Minecraft Education Challenge competition in 2024",
        "Best Academic Session Final Exam Achievement (UASA) Form 5 (first place)",
        "Highest Achievement Award for Good Student Practice",
        "DUTA Personality Award",
        "Best Academic Session Final Exam Achievement (UASA) Form 4 (first place)",
        "Distinguished Co-Curricular Award",
        "100% Attendance Award",
    ],
    "skills": [
        "Microsoft Office",
        "Canva",
        "Capcut",
        "Python",
        "PHP",
        "Javascript",
        "HTML",
        "CSS",
        "MySQL",
        "English (Fluent)",
        "Malay (Fluent)",
        "Chinese (Fluent)",
    ],
    "experiences": [
        {
            "title": "Student Ambassador for Physics",
            "company": "Selangor Matriculation College",
            "duration": "2024 - 2025",
            "description": (
                "Supported Physics learning activities and represented the subject as a student ambassador."
            ),
        },
        {
            "title": "Peer Assisted Learning Tutor",
            "company": "Selangor Matriculation College",
            "duration": "2024 - 2025",
            "description": (
                "Provided peer tutoring support for Mathematics and Science subjects."
            ),
        },
        {
            "title": "ICT Club Chairman",
            "company": "SMK Pasir Panjang",
            "duration": "2018 - 2023",
            "description": "Led school ICT club activities and participated in digital competency competitions.",
        },
    ],
    "education": [
        {
            "school": "Universiti Teknologi Malaysia",
            "degree": "Bachelor of Artificial Intelligence with Honours",
            "duration": "Current",
        },
        {
            "school": "Selangor Matriculation College",
            "degree": "Matriculation Certification, Kementerian Pendidikan Malaysia",
            "duration": "2024/2025, PNGK 4.0",
        },
        {
            "school": "SMK Pasir Panjang",
            "degree": "Sijil Pelajaran Malaysia (SPM)",
            "duration": "2018-2023, 9A 1B+",
        },
    ],
    "extraction_warning": "",
}

DEMO_NEUTRAL_ENTITY_LABELS: Dict[str, str] = {
    "Universiti Teknologi Malaysia": "Public university",
    "Selangor Matriculation College": "Public matriculation college",
    "SMK Pasir Panjang": "Secondary school",
    "SJKC Chung Hwa Telok Kemang": "Primary school",
    "PPD Port Dickson": "District education office",
}

DEMO_BIAS_ANALYSIS: Dict[str, Any] = {
    "prestige_indicators": [
        {
            "type": "university",
            "original": "Universiti Teknologi Malaysia",
            "neutral_category": "Public university",
            "confidence": 1.0,
            "prestige_score": 0,
            "source": "education",
            "reason": "Demo-only hardcoded neutralization for fair hiring controls.",
            "qs_rank": None,
            "qs_badge": "",
            "ranking_status": "demo_hardcoded",
            "ranking_source": "",
        },
        {
            "type": "university",
            "original": "Selangor Matriculation College",
            "neutral_category": "Public matriculation college",
            "confidence": 1.0,
            "prestige_score": 0,
            "source": "education",
            "reason": "Demo-only hardcoded neutralization for fair hiring controls.",
            "qs_rank": None,
            "qs_badge": "",
            "ranking_status": "demo_hardcoded",
            "ranking_source": "",
        },
        {
            "type": "university",
            "original": "SMK Pasir Panjang",
            "neutral_category": "Secondary school",
            "confidence": 1.0,
            "prestige_score": 0,
            "source": "education",
            "reason": "Demo-only hardcoded neutralization for fair hiring controls.",
            "qs_rank": None,
            "qs_badge": "",
            "ranking_status": "demo_hardcoded",
            "ranking_source": "",
        },
        {
            "type": "other",
            "original": "SJKC Chung Hwa Telok Kemang",
            "neutral_category": "Primary school",
            "confidence": 1.0,
            "prestige_score": 0,
            "source": "profile",
            "reason": "Demo-only hardcoded neutralization for fair hiring controls.",
            "qs_rank": None,
            "qs_badge": "",
            "ranking_status": "demo_hardcoded",
            "ranking_source": "",
        },
        {
            "type": "other",
            "original": "PPD Port Dickson",
            "neutral_category": "District education office",
            "confidence": 1.0,
            "prestige_score": 0,
            "source": "profile",
            "reason": "Demo-only hardcoded neutralization for fair hiring controls.",
            "qs_rank": None,
            "qs_badge": "",
            "ranking_status": "demo_hardcoded",
            "ranking_source": "",
        },
    ],
    "risk_level": "low",
    "summary": "Demo profile uses hardcoded neutral school and organization labels for fair hiring controls.",
    "recommendations": ["Evaluate project evidence, skills, and interview answers."],
    "neutralization_summary": "School and organization names are replaced with neutral background categories in demo mode.",
    "prestige_score": 0,
}

DEMO_MATCH_RESULTS: Dict[str, Any] = {
    "scores": {
        "technical": 96,
        "domain": 94,
        "culture": 95,
        "trajectory_slope": 96,
        "overall_position_fit": 96,
    },
    "fit_breakdown": {
        "frontend_engineering": 96,
        "backend_api_design": 95,
        "database_delivery": 94,
        "testing_and_reliability": 96,
    },
    "position_fit_summary": (
        "Goh Sheng Kai is a strong Software Engineer match with direct evidence across "
        "React, TypeScript, backend APIs, Supabase/PostgreSQL data flows, and "
        "production-minded testing."
    ),
    "debate": {
        "talent_advocate_pros": [
            "Hands-on React and TypeScript delivery aligns with the product UI work.",
            "Backend API and PostgreSQL experience supports full-stack ownership.",
            "Capstone leadership shows collaboration and delivery discipline.",
        ],
        "critical_recruiter_cons": [
            "Confirm depth of production incident experience.",
            "Probe how she handles trade-offs when requirements change late.",
        ],
    },
}

DEMO_INTERVIEW_QUESTIONS: List[str] = [
    "Describe a full-stack feature you built with React and an API backend. What decisions made it reliable?",
    "How would you design a Supabase or PostgreSQL-backed workflow that must avoid duplicate candidate applications?",
    "Tell us about a time you improved frontend performance or maintainability in a React application.",
]

DEMO_INTERVIEW_ANSWERS: List[str] = [
    (
        "I built a recruiter dashboard with React, TypeScript, and FastAPI. I kept the UI reliable by separating API mapping "
        "from component state, validating required fields before requests, and adding focused tests around the save flow."
    ),
    (
        "I would enforce a unique application id using candidate email and position id, then use idempotent upserts. "
        "The UI should block duplicate submissions, but Supabase constraints and backend checks should be the source of truth."
    ),
    (
        "On a capstone project I reduced repeated state updates in a candidate list, memoized derived filters, and moved expensive "
        "formatting out of render loops. The page became easier to maintain and noticeably faster during review demos."
    ),
]

DEMO_EVALUATION: Dict[str, Any] = {
    "screening_score": 96,
    "score_breakdown": {
        "role_requirement_alignment": 34,
        "technical_correctness_depth": 24,
        "evidence_specificity": 19,
        "position_impact": 10,
        "communication_clarity": 9,
    },
    "position_fit_verdict": "Strong fit for the Software Engineer role.",
    "hiring_recommendation": "advance",
    "decision_reason": (
        "The answers show practical full-stack delivery, database-aware design, "
        "and clear reasoning about reliability. The candidate consistently explains both "
        "frontend safeguards and backend source-of-truth checks, which is exactly what the "
        "Software Engineer role needs for Supabase-backed hiring workflows."
    ),
    "role_alignment_summary": (
        "Goh Sheng Kai connects React implementation, backend persistence, data integrity, "
        "and product-quality trade-offs to the Software Engineer requirements. The strongest "
        "signals are reliable UI state handling, idempotent application submission design, "
        "focused testing, and performance-minded React maintenance."
    ),
    "question_feedback": [
        {
            "question": DEMO_INTERVIEW_QUESTIONS[0],
            "candidate_answer": DEMO_INTERVIEW_ANSWERS[0],
            "per_answer_score": 96,
            "critique": (
                "The answer scored 96/100 because it gives a concrete full-stack example and names the reliability decisions that matter for this role. "
                "The candidate separates API mapping from component state, validates required fields before requests, and mentions focused tests around the save flow. "
                "That combination shows practical ownership across React, TypeScript, FastAPI, and backend integration rather than only describing UI work. "
                "For the Software Engineer position, this is strong evidence that the candidate can build features that behave predictably during judge demos and real recruiter usage. "
                "The one missing detail is a measurable outcome, such as reduced failed saves, faster review time, or fewer support issues after the feature shipped."
            ),
            "strengths": [
                "Full-stack ownership across React, TypeScript, FastAPI, and API mapping",
                "Clear reliability habits through validation, state separation, and focused save-flow tests",
                "Good product judgment because the answer connects implementation choices to predictable recruiter workflows",
            ],
            "improvements": [
                "Add one shipped-feature metric, such as failure-rate reduction, test coverage, or time saved for users.",
                "Briefly explain how API errors were surfaced to users and logged for debugging.",
            ],
            "hiring_manager_note": (
                "Probe for one specific bug the candidate prevented or caught with these tests, and ask how the same pattern would apply to candidate application submission."
            ),
        },
        {
            "question": DEMO_INTERVIEW_QUESTIONS[1],
            "candidate_answer": DEMO_INTERVIEW_ANSWERS[1],
            "per_answer_score": 95,
            "critique": (
                "The answer scored 95/100 because it correctly treats the database and backend as the source of truth for duplicate prevention. "
                "The candidate proposes a unique application identity from candidate email plus position id, then reinforces it with idempotent upserts. "
                "This is the right shape for a Supabase or PostgreSQL-backed workflow because UI button disabling alone is not enough when users refresh, double-click, retry, or submit from another session. "
                "The answer also shows mature prioritization: the frontend should reduce accidental duplicates, but persistence constraints and backend checks must enforce the rule. "
                "To reach an even stronger production answer, the candidate should mention transaction boundaries, conflict handling, retry-safe responses, and how the UI would display an existing application instead of creating a second one."
            ),
            "strengths": [
                "Strong idempotency model using candidate email and position id",
                "Correctly prioritizes Supabase/PostgreSQL constraints over client-side prevention",
                "Shows awareness of real user behavior such as duplicate submissions and retries",
            ],
            "improvements": [
                "Mention database conflict handling, transaction boundaries, and retry-safe API responses.",
                "Explain how the UI should recover by showing the already-created application state.",
            ],
            "hiring_manager_note": (
                "Ask the candidate to sketch the exact table constraint or upsert payload they would use in Supabase."
            ),
        },
        {
            "question": DEMO_INTERVIEW_QUESTIONS[2],
            "candidate_answer": DEMO_INTERVIEW_ANSWERS[2],
            "per_answer_score": 97,
            "critique": (
                "The answer scored 97/100 because it identifies realistic React performance and maintainability problems: repeated state updates, derived filters recalculated during render, and expensive formatting inside list rendering. "
                "The fixes are practical and role-relevant: memoizing derived data, moving formatting out of hot render paths, and making the candidate list easier to maintain for demo and review workflows. "
                "This answer is especially strong because it does not overclaim a complex optimization; it focuses on simple, high-impact changes that reduce UI lag and make the code easier for a team to reason about. "
                "For this Software Engineer role, the response suggests the candidate can improve existing product surfaces without redesigning the whole UI. "
                "The only gap is measurement: the answer would be stronger with a before-and-after render count, loading time, profiling observation, or reviewer feedback from the demo."
            ),
            "strengths": [
                "Specific React maintainability improvements: memoized filters and reduced render-loop work",
                "Performance reasoning is practical and tied to candidate-list review workflows",
                "Shows good engineering restraint by improving existing surfaces without unnecessary redesign",
            ],
            "improvements": [
                "Quantify the before/after impact using render counts, timing, or profiling results.",
                "Name the tool used to confirm the improvement, such as React DevTools Profiler or browser performance traces.",
            ],
            "hiring_manager_note": (
                "Ask how the candidate decides when memoization is worth it and when it adds unnecessary complexity."
            ),
        },
    ],
    "upskilling_roadmap": {
        "30_days": "Pair on production incidents and deepen observability habits.",
        "60_days": "Own a small full-stack feature from spec to release.",
        "90_days": "Lead a reliability improvement across frontend and API boundaries.",
    },
}

DEMO_OUTREACH = {
    "sourcing_pitch": (
        "Strong Software Engineer candidate with React, TypeScript, API, Supabase, "
        "and PostgreSQL evidence suited to the demo role."
    ),
    "outreach_email": (
        "Subject: Invitation to interview for Software Engineer\n\n"
        "Dear Goh Sheng Kai,\n\n"
        "We reviewed your Software Engineer profile and saw strong alignment with "
        "our React, API, and Supabase-backed product work. We would like to invite "
        "you to continue in the candidate portal.\n\n"
        "Best regards,\n404Hire Hiring Team"
    ),
}

DEMO_LINKEDIN_PROFILES: List[Dict[str, Any]] = [
    {
        "name": "Maya Chen",
        "email": "maya.chen.demo@example.com",
        "headline": "Frontend Engineer | React and TypeScript",
        "location": "Kuala Lumpur, Malaysia",
        "about": "Frontend engineer focused on accessible React interfaces, API integration, and measurable UI performance.",
        "skills": ["React", "TypeScript", "JavaScript", "REST APIs", "Testing", "Performance"],
        "experiences": [
            {
                "title": "Frontend Engineer",
                "company": "Nimbus Product Studio",
                "duration": "2022 - Present",
                "description": "Built reusable React components, optimized rendering, and integrated analytics workflows.",
            }
        ],
        "education": [{"school": "Universiti Malaya", "degree": "Computer Science", "duration": "2018 - 2022"}],
        "source_url": "https://www.linkedin.com/in/maya-chen-demo",
    },
    {
        "name": "Daniel Lim",
        "email": "daniel.lim.demo@example.com",
        "headline": "Backend Engineer | Node.js, APIs, PostgreSQL",
        "location": "Petaling Jaya, Malaysia",
        "about": "Backend engineer with practical experience designing Node.js services, SQL schemas, and queue-backed workflows.",
        "skills": ["Node.js", "PostgreSQL", "Supabase", "REST APIs", "Docker", "Observability"],
        "experiences": [
            {
                "title": "Backend Engineer",
                "company": "Orbit Systems",
                "duration": "2021 - Present",
                "description": "Designed service endpoints, database migrations, and background workers for SaaS workflows.",
            }
        ],
        "education": [{"school": "Asia Pacific University", "degree": "Software Engineering", "duration": "2017 - 2021"}],
        "source_url": "https://www.linkedin.com/in/daniel-lim-demo",
    },
    {
        "name": "Aisha Rahman",
        "email": "aisha.rahman.demo@example.com",
        "headline": "Full-Stack Product Engineer",
        "location": "Cyberjaya, Malaysia",
        "about": "Full-stack engineer who ships product features across React, FastAPI, PostgreSQL, and deployment pipelines.",
        "skills": ["React", "FastAPI", "Python", "PostgreSQL", "TypeScript", "CI/CD"],
        "experiences": [
            {
                "title": "Full-Stack Engineer",
                "company": "BrightApps",
                "duration": "2020 - Present",
                "description": "Delivered frontend features, API endpoints, dashboard reporting, and release automation.",
            }
        ],
        "education": [{"school": "Taylor's University", "degree": "Computer Science", "duration": "2016 - 2020"}],
        "source_url": "https://www.linkedin.com/in/aisha-rahman-demo",
    },
]


def _future_window() -> tuple[str, str]:
    now = datetime.now().replace(second=0, microsecond=0)
    end = now + timedelta(days=30)
    return now.isoformat(timespec="minutes"), end.isoformat(timespec="minutes")


def demo_job_payload(job_id: int = DEMO_POSITION_ID, **overrides: Any) -> Dict[str, Any]:
    open_time, end_time = _future_window()
    payload = {
        "id": job_id,
        "title": DEMO_JOB_TITLE,
        "department": DEMO_DEPARTMENT,
        "description": (
            "Build and maintain full-stack product features for 404Hire using React, "
            "TypeScript, API services, and Supabase-backed workflows. The role focuses "
            "on reliable user flows, clean data handling, and fast iteration for hiring teams."
        ),
        "requirements": [
            "React and TypeScript application development",
            "API integration with Node.js or Python services",
            "PostgreSQL or Supabase data modeling",
            "Testing, debugging, and production-minded delivery",
            "Clear communication of technical trade-offs",
        ],
        "active": True,
        "open_time": open_time,
        "end_time": end_time,
        "address": "Technology Park Malaysia, Kuala Lumpur",
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "sourcing_criteria": demo_job_context(),
        "intake_chat": [
            {
                "role": "agent",
                "content": "I prepared the Software Engineer demo role with editable requirements and sourcing criteria.",
            }
        ],
        "pillars": ["React", "API services", "Supabase/PostgreSQL"],
        "behavioral": ["Clear technical communication", "Practical ownership", "Collaborative delivery"],
        "boolean_queries": '("Software Engineer") AND ("React" OR "TypeScript") AND ("Node.js" OR "FastAPI" OR "Supabase")',
    }
    payload.update({key: value for key, value in overrides.items() if value not in (None, "", [])})
    payload["title"] = DEMO_JOB_TITLE
    payload["department"] = DEMO_DEPARTMENT
    payload["requirements"] = deepcopy(payload["requirements"])
    payload["sourcing_criteria"] = {**demo_job_context(), **(overrides.get("sourcing_criteria") or {})}
    return payload


def demo_job_context() -> Dict[str, Any]:
    return {
        "agent_summary": "Search for Software Engineer candidates with React, TypeScript, API, and Supabase/PostgreSQL evidence.",
        "generated_description": (
            "Build and maintain full-stack product features for 404Hire using React, "
            "TypeScript, API services, and Supabase-backed workflows. The role focuses "
            "on reliable user flows, clean data handling, and fast iteration for hiring teams."
        ),
        "generated_requirements": [
            "React and TypeScript application development",
            "API integration with Node.js or Python services",
            "PostgreSQL or Supabase data modeling",
            "Testing, debugging, and production-minded delivery",
            "Clear communication of technical trade-offs",
        ],
        "must_have_signals": ["React", "TypeScript", "API integration", "Supabase", "PostgreSQL"],
        "avoid_signals": ["No hands-on software delivery evidence"],
        "search_keywords": "React TypeScript Node.js FastAPI Supabase PostgreSQL Software Engineer",
        "role_family": "technical",
        "completeness_score": 100,
    }


DEMO_JOB_INTAKE_TURNS: List[Dict[str, str]] = [
    {
        "question": "What product work should this Software Engineer own in the demo role?",
        "prefill_answer": (
            "They should build and maintain full-stack product features for 404Hire, especially React screens, "
            "API integrations, and Supabase-backed hiring workflows."
        ),
    },
    {
        "question": "Which technical skills are must-haves for sourcing candidates?",
        "prefill_answer": (
            "React and TypeScript are required, plus API integration with Node.js or Python services, PostgreSQL "
            "or Supabase data modeling, testing, debugging, and clear technical communication."
        ),
    },
    {
        "question": "What sourcing signals should the LinkedIn search and screening flow prioritize?",
        "prefill_answer": (
            "Prioritize candidates with evidence of shipped full-stack features, reliable frontend state handling, "
            "database-aware workflow design, production-minded testing, and collaborative delivery."
        ),
    },
]


def demo_job_intake_response(chat_messages: List[Dict[str, str]] | None = None) -> Dict[str, Any]:
    manager_turns = [
        message
        for message in (chat_messages or [])
        if str(message.get("role") or "").lower() == "manager"
    ]
    context = demo_job_context()
    context["intake_turn"] = min(len(manager_turns), len(DEMO_JOB_INTAKE_TURNS))

    if len(manager_turns) >= len(DEMO_JOB_INTAKE_TURNS):
        return {
            "is_complete": True,
            "question": "",
            "prefill_answer": "",
            "context": context,
        }

    turn = DEMO_JOB_INTAKE_TURNS[len(manager_turns)]
    context["completeness_score"] = [35, 70, 90][len(manager_turns)]
    return {
        "is_complete": False,
        "question": turn["question"],
        "prefill_answer": turn["prefill_answer"],
        "context": context,
    }


def demo_profile_data(name: str | None = None) -> Dict[str, Any]:
    profile = deepcopy(DEMO_PROFILE_DATA)
    if name and name.strip():
        profile["name"] = DEMO_PROFILE_DATA["name"]
    return profile


def demo_neutralize_text(text: Any) -> Any:
    if not isinstance(text, str):
        return text
    result = text
    for original, replacement in DEMO_NEUTRAL_ENTITY_LABELS.items():
        result = re.sub(re.escape(original), replacement, result, flags=re.IGNORECASE)
    return result


def demo_neutralized_profile(profile_data: Dict[str, Any]) -> Dict[str, Any]:
    profile = deepcopy(profile_data or {})
    for key in ("came_from", "about", "work_experience", "qualification", "grade_results"):
        profile[key] = demo_neutralize_text(profile.get(key, ""))
    profile["awards"] = [demo_neutralize_text(award) for award in profile.get("awards", [])]
    profile["experiences"] = [
        {
            **experience,
            "company": demo_neutralize_text(experience.get("company", "")),
            "description": demo_neutralize_text(experience.get("description", "")),
        }
        for experience in profile.get("experiences", [])
    ]
    profile["education"] = [
        {
            **education,
            "school": demo_neutralize_text(education.get("school", "")),
        }
        for education in profile.get("education", [])
    ]
    return profile


def demo_neutralized_profile_data(name: str | None = None) -> Dict[str, Any]:
    return demo_neutralized_profile(demo_profile_data(name))


def demo_bias_artifacts() -> Dict[str, Any]:
    return {
        "bias_analysis": deepcopy(DEMO_BIAS_ANALYSIS),
        "neutralized_profile_data": demo_neutralized_profile_data(),
    }


def demo_match_results() -> Dict[str, Any]:
    return deepcopy(DEMO_MATCH_RESULTS)


def demo_questions() -> List[str]:
    return list(DEMO_INTERVIEW_QUESTIONS)


def demo_answers() -> List[str]:
    return list(DEMO_INTERVIEW_ANSWERS)


def demo_evaluation() -> Dict[str, Any]:
    return deepcopy(DEMO_EVALUATION)


def demo_resume_summary() -> str:
    return DEMO_RESUME_SUMMARY


def is_demo_resume_filename(filename: str | None) -> bool:
    normalized = re.sub(r"\s+", " ", (filename or "").strip().lower())
    return bool(re.match(r"^resume eng(?: \(\d+\))?\.pdf$", normalized))


def demo_linkedin_profiles(count: int) -> List[Dict[str, Any]]:
    count = max(1, min(count, len(DEMO_LINKEDIN_PROFILES)))
    return [deepcopy(profile) for profile in DEMO_LINKEDIN_PROFILES[:count]]


def demo_outreach_for(profile_data: Dict[str, Any]) -> Dict[str, str]:
    name = profile_data.get("name", "Candidate")
    return {
        "sourcing_pitch": (
            f"{name} shows realistic Software Engineer evidence across frontend, backend, "
            "database, and delivery skills for the demo role."
        ),
        "outreach_email": (
            "Subject: Invitation to interview for Software Engineer\n\n"
            f"Dear {name},\n\n"
            "Your profile shows strong alignment with our Software Engineer role, "
            "especially around React, API delivery, and product-minded engineering. "
            "We would like to invite you to continue through the candidate portal.\n\n"
            "Best regards,\n404Hire Hiring Team"
        ),
    }


def demo_sourced_candidate(
    profile_data: Dict[str, Any],
    position_id: int,
    rank: int = 0,
    status: str = "staged",
) -> Dict[str, Any]:
    match = demo_match_results()
    score_floor = [95, 93, 91][min(rank, 2)]
    match["scores"]["overall_position_fit"] = score_floor
    match["scores"]["technical"] = max(score_floor, match["scores"]["technical"] - rank * 4)
    match["position_fit_summary"] = (
        f"{profile_data.get('name', 'Candidate')} is a realistic demo LinkedIn search result "
        "for the Software Engineer role with evidence across product engineering skills."
    )
    outreach = demo_outreach_for(profile_data)
    return {
        "name": profile_data["name"],
        "email": profile_data["email"],
        "status": status,
        "position_id": position_id,
        "is_sourced": True,
        "source_type": "linkedin",
        "source_method": "demo_linkedin_search",
        "linkedin_url": profile_data.get("source_url", ""),
        "profile_data": {
            **deepcopy(profile_data),
            "scrape_status": "demo_hardcoded",
            "scrape_warning": "Demo-only hardcoded LinkedIn result. No external search was performed.",
            "source_type": "linkedin",
            "source_method": "demo_linkedin_search",
        },
        "bias_analysis": deepcopy(DEMO_BIAS_ANALYSIS),
        "neutralized_profile_data": demo_neutralized_profile(profile_data),
        "sourcing_pitch": outreach["sourcing_pitch"],
        "outreach_email": outreach["outreach_email"],
        "match_results": match,
        "custom_questions": demo_questions(),
        "answers": [],
        "evaluation": {},
        "notifications": [],
        "outreach_history": [],
    }
