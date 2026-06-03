from app.services.agents.interview_agent import build_position_specific_evaluation


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
