import pytest
from pydantic import ValidationError

from backend.messages import (
    parse_client_message,
    ConfigMessage,
    AudioChunkMessage,
    UserTextMessage,
    ScreenshotMessage,
    InterruptMessage,
    LanguageChangeMessage,
    EndSessionMessage,
)


def test_config_parses():
    m = parse_client_message({"type": "config", "language": "en"})
    assert isinstance(m, ConfigMessage)
    assert m.language == "en"


def test_config_rejects_bad_language():
    with pytest.raises(ValidationError):
        parse_client_message({"type": "config", "language": "fr"})


def test_audio_chunk_parses():
    m = parse_client_message({"type": "audio_chunk", "data": "aGVsbG8=", "sequence": 0})
    assert isinstance(m, AudioChunkMessage)
    assert m.sequence == 0


def test_user_text_parses():
    m = parse_client_message({"type": "user_text", "text": "hola"})
    assert isinstance(m, UserTextMessage)
    assert m.text == "hola"


def test_screenshot_parses():
    m = parse_client_message({"type": "screenshot", "data": "iVBORw0KGgo="})
    assert isinstance(m, ScreenshotMessage)


def test_interrupt_parses():
    m = parse_client_message({"type": "interrupt"})
    assert isinstance(m, InterruptMessage)


def test_language_change_parses():
    m = parse_client_message({"type": "language_change", "language": "es"})
    assert isinstance(m, LanguageChangeMessage)
    assert m.language == "es"


def test_end_session_parses():
    m = parse_client_message({"type": "end_session"})
    assert isinstance(m, EndSessionMessage)


def test_unknown_type_raises():
    with pytest.raises(ValueError):
        parse_client_message({"type": "blob"})


def test_missing_type_raises():
    with pytest.raises(ValueError):
        parse_client_message({"language": "en"})
