"""Pydantic models for the WebSocket wire protocol."""
from typing import Literal, Union

from pydantic import BaseModel


Language = Literal["en", "es"]


class ConfigMessage(BaseModel):
    type: Literal["config"]
    language: Language


class AudioChunkMessage(BaseModel):
    type: Literal["audio_chunk"]
    data: str
    sequence: int = 0


class UserTextMessage(BaseModel):
    type: Literal["user_text"]
    text: str


class ScreenshotMessage(BaseModel):
    type: Literal["screenshot"]
    data: str


class InterruptMessage(BaseModel):
    type: Literal["interrupt"]


class LanguageChangeMessage(BaseModel):
    type: Literal["language_change"]
    language: Language


class EndSessionMessage(BaseModel):
    type: Literal["end_session"]


ClientMessage = Union[
    ConfigMessage,
    AudioChunkMessage,
    UserTextMessage,
    ScreenshotMessage,
    InterruptMessage,
    LanguageChangeMessage,
    EndSessionMessage,
]

_CLIENT_BY_TYPE = {
    "config": ConfigMessage,
    "audio_chunk": AudioChunkMessage,
    "user_text": UserTextMessage,
    "screenshot": ScreenshotMessage,
    "interrupt": InterruptMessage,
    "language_change": LanguageChangeMessage,
    "end_session": EndSessionMessage,
}


def parse_client_message(raw: dict) -> ClientMessage:
    msg_type = raw.get("type")
    if not msg_type:
        raise ValueError("missing 'type' field")
    cls = _CLIENT_BY_TYPE.get(msg_type)
    if not cls:
        raise ValueError(f"unknown message type: {msg_type}")
    return cls.model_validate(raw)


# --- Server -> Client outgoing message helpers ---


def status_msg(state: Literal["idle", "listening", "thinking", "speaking"]) -> dict:
    return {"type": "status", "state": state}


def transcript_msg(text: str, final: bool) -> dict:
    return {"type": "transcript", "text": text, "final": final}


def daisy_text_msg(text: str, partial: bool) -> dict:
    return {"type": "daisy_text", "text": text, "partial": partial}


def audio_chunk_msg(b64_pcm: str, sequence: int) -> dict:
    return {"type": "audio_chunk", "data": b64_pcm, "sequence": sequence}


def audio_end_msg() -> dict:
    return {"type": "audio_end"}


def screenshot_request_msg(reason: str) -> dict:
    return {"type": "screenshot_request", "reason": reason}


def error_msg(code: str, message: str) -> dict:
    return {"type": "error", "code": code, "message": message}
