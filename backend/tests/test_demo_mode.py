import io
import json
from types import SimpleNamespace

import pytest
from fastapi import UploadFile

from app import database
from app.demo_fixtures import (
    DEMO_DEPARTMENT,
    DEMO_JOB_TITLE,
    demo_answers,
    demo_job_payload,
    demo_neutralized_profile_data,
    demo_profile_data,
    demo_questions,
)
from app.routes import candidates, jobs, settings as settings_routes


class FakeQuery:
    def __init__(self, client, table_name):
        self.client = client
        self.table_name = table_name
        self.operation = ""

    def select(self, *_args, **_kwargs):
        self.operation = "select"
        return self

    def limit(self, *_args, **_kwargs):
        return self

    def delete(self):
        self.operation = "delete"
        return self

    def neq(self, *_args, **_kwargs):
        return self

    def execute(self):
        self.client.calls.append((self.table_name, self.operation))
        if self.table_name in self.client.missing_tables:
            raise Exception("{'message': \"Could not find the table 'public.email_drafts' in the schema cache\", 'code': 'PGRST205'}")
        rows = list(self.client.rows.get(self.table_name, []))
        if self.operation == "delete":
            self.client.rows[self.table_name] = []
        return SimpleNamespace(data=rows)


class FakeSupabaseClient:
    def __init__(self, rows, missing_tables=None):
        self.rows = rows
        self.missing_tables = set(missing_tables or [])
        self.calls = []

    def table(self, table_name):
        return FakeQuery(self, table_name)


def parse_sse(text):
    payloads = []
    for frame in text.split("\n\n"):
        data = "\n".join(
            line.replace("data:", "", 1).strip()
            for line in frame.splitlines()
            if line.startswith("data:")
        )
        if data:
            payloads.append(json.loads(data))
    return payloads


async def collect_stream(response):
    body = ""
    async for chunk in response.body_iterator:
        body += chunk.decode() if isinstance(chunk, bytes) else chunk
    return body


def in_memory_db():
    email = "alyssa.tan@example.com"
    return {
        "positions": {"1": demo_job_payload()},
        "candidates": {
            email: {
                "name": "Goh Sheng Kai",
                "email": email,
                "status": "profile",
                "position_id": None,
                "profile_data": demo_profile_data(),
                "email_verified": True,
                "profile_verified": True,
                "applications": [],
                "notifications": [],
                "outreach_history": [],
            }
        },
        "pending_email_verifications": {},
        "settings": {},
    }


def block_live_calls(monkeypatch):
    def fail(*_args, **_kwargs):
        raise AssertionError("live AI/API call should not run in demo mode")

    monkeypatch.setattr(candidates, "run_agent_graph", fail)
    monkeypatch.setattr(candidates, "get_openai_client", fail)
    monkeypatch.setattr(candidates, "record_agent_event", lambda event: event)
    monkeypatch.setattr(candidates.time, "sleep", lambda _seconds: None)

    class FailGraph:
        def stream(self, *_args, **_kwargs):
            fail()

        def _initial_state(self, *_args, **_kwargs):
            fail()

    monkeypatch.setattr(candidates, "recruiting_agent_graph", FailGraph())


def test_init_db_validates_supabase_without_seeding_default_position(monkeypatch):
    client = FakeSupabaseClient({"positions": []})
    monkeypatch.setattr(database, "get_supabase_client", lambda: client)

    database.init_db()

    assert client.calls == [("positions", "select")]


def test_reset_demo_data_deletes_all_demo_tables(monkeypatch):
    tables = [
        "email_drafts",
        "email_events",
        "agent_actions",
        "agent_checkpoints",
        "agent_events",
        "applications",
        "candidates",
        "positions",
        "pending_email_verifications",
        "settings",
        "institution_ranking_cache",
    ]
    client = FakeSupabaseClient({table: [{"id": f"{table}-row"}] for table in tables})
    client.rows["candidates"] = [{"email": "alyssa.tan@example.com"}]
    client.rows["settings"] = [{"key": "bias_controls"}]
    client.rows["institution_ranking_cache"] = [{"institution_name": "Demo University"}]
    monkeypatch.setattr(database, "get_supabase_client", lambda: client)

    deleted = database.reset_demo_data()

    assert set(deleted) == set(tables)
    assert all(count == 1 for count in deleted.values())
    assert all(client.rows[table] == [] for table in tables)


