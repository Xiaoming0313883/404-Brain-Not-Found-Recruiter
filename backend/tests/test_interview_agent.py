from app.services.agents import interview_agent
from app.services.agents.interview_agent import build_position_specific_evaluation, run_interview_agent_phase_b


def test_interview_fallback_returns_professional_per_question_feedback():
    questions = [
        "For the Backend Engineer position, describe a project where you used API design and database performance tuning?",
        "How would you handle failure and monitoring in a high-throughput service?",
        "What evidence shows you can deliver reliable backend systems?"
    ]
    answers = [
        "I built a FastAPI service, added SQL indexes, measured p95 latency, and reduced response time by 35% for users.",
        "I would add retries, circuit breakers, alerting, logs, and rollback plans after testing failure cases.",
        "In my project I deployed APIs, monitored errors, improved database queries, and documented trade-offs for the team."
    ]
    evaluation = build_position_specific_evaluation(
        questions,
        answers,
        {
            "title": "Backend Engineer",
            "requirements": ["API design", "database performance", "monitoring"],
            "pillars": ["Reliable systems"],
        },
    )

    assert evaluation["question_feedback"] == evaluation["critiques"]
    assert len(evaluation["question_feedback"]) == 3
    first = evaluation["question_feedback"][0]
    assert first["per_answer_score"] > 0
    assert first["strengths"]
    assert first["weaknesses"]
    assert first["suggested_improvement"]
    assert "hiring_manager_note" in first
    assert first["decision_reason"]
    assert evaluation["decision_reason"]


def test_interview_phase_b_provider_failure_returns_clean_rule_evaluation(monkeypatch, capsys):
    class FailingCompletions:
        def create(self, **kwargs):
            raise RuntimeError("provider unavailable")

    class FailingChat:
        completions = FailingCompletions()

    class FailingClient:
        chat = FailingChat()

    monkeypatch.setattr(interview_agent, "get_openai_client", lambda: FailingClient())

    evaluation = run_interview_agent_phase_b(
        ["Describe a backend API project that proves fit for this role?"],
        ["I built a FastAPI endpoint, tuned SQL queries, added tests, and reduced p95 latency by 30%."],
        {"title": "Backend Engineer", "requirements": ["API design", "SQL performance"]},
    )

    captured = capsys.readouterr()
    assert "Interview Agent unavailable" not in captured.out
    assert evaluation["screening_score"] > 0
    assert evaluation["question_feedback"] == evaluation["critiques"]
    assert evaluation["question_feedback"][0]["hiring_manager_note"]
    assert evaluation["agent_warnings"]
    assert "deterministic HR evaluator" in evaluation["decision_reason"]
