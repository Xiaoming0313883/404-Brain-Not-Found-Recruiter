from app.services.agents.resume_agent import PROFILE_REQUIRED_KEYS, parse_resume_text_fallback


def test_resume_parser_returns_required_profile_keys():
    profile = parse_resume_text_fallback(
        """
        Jane Tan
        jane.tan@example.com
        +60 12-345 6789
        Kuala Lumpur, Malaysia
        Software Developer
        Skills: Python, FastAPI, React
        Bachelor of Computer Science, APU, 2024
        CGPA 3.72
        Dean's List Award
        """
    )

    for key in PROFILE_REQUIRED_KEYS:
        assert key in profile
    assert profile["email"] == "jane.tan@example.com"
    assert isinstance(profile["skills"], list)
    assert isinstance(profile["experiences"], list)
    assert isinstance(profile["education"], list)
