from app.routes import candidates


def test_resume_upload_graph_enables_llm_resume_agent(monkeypatch):
    captured = {}

    def fake_run_agent_graph(task_type, payload):
        captured["task_type"] = task_type
        captured["payload"] = payload
        return {
            "artifacts": {
                "candidate_profile": {
                    "name": "Alex Resume",
                    "email": "alex@example.com",
                    "phone": "+60123456789",
                    "skills": ["Python"],
                    "experiences": [{"title": "Engineer", "company": "Acme", "duration": "2024", "description": "Built APIs."}],
                    "education": [],
                },
                "prestige_analysis": {"prestige_indicators": [], "prestige_score": 0},
            },
            "agent_warnings": [],
        }

    monkeypatch.setattr(candidates.settings, "RESUME_UPLOAD_USE_LLM", True)
    monkeypatch.setattr(candidates, "run_agent_graph", fake_run_agent_graph)

    candidates.run_resume_profile_upload_graph(
        "Alex Resume\nPython Engineer\nExperience\nBuilt APIs.",
        "alex@example.com",
        "Alex Resume",
    )

    assert captured["task_type"] == "resume_profile"
    assert captured["payload"]["input"]["resume_use_llm"] is True
