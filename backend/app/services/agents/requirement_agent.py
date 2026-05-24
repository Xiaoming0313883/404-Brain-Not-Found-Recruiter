import json
import re
from typing import Dict, Any, List
from app.config import settings
from .base_agent import get_openai_client, parse_llm_json

# B. EMPLOYER REQUIREMENT AGENT
# ==========================================
ROLE_CATALOG: Dict[str, Dict[str, Any]] = {
    "culinary": {
        "keywords": ["baker", "bakery", "pastry", "chef", "cook", "kitchen", "culinary", "cake", "bread", "barista"],
        "requirements": [
            "Hands-on experience preparing baked goods or food products in a commercial kitchen",
            "Knowledge of food safety, hygiene, storage, and kitchen cleanliness standards",
            "Ability to follow recipes, maintain consistent quality, and manage production timing",
            "Comfort working early shifts, standing for long periods, and handling kitchen equipment",
            "Attention to ingredient measurements, presentation, freshness, and customer expectations"
        ],
        "pillars": ["Baking Operations", "Food Safety", "Recipe Consistency"],
        "behavioral": ["Attention to Detail", "Time Management", "Clean Working Habits"],
        "boolean_terms": ["baker", "bakery", "pastry", "food safety", "kitchen"]
    },
    "sales": {
        "keywords": ["sales", "account executive", "business development", "bd", "retail associate"],
        "requirements": [
            "Experience managing customer conversations, objections, and follow-ups",
            "Ability to meet sales targets and maintain accurate pipeline or customer records",
            "Strong communication, product knowledge, and relationship-building skills"
        ],
        "pillars": ["Customer Conversations", "Sales Targets", "Pipeline Discipline"],
        "behavioral": ["Persuasion", "Resilience", "Follow-through"],
        "boolean_terms": ["sales", "account executive", "business development", "customer"]
    },
    "marketing": {
        "keywords": ["marketing", "content", "social media", "seo", "campaign", "brand"],
        "requirements": [
            "Experience planning and executing campaigns for a defined audience",
            "Ability to create, measure, and improve content or channel performance",
            "Understanding of brand voice, campaign metrics, and audience engagement"
        ],
        "pillars": ["Campaign Execution", "Content Quality", "Performance Metrics"],
        "behavioral": ["Creativity", "Audience Empathy", "Analytical Thinking"],
        "boolean_terms": ["marketing", "campaign", "content", "social media", "brand"]
    },
    "design": {
        "keywords": ["designer", "design", "ui", "ux", "product designer", "graphic"],
        "requirements": [
            "Experience creating user-centered designs, prototypes, or visual assets",
            "Ability to work with feedback, design systems, and clear visual hierarchy",
            "Portfolio evidence of polished, usable, and audience-appropriate design work"
        ],
        "pillars": ["User-Centered Design", "Visual Craft", "Design Systems"],
        "behavioral": ["Taste", "Iteration", "Cross-functional Collaboration"],
        "boolean_terms": ["designer", "ui", "ux", "figma", "portfolio"]
    },
    "technical": {
        "keywords": ["engineer", "developer", "software", "frontend", "backend", "full-stack", "devops", "data scientist", "analyst", "cloud", "ai", "machine learning"],
        "requirements": [
            "Hands-on experience with the core technologies named in the role intake",
            "Ability to solve role-relevant technical problems with sound trade-offs",
            "Evidence of shipping reliable systems, products, analyses, or tooling"
        ],
        "pillars": ["Role-Specific Technical Skills", "Problem Solving", "Delivery Quality"],
        "behavioral": ["Technical Judgment", "Collaboration", "Ownership"],
        "boolean_terms": ["software", "engineer", "developer", "technical"]
    },
    "general": {
        "keywords": [],
        "requirements": [
            "Relevant experience performing the core responsibilities of the position",
            "Ability to deliver the outcomes described by the hiring manager",
            "Clear evidence of reliability, communication, and practical problem solving"
        ],
        "pillars": ["Role-Specific Experience", "Reliable Delivery", "Communication"],
        "behavioral": ["Reliability", "Communication", "Practical Judgment"],
        "boolean_terms": []
    }
}

