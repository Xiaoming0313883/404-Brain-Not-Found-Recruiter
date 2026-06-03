from app.database import _dedupe_rows


def test_save_db_upsert_batches_are_deduped_latest_row_wins():
    rows = [
        {"email": "Candidate@Example.com", "payload": {"version": 1}},
        {"email": "candidate@example.com", "payload": {"version": 2}},
        {"email": "other@example.com", "payload": {"version": 1}},
    ]

    deduped = _dedupe_rows(rows, "email")

    assert len(deduped) == 2
    by_email = {row["email"].lower(): row for row in deduped}
    assert by_email["candidate@example.com"]["payload"]["version"] == 2
