"""End-to-end tests for the click indicator flow in _run_turn.

These call _run_turn directly with a mocked WebSocket and monkeypatched
LLM/TTS/locator collaborators. asyncio.run is used so we don't add a
pytest-asyncio dependency.
"""
import asyncio
import re
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

import backend.main as main_mod
from backend.main import _CLICK_INTENT_RE, _run_turn
from backend.pipeline.locator import ClickTarget
from backend.session import Session


def _fake_png(width=1920, height=1080) -> bytes:
    return (
        b"\x89PNG\r\n\x1a\n"
        + b"\x00\x00\x00\x0d"
        + b"IHDR"
        + width.to_bytes(4, "big")
        + height.to_bytes(4, "big")
    )


def _stub_collaborators(monkeypatch, *, daisy_text: str, audio_chunks: int = 1):
    """Replace stream_response and stream_tts on backend.main with simple async generators."""
    async def fake_llm(history, text, image_bytes, language):
        yield daisy_text

    async def fake_tts(text_stream, language):
        # Drain the text stream
        async for _ in text_stream:
            pass
        for i in range(audio_chunks):
            yield b"\x00\x00"

    monkeypatch.setattr(main_mod, "stream_response", fake_llm)
    monkeypatch.setattr(main_mod, "stream_tts", fake_tts)


def _frame_types(ws_mock):
    return [call.args[0]["type"] for call in ws_mock.send_json.call_args_list]


def _frames_of_type(ws_mock, msg_type):
    return [call.args[0] for call in ws_mock.send_json.call_args_list if call.args[0]["type"] == msg_type]


# --- click-intent regex ---

@pytest.mark.parametrize("text", [
    "Click the Join button.",
    "Please tap the icon.",
    "Press OK to continue.",
    "Select your account.",
    "Open the email from Dr. Smith.",
    "Hit Enter when ready.",
    "Choose Spanish.",
])
def test_click_intent_regex_matches_english(text):
    assert _CLICK_INTENT_RE.search(text)


@pytest.mark.parametrize("text", [
    "Haz clic en el botón Unirse.",
    "Presiona Aceptar.",
    "Toca el icono.",
    "Selecciona tu cuenta.",
    "Abre el correo de la doctora.",
    "Elige español.",
    "Pulsa Entrar.",
])
def test_click_intent_regex_matches_spanish(text):
    assert _CLICK_INTENT_RE.search(text)


@pytest.mark.parametrize("text", [
    "I see your email is open.",
    "The window closed by itself.",
    "Veo que tu correo está abierto.",
    "La ventana se cerró sola.",
])
def test_click_intent_regex_does_not_match_observational(text):
    assert _CLICK_INTENT_RE.search(text) is None


# --- _run_turn flow ---

def test_clear_indicator_emitted_first_on_every_turn(monkeypatch):
    _stub_collaborators(monkeypatch, daisy_text="hello there")
    session = Session(session_id=uuid4())
    ws = AsyncMock()

    asyncio.run(_run_turn(ws, session, utterance_audio=None, user_text="hi"))

    types = _frame_types(ws)
    assert types[0] == "clear_indicator", f"expected clear_indicator first, got {types}"


def test_indicator_fires_when_screenshot_and_click_intent(monkeypatch):
    _stub_collaborators(monkeypatch, daisy_text="Click the blue Join button.")
    session = Session(session_id=uuid4())
    session.set_screenshot(_fake_png(1920, 1080))
    ws = AsyncMock()

    fake_target = ClickTarget(x=842, y=537, ref_width=1920, ref_height=1080, label="Join button")
    fake_locate = AsyncMock(return_value=fake_target)
    monkeypatch.setattr(main_mod, "locate_click_target", fake_locate)

    asyncio.run(_run_turn(ws, session, utterance_audio=None, user_text="where do I click?"))

    # Indicator task may still be running after _run_turn returns; await it.
    if session.current_indicator_task is not None:
        asyncio.run(asyncio.wait_for(session.current_indicator_task, timeout=2.0))

    indicators = _frames_of_type(ws, "click_indicator")
    assert len(indicators) == 1
    assert indicators[0] == {
        "type": "click_indicator",
        "x": 842, "y": 537,
        "ref_width": 1920, "ref_height": 1080,
        "label": "Join button",
        "confidence": None,
    }
    fake_locate.assert_awaited_once()


def test_no_indicator_when_no_screenshot(monkeypatch):
    _stub_collaborators(monkeypatch, daisy_text="Click the blue Join button.")
    session = Session(session_id=uuid4())  # no screenshot set
    ws = AsyncMock()

    fake_locate = AsyncMock()
    monkeypatch.setattr(main_mod, "locate_click_target", fake_locate)

    asyncio.run(_run_turn(ws, session, utterance_audio=None, user_text="hi"))

    assert session.current_indicator_task is None
    fake_locate.assert_not_called()
    assert _frames_of_type(ws, "click_indicator") == []


def test_no_indicator_when_no_click_intent(monkeypatch):
    _stub_collaborators(monkeypatch, daisy_text="I see your email is already open.")
    session = Session(session_id=uuid4())
    session.set_screenshot(_fake_png(1920, 1080))
    ws = AsyncMock()

    fake_locate = AsyncMock()
    monkeypatch.setattr(main_mod, "locate_click_target", fake_locate)

    asyncio.run(_run_turn(ws, session, utterance_audio=None, user_text="hi"))

    assert session.current_indicator_task is None
    fake_locate.assert_not_called()
    assert _frames_of_type(ws, "click_indicator") == []


def test_locator_failure_degrades_silently(monkeypatch):
    _stub_collaborators(monkeypatch, daisy_text="Click the Join button.")
    session = Session(session_id=uuid4())
    session.set_screenshot(_fake_png(1920, 1080))
    ws = AsyncMock()

    failing_locate = AsyncMock(side_effect=RuntimeError("boom"))
    monkeypatch.setattr(main_mod, "locate_click_target", failing_locate)

    asyncio.run(_run_turn(ws, session, utterance_audio=None, user_text="hi"))

    if session.current_indicator_task is not None:
        # Should complete without raising despite the exception inside.
        asyncio.run(asyncio.wait_for(session.current_indicator_task, timeout=2.0))

    # No click_indicator and no error frame for the locator failure.
    assert _frames_of_type(ws, "click_indicator") == []
    error_frames = _frames_of_type(ws, "error")
    assert all("locat" not in (f.get("message") or "").lower() for f in error_frames)


def test_locator_returns_none_no_indicator(monkeypatch):
    _stub_collaborators(monkeypatch, daisy_text="Click the Join button.")
    session = Session(session_id=uuid4())
    session.set_screenshot(_fake_png(1920, 1080))
    ws = AsyncMock()

    monkeypatch.setattr(main_mod, "locate_click_target", AsyncMock(return_value=None))

    asyncio.run(_run_turn(ws, session, utterance_audio=None, user_text="hi"))

    if session.current_indicator_task is not None:
        asyncio.run(asyncio.wait_for(session.current_indicator_task, timeout=2.0))

    assert _frames_of_type(ws, "click_indicator") == []