TECHNICAL_TERMS = {
    "react", "node", "node.js", "vite", "distributed systems", "cloud engineering",
    "kubernetes", "docker", "microservices", "api", "apis", "frontend", "backend",
    "software development", "system architecture", "devops", "aws", "azure", "gcp"
}

def infer_role_family(job_title: str, job_description: str = "") -> str:
    text = f"{job_title} {job_description}".lower()
    for family, config in ROLE_CATALOG.items():
        if family == "general":
            continue
        if any(keyword in text for keyword in config["keywords"]):
            return family
    return "general"

def is_requirement_compatible(requirement: str, role_family: str) -> bool:
    if role_family == "technical":
        return True
    text = requirement.lower()
    return not any(term in text for term in TECHNICAL_TERMS)

def dedupe_nonempty(values: List[str]) -> List[str]:
    results: List[str] = []
    seen = set()
    for value in values:
        cleaned = " ".join(str(value or "").split()).strip(" .")
        key = cleaned.lower()
        if cleaned and key not in seen:
            seen.add(key)
            results.append(cleaned)
    return results

def build_boolean_query(job_title: str, role_family: str, pillars: List[str]) -> str:
    terms = ROLE_CATALOG.get(role_family, ROLE_CATALOG["general"]).get("boolean_terms", [])
    search_terms = dedupe_nonempty([job_title, *terms, *pillars])[:6]
    if not search_terms:
        return f'("{job_title}")'
    if len(search_terms) == 1:
        return f'("{search_terms[0]}")'
    return f'("{search_terms[0]}") AND ("' + '" OR "'.join(search_terms[1:]) + '")'

def normalize_requirement_output(job_title: str, job_description: str, parsed: Dict[str, Any]) -> Dict[str, Any]:
    role_family = infer_role_family(job_title, job_description)
    catalog = ROLE_CATALOG.get(role_family, ROLE_CATALOG["general"])

    raw_requirements = parsed.get("requirements") if isinstance(parsed.get("requirements"), list) else []
    compatible_requirements = [
        requirement for requirement in dedupe_nonempty(raw_requirements)
        if is_requirement_compatible(requirement, role_family)
    ]
    requirements = dedupe_nonempty([*compatible_requirements, *catalog["requirements"]])[:6]

    raw_pillars = parsed.get("pillars") if isinstance(parsed.get("pillars"), list) else []
    compatible_pillars = [
        pillar for pillar in dedupe_nonempty(raw_pillars)
        if is_requirement_compatible(pillar, role_family)
    ]
    pillars = dedupe_nonempty([*compatible_pillars, *catalog["pillars"]])[:3]

    raw_behavioral = parsed.get("behavioral") if isinstance(parsed.get("behavioral"), list) else []
    behavioral = dedupe_nonempty([*raw_behavioral, *catalog["behavioral"]])[:3]

    description = parsed.get("job_description") or ""
    if not description or not is_requirement_compatible(description, role_family):
        description = (
            f"{job_title} role focused on {', '.join(pillars).lower()} and reliable day-to-day delivery."
            if role_family != "general"
            else f"{job_title} role focused on the outcomes described by the hiring manager."
        )

    boolean_query = parsed.get("boolean_queries") or ""
    if role_family != "technical" and not is_requirement_compatible(boolean_query, role_family):
        boolean_query = build_boolean_query(job_title, role_family, pillars)
    elif not boolean_query:
        boolean_query = build_boolean_query(job_title, role_family, pillars)

    return {
        "job_description": description,
        "requirements": requirements,
        "pillars": pillars,
        "behavioral": behavioral,
        "boolean_queries": boolean_query,
        "role_family": role_family
    }

