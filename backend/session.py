"""Per-WS session state and in-memory store."""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Literal, Optional
from uuid import UUID

Language = Literal["en", "es"]
Status = Literal["idle", "listening", "thinking", "speaking"]

VALID_STATES = {"idle", "listening", "thinking", "speaking"}
SCREENSHOT_TTL = timedelta(seconds=60)


@dataclass
class Session:
    session_id: UUID
    language: Language = "en"
    messages: list[dict] = field(default_factory=list)
    pending_screenshot: Optional[tuple[bytes, datetime]] = None
    consumed_screenshots: int = 0
    status: Status = "idle"
    current_turn_task: Optional[asyncio.Task] = None

    def set_language(self, language: Language) -> None:
        self.language = language

    def append_user(self, text: str) -> None:
        self.messages.append({"role": "user", "content": text})

    def append_assistant(self, text: str) -> None:
        self.messages.append({"role": "assistant", "content": text})

    def set_screenshot(self, png_bytes: bytes) -> None:
        self.pending_screenshot = (png_bytes, datetime.utcnow())

    def has_fresh_screenshot(self) -> bool:
        if self.pending_screenshot is None:
            return False
        _, ts = self.pending_screenshot
        return datetime.utcnow() - ts <= SCREENSHOT_TTL

    def consume_screenshot(self) -> bytes:
        if self.pending_screenshot is None:
            raise RuntimeError("no pending screenshot to consume")
        img, _ = self.pending_screenshot
        self.pending_screenshot = None
        self.consumed_screenshots += 1
        return img

    def set_status(self, status: str) -> None:
        if status not in VALID_STATES:
            raise ValueError(f"invalid status: {status}")
        self.status = status  # type: ignore[assignment]


class SessionStore:
    """In-memory session store. Sessions live for the lifetime of their WS."""

    def __init__(self) -> None:
        self._sessions: dict[UUID, Session] = {}

    def create(self, session_id: UUID) -> Session:
        s = Session(session_id=session_id)
        self._sessions[session_id] = s
        return s

    def get(self, session_id: UUID) -> Optional[Session]:
        return self._sessions.get(session_id)

    def remove(self, session_id: UUID) -> None:
        self._sessions.pop(session_id, None)