def test_reset_demo_data_skips_missing_optional_tables(monkeypatch):
    rows = {
        "email_events": [{"id": "email-event"}],
        "agent_actions": [{"id": "agent-action"}],
        "agent_checkpoints": [{"id": "agent-checkpoint"}],
        "agent_events": [{"id": "agent-event"}],
        "applications": [{"id": "application"}],
        "candidates": [{"email": "alyssa.tan@example.com"}],
        "positions": [{"id": 1}],
        "pending_email_verifications": [{"email": "alyssa.tan@example.com"}],
        "settings": [{"key": "bias_controls"}],
        "institution_ranking_cache": [{"institution_name": "Demo University"}],
    }
    client = FakeSupabaseClient(rows, missing_tables={"email_drafts"})
    monkeypatch.setattr(database, "get_supabase_client", lambda: client)

    deleted = database.reset_demo_data()

    assert deleted["email_drafts"] == 0
    assert deleted["positions"] == 1
    assert rows["positions"] == []


def test_demo_job_intake_and_create_use_software_engineer_fixture(monkeypatch):
    db = {"positions": {}, "candidates": {}, "settings": {}}
    monkeypatch.setattr(jobs, "load_db", lambda: db)
    monkeypatch.setattr(jobs, "save_db", lambda next_db: db.update(next_db))

    intake_1 = jobs.get_next_intake_turn(
        jobs.JobIntakePayload(title="Anything", department="Anything", chat_messages=[])
    )
    intake_2 = jobs.get_next_intake_turn(
        jobs.JobIntakePayload(
            title="Anything",
            department="Anything",
            chat_messages=[
                {"role": "agent", "content": intake_1["question"]},
                {"role": "manager", "content": intake_1["prefill_answer"]},
            ],
        )
    )
    intake_done = jobs.get_next_intake_turn(
        jobs.JobIntakePayload(
            title="Anything",
            department="Anything",
            chat_messages=[
                {"role": "agent", "content": intake_1["question"]},
                {"role": "manager", "content": intake_1["prefill_answer"]},
                {"role": "agent", "content": intake_2["question"]},
                {"role": "manager", "content": intake_2["prefill_answer"]},
                {"role": "agent", "content": "What sourcing signals should the LinkedIn search and screening flow prioritize?"},
                {"role": "manager", "content": "Prioritize shipped full-stack features and reliable delivery."},
            ],
        )
    )
    created = jobs.create_job(
        jobs.JobCreate(title="Anything", department="Anything", open_time="2026-01-01T09:00", end_time="2026-12-31T17:00")
    )

    assert intake_1["is_complete"] is False
    assert intake_1["prefill_answer"]
    assert intake_2["is_complete"] is False
    assert intake_done["is_complete"] is True
    assert created["title"] == DEMO_JOB_TITLE
    assert created["department"] == DEMO_DEPARTMENT
    assert list(db["positions"]) == ["1"]


def test_demo_bias_controls_update_without_reapplying_agent_scoring(monkeypatch):
    db = {"positions": {}, "candidates": {}, "settings": {}}
    monkeypatch.setattr(settings_routes, "load_db", lambda: db)
    monkeypatch.setattr(settings_routes, "save_db", lambda next_db: db.update(next_db))
    monkeypatch.setattr(
        settings_routes,
        "reapply_bias_scoring",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("reapply should not run in demo mode")),
    )

    controls = settings_routes.patch_bias_controls(
        settings_routes.BiasControlsPayload(scoring_mode="prestige_aware", prestige_weight=45)
    )

    assert controls["scoring_mode"] == "prestige_aware"
    assert controls["prestige_weight"] == 45
    assert db["settings"]["bias_controls"] == controls


def test_demo_neutralized_profile_hides_school_and_company_names():
    profile = demo_neutralized_profile_data()
    flattened = json.dumps(profile)

    assert profile["education"][0]["school"] == "Public university"
    assert profile["education"][1]["school"] == "Public matriculation college"
    assert profile["experiences"][0]["company"] == "Public matriculation college"
    assert profile["experiences"][2]["company"] == "Secondary school"
    assert "Universiti Teknologi Malaysia" not in flattened
    assert "Selangor Matriculation College" not in flattened
    assert "SMK Pasir Panjang" not in flattened
    assert "SJKC Chung Hwa Telok Kemang" not in flattened


