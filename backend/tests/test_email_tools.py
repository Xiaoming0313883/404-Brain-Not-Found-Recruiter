from app.services.agents import guardrails as guardrails_module
from app.services.agents import tools as tools_module
from app.services.agents.guardrails import AUTONOMOUS_EMAIL_NOTE


def test_email_planner_creates_candidate_facing_invite(monkeypatch):
    monkeypatch.setattr(tools_module, "record_agent_action", lambda payload: payload)
    monkeypatch.setattr(tools_module, "get_openai_client", lambda: None)
    monkeypatch.setattr(tools_module.settings, "AGENT_AUTONOMY_MODE", "bounded")

    plan = tools_module.plan_candidate_email(
        {
            "candidate_email": "candidate@example.com",
            "to_email": "candidate@example.com",
            "job_requirements": {"title": "Backend Engineer"},
            "overall_position_fit": 90,
        },
        {
            "task_type": "sourced_candidate",
            "candidate_email": "candidate@example.com",
            "overall_position_fit": 90,
        },
    )

    assert plan["should_send"] is True
    assert plan["action_type"] == "invite"
    assert "Backend Engineer" in plan["subject"]
    assert "candidate@example.com" == plan["to_email"]


def test_agent_email_send_includes_autonomous_note(monkeypatch):
    captured = {}
    monkeypatch.setattr(tools_module, "record_agent_action", lambda payload: payload)
    monkeypatch.setattr(tools_module, "record_email_event", lambda payload: payload)
    monkeypatch.setattr(tools_module.settings, "AGENT_AUTONOMY_MODE", "bounded")
    monkeypatch.setattr(guardrails_module, "is_smtp_configured", lambda smtp_settings=None: True)

    def fake_send_recruitment_email(**kwargs):
        captured.update(kwargs)
        return True

    monkeypatch.setattr(tools_module, "send_recruitment_email", fake_send_recruitment_email)

    result = tools_module.send_agent_email(
        {
            "candidate_email": "candidate@example.com",
            "to_email": "candidate@example.com",
            "subject": "Invitation",
            "body": "Please continue your application.",
            "action_type": "invite",
            "overall_position_fit": 90,
        },
        {
            "task_type": "sourced_candidate",
            "candidate_email": "candidate@example.com",
            "overall_position_fit": 90,
        },
    )

    assert result["sent"] is True
    assert AUTONOMOUS_EMAIL_NOTE in result["body"]
    assert AUTONOMOUS_EMAIL_NOTE in captured["body"]
