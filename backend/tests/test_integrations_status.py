from types import SimpleNamespace

import app.routes.settings as settings_route


class FakeSupabaseQuery:
    def select(self, *_args, **_kwargs):
        return self

    def limit(self, *_args, **_kwargs):
        return self

    def execute(self):
        return SimpleNamespace(data=[{"id": 1}])


class FakeSupabaseClient:
    def table(self, _name):
        return FakeSupabaseQuery()


def test_integration_status_reports_all_connectors(monkeypatch):
    monkeypatch.setattr(settings_route, "get_openai_client", lambda: object())
    monkeypatch.setattr(settings_route, "get_supabase_client", lambda: FakeSupabaseClient())
    monkeypatch.setattr(settings_route, "is_smtp_configured", lambda: True)
    monkeypatch.setattr(settings_route.settings, "SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(settings_route.settings, "SUPABASE_SERVICE_ROLE_KEY", "service-key")
    monkeypatch.setattr(settings_route.settings, "APIFY_API_TOKEN", "apify-token")

    status = settings_route.read_integration_status()

    assert status["openai"]["configured"] is True
    assert status["supabase"]["connected"] is True
    assert status["apify_linkedin"]["configured"] is True
    assert status["smtp"]["configured"] is True
    assert status["agent_graph"]["autonomy_mode"] == settings_route.settings.AGENT_AUTONOMY_MODE