@pytest.mark.asyncio
async def test_demo_resume_signup_uses_fixture_without_ai(monkeypatch):
    block_live_calls(monkeypatch)

    db = {
        "positions": {},
        "candidates": {},
        "pending_email_verifications": {
            "alyssa.tan@example.com": {"verified": True}
        },
        "settings": {},
    }
    monkeypatch.setattr(candidates, "load_db", lambda: db)
    monkeypatch.setattr(candidates, "save_db", lambda next_db: db.update(next_db))
    monkeypatch.setattr(candidates, "save_resume_file", lambda *_args, **_kwargs: "demo-resume.pdf")

    async def no_sleep(_seconds):
        return None

    monkeypatch.setattr(candidates.asyncio, "sleep", no_sleep)
    resume = UploadFile(file=io.BytesIO(b"%PDF-1.4 demo resume bytes"), filename="Resume ENG (1).pdf")

    result = await candidates.signup_candidate(
        name="Demo Name",
        email="alyssa.tan@example.com",
        password="password123",
        resume=resume,
    )

    assert result["name"] == "Goh Sheng Kai"
    assert result["profile_data"]["headline"].startswith("Artificial Intelligence Undergraduate")
    assert result["profile_data"]["phone"] == "+60 10-8785050"
    assert result["profile_data"]["grade_results"] == "PNGK 4.0; SPM 9A 1B+"
    assert result["resume_summary"]


@pytest.mark.asyncio
async def test_demo_apply_and_sandbox_streams_return_fixtures(monkeypatch):
    block_live_calls(monkeypatch)

    db = in_memory_db()
    monkeypatch.setattr(candidates, "load_db", lambda: db)
    monkeypatch.setattr(candidates, "save_db", lambda next_db: db.update(next_db))

    apply_response = candidates.apply_candidate_to_position_stream(
        "alyssa.tan@example.com",
        candidates.CandidateApplyPositionPayload(position_id=1),
    )
    apply_payloads = parse_sse(await collect_stream(apply_response))
    apply_result = apply_payloads[-1]["result"]

    assert apply_result["custom_questions"] == demo_questions()
    assert apply_result["draft_answers"] == demo_answers()
    assert apply_result["match_results"]["scores"]["overall_position_fit"] == 96

    sandbox_response = candidates.submit_sandbox_stream(
        "alyssa.tan@example.com",
        candidates.SandboxAnswers(position_id=1, answers=demo_answers()),
    )
    sandbox_payloads = parse_sse(await collect_stream(sandbox_response))
    sandbox_result = sandbox_payloads[-1]["result"]

    assert sandbox_result["answers"] == demo_answers()
    assert sandbox_result["evaluation"]["screening_score"] == 96
    assert sandbox_result["evaluation"]["score_breakdown"]["role_requirement_alignment"] == 34
    assert "database and backend as the source of truth" in sandbox_result["evaluation"]["question_feedback"][1]["critique"]
    assert "React performance and maintainability problems" in sandbox_result["evaluation"]["question_feedback"][2]["critique"]
    assert sandbox_result["status"] == "screening"


@pytest.mark.asyncio
async def test_demo_linkedin_sourcing_returns_hardcoded_candidates(monkeypatch):
    block_live_calls(monkeypatch)

    db = in_memory_db()
    monkeypatch.setattr(candidates, "load_db", lambda: db)
    monkeypatch.setattr(candidates, "save_db", lambda next_db: db.update(next_db))

    scraped = candidates.scrape_profile(
        candidates.ScrapePayload(position_id=1, linkedin_url="https://www.linkedin.com/in/demo")
    )
    assert scraped["source_method"] == "demo_linkedin_search"
    assert scraped["profile_data"]["scrape_status"] == "demo_hardcoded"

    auto_response = candidates.auto_source_candidates(
        candidates.AutoSourcePayload(position_id=1, count=2)
    )
    auto_payloads = parse_sse(await collect_stream(auto_response))
    results = auto_payloads[-1]["result"]

    assert [candidate["source_method"] for candidate in results] == ["demo_linkedin_search", "demo_linkedin_search"]
    assert [candidate["name"] for candidate in results] == ["Maya Chen", "Daniel Lim"]
