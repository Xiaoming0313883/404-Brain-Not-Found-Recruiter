import pytest
from fastapi import HTTPException

from app.routes import candidates


def test_resume_checker_rejects_non_resume_when_llm_gate_flags_it(monkeypatch):
    non_resume_text = """
    Project Brief: Education Skills Experience Report
    This document describes a training program, the work plan, certification targets,
    project deliverables, university partnership goals, and skills required by learners.
    It is not written for one candidate and contains no personal career history.
    The report includes summary, profile, education, experience, skills, awards, and
    qualification sections as headings for a generic program template.
    """

    monkeypatch.setattr(candidates.settings, "RESUME_UPLOAD_USE_LLM", True)
    monkeypatch.setattr(candidates, "classify_resume_document", lambda text: {
        "is_resume": False,
        "confidence": 0.94,
        "reason": "This is a project brief, not a candidate resume.",
    })

    with pytest.raises(HTTPException) as exc_info:
        candidates.validate_resume_text_for_agent(non_resume_text)

    assert exc_info.value.status_code == 400
    assert "Resume checker warning" in exc_info.value.detail


def test_resume_checker_allows_resume_when_llm_gate_accepts(monkeypatch):
    resume_text = """
    Alex Resume
    alex@example.com +60123456789
    Professional Summary
    Software engineer with experience building APIs and production web systems.
    Skills
    Python, FastAPI, React, SQL
    Experience
    Backend Engineer at Acme Labs from 2023 to 2026. Built services, tested
    integrations, improved deployment reliability, and collaborated with product.
    Education
    Bachelor of Computer Science, Example University.
    Projects
    Resume parser, candidate portal, and analytics dashboard.
    """

    monkeypatch.setattr(candidates.settings, "RESUME_UPLOAD_USE_LLM", True)
    monkeypatch.setattr(candidates, "classify_resume_document", lambda text: {
        "is_resume": True,
        "confidence": 0.96,
        "reason": "This is a candidate resume.",
    })

    candidates.validate_resume_text_for_agent(resume_text)
