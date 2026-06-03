from app.services.agents import bias_agent


def test_openalex_provider_returns_live_evidence_without_invented_rank(monkeypatch):
    monkeypatch.setattr(bias_agent.settings, "RANKING_PROVIDER", "openalex")
    monkeypatch.setattr(bias_agent.settings, "RANKING_API_URL", "")
    monkeypatch.setattr(bias_agent.settings, "OPENALEX_EMAIL", "")

    def fake_fetch_json_url(url, api_key=""):
        assert "api.openalex.org/institutions" in url
        return {
            "results": [
                {
                    "id": "https://openalex.org/I123",
                    "display_name": "Asia Pacific University",
                    "ids": {"ror": "https://ror.org/example"},
                    "geo": {"country_code": "MY"},
                    "works_count": 1200,
                    "cited_by_count": 5400,
                    "summary_stats": {
                        "h_index": 45,
                        "i10_index": 300,
                        "2yr_mean_citedness": 2.1,
                    },
                }
            ]
        }

    monkeypatch.setattr(bias_agent, "_fetch_json_url", fake_fetch_json_url)
    monkeypatch.setattr(bias_agent, "_cache_ranking_result", lambda result: None)

    result = bias_agent.fetch_university_ranking("Asia Pacific University")

    assert result["ranking_status"] == "live_openalex"
    assert result["ranking_source"] == "OpenAlex"
    assert result["rank_value"] is None
    assert result["payload"]["h_index"] == 45
    assert "No official QS/THE rank value" in result["reason"]
