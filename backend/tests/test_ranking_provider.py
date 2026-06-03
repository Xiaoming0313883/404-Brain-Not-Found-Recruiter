from app.services.agents import bias_agent


def test_qs_csv_ranking_lookup():
    # Test looking up Massachusetts Institute of Technology (MIT) from the CSV
    result = bias_agent.fetch_university_ranking("Massachusetts Institute of Technology (MIT)")
    assert result["ranking_status"] == "live"
    assert "QS World University Rankings" in result["ranking_source"]
    assert result["rank_value"] == 1
    assert result["payload"]["country"] == "United States of America"
    
    # Test case-insensitivity and substring matching
    result2 = bias_agent.fetch_university_ranking("Stanford University")
    assert result2["ranking_status"] == "live"
    assert result2["rank_value"] == 3