def run_requirement_intake_agent(job_title: str, department: str, chat_messages: List[Dict[str, str]]) -> Dict[str, Any]:
    client = get_openai_client()
    system_prompt = """You are the Employer Requirement Agent inside a hiring-manager job builder.
Your job is to interview the hiring manager, one question at a time, until you have enough information to prefill a useful draft job description and draft requirements. The hiring manager may edit your draft before saving.

Rules:
- Do not use a fixed script.
- Ask the single most useful next question based on the position title, department, and previous answers.
- Avoid repeating questions that were already answered.
- Ask about missing context only: outcomes, seniority, problems solved, role depth, domain context, success evidence, disqualifiers, team constraints, or qualification expectations.
- When enough context exists, stop asking and return draft prefill values.
- Requirements must be logical for the actual position title and department. Do not add software, cloud, engineering, architecture, or coding requirements unless the role is explicitly technical.
- For trade, service, food, retail, operations, or hospitality roles, generate requirements about the real work environment, tools, safety, quality, customer, and schedule expectations.

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
    "generated_description": "Editable candidate-facing draft job description",
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
            parsed["question"] = clean_agent_question(parsed.get("question", ""))
            if parsed.get("is_complete"):
                context = parsed.get("context", {})
                normalized = normalize_requirement_output(
                    job_title,
                    f"{context.get('generated_description', '')}\n{json.dumps(context)}",
                    {
                        "job_description": context.get("generated_description", ""),
                        "requirements": context.get("generated_requirements", []),
                        "pillars": context.get("must_have_signals", []),
                        "behavioral": [],
                        "boolean_queries": ""
                    }
                )
                context["generated_description"] = normalized["job_description"]
                context["generated_requirements"] = normalized["requirements"]
                context["must_have_signals"] = normalized["requirements"][:3]
                context["role_family"] = normalized["role_family"]
                parsed["context"] = context
            return parsed
        except Exception as e:
            print(f"Requirement Intake Agent API error: {e}.")
            raise RuntimeError(f"Requirement Intake Agent API error: {e}")

    return build_fallback_intake_turn(job_title, department, chat_messages)

def clean_agent_question(value: str) -> str:
    question = str(value or "").strip().strip('"')
    question = re.sub(r"^(question|content|contents|agent|assistant)\s*[:\-]\s*", "", question, flags=re.IGNORECASE).strip()
    lines = [line.strip() for line in question.splitlines() if line.strip()]
    if len(lines) > 1:
        question_lines = [line for line in lines if "?" in line]
        question = question_lines[0] if question_lines else lines[0]
    if question and not question.endswith("?"):
        question = question.rstrip(".") + "?"
    return question

def build_fallback_intake_turn(job_title: str, department: str, chat_messages: List[Dict[str, str]]) -> Dict[str, Any]:
    manager_answers = [m.get("content", "").strip() for m in chat_messages if m.get("role") == "manager" and m.get("content")]
    combined = " ".join(manager_answers).lower()
    role = job_title or "this position"
    team = department or "this team"
    role_family = infer_role_family(role, team)

    if len(manager_answers) >= 4:
        description = (
            f"{role} will support the {team} team by delivering {manager_answers[0] if manager_answers else 'the outcomes described by the hiring manager'}. "
            f"The best candidates should show role-relevant experience, practical judgment, and evidence they can succeed in this environment."
        )
        requirements = extract_requirement_phrases(manager_answers, role, team)
        avoid_signals = extract_avoid_phrases(manager_answers)
        catalog = ROLE_CATALOG.get(role_family, ROLE_CATALOG["general"])
        return {
            "is_complete": True,
            "question": "",
            "context": {
                "agent_summary": f"Search for {role} candidates with evidence of {', '.join(requirements[:3]).lower()}.",
                "generated_description": description,
                "generated_requirements": requirements,
                "must_have_signals": requirements[:3],
                "avoid_signals": avoid_signals or ["Major mismatch with the stated role outcomes"],
                "role_family": role_family,
                "suggested_pillars": catalog["pillars"]
            }
        }

    question = generate_dynamic_question(role, team, role_family, combined, manager_answers, chat_messages)

    return {
        "is_complete": False,
        "question": question,
        "context": {
            "agent_summary": f"Requirement intake in progress for {role}.",
            "role_family": role_family
        }
    }

def generate_dynamic_question(
    role: str,
    team: str,
    role_family: str,
    combined: str,
    manager_answers: List[str],
    chat_messages: List[Dict[str, str]]
) -> str:
    """Generate the next interview question dynamically using the LLM, based on the
    position title and everything the hiring manager has said so far.  Falls back
    to a deterministic heuristic when the LLM is unavailable."""
    client = get_openai_client()
    if client:
        try:
            system_prompt = (
                "You are an expert recruiter conducting a structured intake interview with a hiring manager.\n"
                "Your task: ask the single most useful next question to gather information needed to build\n"
                "a good job description and candidate requirements for this specific role.\n\n"
                "Rules:\n"
                "- Base your question ENTIRELY on the position title and what the hiring manager has already said.\n"
                "- Do NOT use a fixed script or template questions.\n"
                "- Do NOT repeat anything that has already been answered.\n"
                "- Ask about the most important gap: outcomes, seniority, tools, environment, disqualifiers, etc.\n"
                "- Ask exactly ONE concise, specific question — no preamble, no explanation.\n"
                "- Tailor vocabulary and focus to the actual role (e.g. for a baker ask about kitchen/baking;\n"
                "  for a developer ask about tech stack; for a sales rep ask about pipeline/targets).\n\n"
                "Return ONLY the question text, nothing else."
            )
            conversation_so_far = "\n".join(
                f"{m.get('role', 'unknown').capitalize()}: {m.get('content', '')}"
                for m in chat_messages
                if m.get("content", "").strip()
            )
            user_payload = (
                f"Position title: {role}\n"
                f"Department: {team}\n"
                f"Role family: {role_family}\n\n"
                f"Conversation so far:\n{conversation_so_far or '(no messages yet)'}"
            )
            response = client.chat.completions.create(
                model=settings.OPENAI_MODEL,
                temperature=0.7,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_payload}
                ]
            )
            question = (response.choices[0].message.content or "").strip().strip('"')
            question = clean_agent_question(question)
            if question:
                return question
        except Exception as e:
            print(f"Dynamic question generation failed: {e}. Using heuristic fallback.")

    # --- Deterministic heuristic fallback (LLM unavailable) ---
    return _heuristic_question(role, team, role_family, combined, len(manager_answers))


def _heuristic_question(role: str, team: str, role_family: str, combined: str, answer_count: int) -> str:
    """Simple rule-based question chooser used only when the LLM cannot be reached."""
    role_specific_openers = {
        "culinary": f"For the {role} role, what products, stations, or kitchen duties will the person handle most often?",
        "sales": f"For the {role} role, what customers, sales motion, or targets will this person own?",
        "marketing": f"For the {role} role, what channels, campaigns, or audience outcomes matter most?",
        "design": f"For the {role} role, what design outputs or portfolio evidence should prove they can do the work?",
        "technical": f"For the {role} role, what systems, products, or technical problems will this person work on most?",
        "general": f"For the {role} role in {team}, what are the main responsibilities this person will own?"
    }
    if answer_count == 0:
        return role_specific_openers.get(role_family, role_specific_openers["general"])

    seniority_terms = ("junior", "entry", "mid", "senior", "lead", "manager", "supervisor", "intern")
    if not any(term in combined for term in seniority_terms):
        return f"What seniority level or previous responsibility level would make someone credible for this {role} position?"

    if role_family == "culinary":
        if not any(term in combined for term in ("hygiene", "safety", "halal", "storage", "clean", "fresh", "quality")):
            return f"What food safety, hygiene, quality, or freshness standards must a {role} candidate already understand?"
        if not any(term in combined for term in ("shift", "morning", "weekend", "standing", "schedule", "equipment", "oven")):
            return f"What shift schedule, physical demands, or kitchen equipment should candidates be comfortable with?"
    elif role_family == "sales":
        if not any(term in combined for term in ("target", "quota", "pipeline", "lead", "customer", "client")):
            return f"What customer type, pipeline responsibility, or sales target should this {role} candidate have handled before?"
    elif role_family == "marketing":
        if not any(term in combined for term in ("campaign", "content", "seo", "social", "analytics", "brand", "audience")):
            return f"What campaign, content, audience, or performance metrics should this {role} candidate know?"
    elif role_family == "design":
        if not any(term in combined for term in ("portfolio", "figma", "prototype", "wireframe", "visual", "user", "brand")):
            return f"What portfolio work or design tools should prove fit for this {role} role?"
    elif role_family == "technical":
        if not any(term in combined for term in ("react", "node", "python", "api", "database", "cloud", "testing", "system", "data")):
            return f"What specific technologies, systems, or technical responsibilities are essential for this {role} role?"

    if not any(term in combined for term in ("avoid", "concern", "red flag", "reject", "must not", "weak")):
        return f"What profile signals should the agent treat as concerns or disqualifiers for this {role} role?"

    return f"What would make you excited to interview a {role} candidate after reading their profile?"

def extract_requirement_phrases(answers: List[str], role: str, team: str) -> List[str]:
    source = " ".join(answers)
    role_family = infer_role_family(role, source)
    answer_chunks = [
        answer.strip(" .:-")
        for answer in answers
        if len(answer.strip().split()) >= 3
    ]
    chunks = [
        re.sub(r"^(and|or)\s+", "", chunk.strip(" .:-"), flags=re.IGNORECASE)
        for chunk in re.split(r"[.;\n]", source)
        if len(chunk.strip().split()) >= 3
    ]
    requirements = [
        chunk for chunk in dedupe_nonempty([*answer_chunks, *chunks])[:8]
        if is_requirement_compatible(chunk, role_family)
        and not re.search(r"\b(avoid|concern|red flag|reject|must not|cannot|can't|weak)\b", chunk, flags=re.IGNORECASE)
    ][:6]
    if len(requirements) < 3:
        requirements.extend(ROLE_CATALOG.get(role_family, ROLE_CATALOG["general"])["requirements"])
    return requirements[:6]

def extract_avoid_phrases(answers: List[str]) -> List[str]:
    avoid_terms = re.compile(r"\b(avoid|concern|red flag|reject|must not|cannot|can't|weak)\b", flags=re.IGNORECASE)
    return dedupe_nonempty([
        answer.strip(" .:-")
        for answer in answers
        if avoid_terms.search(answer)
    ])[:4]

def run_requirement_agent(job_title: str, job_description: str) -> Dict[str, Any]:
    client = get_openai_client()
    system_prompt = """You are a professional recruiting operations profiler.
