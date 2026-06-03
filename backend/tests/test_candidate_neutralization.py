from app.routes.candidates import serialize_neutralized_candidate


def test_school_company_neutralization_preserves_candidate_identity():
    candidate = {
        "name": "Jane Candidate",
        "email": "jane@example.com",
        "status": "applied",
        "linkedin_url": "https://www.linkedin.com/in/jane-candidate",
        "profile_data": {
            "name": "Jane Candidate",
            "email": "jane@example.com",
            "phone": "+60123456789",
            "address": "Kuala Lumpur",
            "location": "Kuala Lumpur",
            "headline": "Software Engineer at Acme Labs",
            "education": [
                {"school": "Prestige University", "degree": "Computer Science", "duration": "2020-2024"}
            ],
            "experiences": [
                {"title": "Engineer", "company": "Acme Labs", "duration": "2024", "description": "Built APIs."}
            ],
        },
        "bias_analysis": {
            "prestige_indicators": [
                {
                    "original": "Prestige University",
                    "neutral_category": "Education Provider",
                    "type": "university",
                },
                {
                    "original": "Acme Labs",
                    "neutral_category": "Previous Employer",
                    "type": "employer",
                },
            ],
            "prestige_score": 0,
        },
        "resume_text": "",
        "match_results": {
            "scores": {"overall_position_fit": 72},
            "position_fit_summary": "Jane used Acme Labs experience to build APIs.",
            "score_explanation": "Prestige University and Acme Labs were detected.",
            "debate": {
                "critical_recruiter_cons": ["Acme Labs scope is unclear."],
                "talent_advocate_pros": ["Prestige University CS foundation."],
            },
        },
        "applications": [],
    }

    result = serialize_neutralized_candidate(candidate, "jane@example.com")

    assert result["name"] == "Jane Candidate"
    assert result["email"] == "jane@example.com"
    assert result["linkedin_url"] == "https://www.linkedin.com/in/jane-candidate"
    assert result["profile_data"]["name"] == "Jane Candidate"
    assert result["profile_data"]["email"] == "jane@example.com"
    assert result["profile_data"]["phone"] == "+60123456789"
    assert result["profile_data"]["education"][0]["school"] == "Education Provider"
    assert result["profile_data"]["experiences"][0]["company"] == "Previous Employer"
    assert "Jane Candidate" not in {"Candidate #0000", "Anonymous City"}
    assert "Acme Labs" not in result["match_results"]["position_fit_summary"]
    assert "Prestige University" not in result["match_results"]["score_explanation"]
