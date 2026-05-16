from datetime import datetime, timedelta
from uuid import uuid4

import pytest

from backend.session import Session, SessionStore


def test_session_starts_idle_english():
    s = Session(session_id=uuid4())
    assert s.language == "en"
    assert s.status == "idle"
    assert s.messages == []
    assert s.pending_screenshot is None


def test_session_set_language():
    s = Session(session_id=uuid4())
    s.set_language("es")
    assert s.language == "es"


def test_session_append_user_message():
    s = Session(session_id=uuid4())
    s.append_user("hello")
    assert s.messages == [{"role": "user", "content": "hello"}]


def test_session_append_assistant_message():
    s = Session(session_id=uuid4())
    s.append_assistant("hi there")
    assert s.messages == [{"role": "assistant", "content": "hi there"}]


def test_session_set_screenshot_then_consume():
    s = Session(session_id=uuid4())
    s.set_screenshot(b"PNGBYTES")
    assert s.pending_screenshot is not None
    assert s.has_fresh_screenshot()
    img = s.consume_screenshot()
    assert img == b"PNGBYTES"
    assert s.pending_screenshot is None
    assert s.consumed_screenshots == 1


def test_session_expired_screenshot_not_fresh():
    s = Session(session_id=uuid4())
    s.set_screenshot(b"PNGBYTES")
    # Force the timestamp to be old
    s.pending_screenshot = (b"PNGBYTES", datetime.utcnow() - timedelta(seconds=61))
    assert not s.has_fresh_screenshot()


def test_session_status_transitions():
    s = Session(session_id=uuid4())
    s.set_status("listening")
    s.set_status("thinking")
    s.set_status("speaking")
    s.set_status("idle")
    assert s.status == "idle"


def test_session_invalid_status_raises():
    s = Session(session_id=uuid4())
    with pytest.raises(ValueError):
        s.set_status("on_fire")  # not a valid state


def test_session_store_create_and_get():
    store = SessionStore()
    sid = uuid4()
    s = store.create(sid)
    assert store.get(sid) is s


def test_session_store_remove():
    store = SessionStore()
    sid = uuid4()
    store.create(sid)
    store.remove(sid)
    assert store.get(sid) is None


def test_session_store_remove_missing_is_noop():
    store = SessionStore()
    store.remove(uuid4())  # must not raise


def test_session_current_indicator_task_default_none():
    s = Session(session_id=uuid4())
    assert s.current_indicator_task is None
