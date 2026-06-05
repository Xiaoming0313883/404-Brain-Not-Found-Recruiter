from datetime import datetime, timezone

from app.services import job_windows


def test_naive_position_window_uses_app_timezone(monkeypatch):
    class FixedDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            railway_now = datetime(2026, 6, 5, 6, 0, tzinfo=timezone.utc)
            if tz:
                return railway_now.astimezone(tz)
            return railway_now.replace(tzinfo=None)

    monkeypatch.setattr(job_windows, "datetime", FixedDatetime)

    status = job_windows.get_position_window_status({
        "active": True,
        "open_time": "2026-06-05T13:00",
        "end_time": "2026-06-05T15:00",
    })

    assert status == "open"