Analyze the provided job description and title, and extract the exact skill requirements.

Tasks:
1. Generate a concise, candidate-facing job description from the hiring manager intake.
2. Extract 3-6 practical requirements that candidates should meet.
3. Extract 3-5 primary skill pillars. These may be technical, culinary, service, operations, design, sales, or other domain pillars depending on the actual role.
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

Important:
- Do not invent software/cloud/engineering requirements for non-technical roles.
- A baker role should produce baking, food safety, recipe consistency, kitchen timing, hygiene, freshness, or pastry-related requirements.
- A retail role should produce customer service, stock handling, POS, product knowledge, scheduling, or sales requirements.
- Only include React, Node.js, cloud, distributed systems, APIs, architecture, or coding terms when the position is explicitly technical.
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
            parsed = parse_llm_json(response.choices[0].message.content)
            return normalize_requirement_output(job_title, job_description, parsed)
        except Exception as e:
            print(f"Requirement Agent API error: {e}. Falling back to rule-based extractor.")

    # High-quality fallback
    words = job_description.lower()
    role_family = infer_role_family(job_title, job_description)
    catalog = ROLE_CATALOG.get(role_family, ROLE_CATALOG["general"])

    if role_family == "technical":
        pillars = []
        if "react" in words or "frontend" in words:
            pillars.append("React")
        if "node" in words or "backend" in words:
            pillars.append("Node.js")
        if "distributed" in words or "system" in words:
            pillars.append("Distributed Systems")
        if "cloud" in words or "aws" in words or "azure" in words:
            pillars.append("Cloud Engineering")
        pillars = dedupe_nonempty([*pillars, *catalog["pillars"]])[:3]
        requirements = [
            f"Hands-on experience with {pillar}" if pillar not in catalog["pillars"] else requirement
            for pillar, requirement in zip(pillars, catalog["requirements"] + catalog["requirements"])
        ]
    else:
        pillars = catalog["pillars"][:3]
        requirements = catalog["requirements"][:5]

    return normalize_requirement_output(job_title, job_description, {
        "job_description": f"{job_title} role focused on {', '.join(pillars[:3]).lower()} and practical delivery.",
        "requirements": requirements,
        "pillars": pillars,
        "behavioral": catalog["behavioral"],
        "boolean_queries": build_boolean_query(job_title, role_family, pillars)
    })

