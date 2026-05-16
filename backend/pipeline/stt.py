"""STT provider abstraction with a Groq Whisper Large v3 Turbo implementation."""
from __future__ import annotations

import io
import wave
from abc import ABC, abstractmethod
from typing import Literal

from groq import AsyncGroq
from loguru import logger

from backend.config import settings


class STTProvider(ABC):
    @abstractmethod
    async def transcribe(self, pcm_bytes: bytes, language: Literal["en", "es"]) -> str:
        """Transcribe 16 kHz mono 16-bit LE PCM and return text."""


def _pcm_to_wav(pcm_bytes: bytes, sample_rate: int = 16000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)  # 16-bit
        w.setframerate(sample_rate)
        w.writeframes(pcm_bytes)
    return buf.getvalue()


class GroqWhisperSTT(STTProvider):
    """Groq's Whisper Large v3 Turbo. Fastest hosted Whisper as of 2026."""

    MODEL = "whisper-large-v3-turbo"

    def __init__(self) -> None:
        if not settings.groq_api_key:
            raise RuntimeError("GROQ_API_KEY not set")
        self._client = AsyncGroq(api_key=settings.groq_api_key)

    async def transcribe(self, pcm_bytes: bytes, language: Literal["en", "es"]) -> str:
        wav_bytes = _pcm_to_wav(pcm_bytes)
        resp = await self._client.audio.transcriptions.create(
            file=("utterance.wav", wav_bytes, "audio/wav"),
            model=self.MODEL,
            language=language,
            response_format="text",
        )
        text = resp.strip() if isinstance(resp, str) else getattr(resp, "text", "").strip()
        logger.debug(f"STT [{language}] -> {text!r}")
        return text


def make_stt_provider() -> STTProvider:
    """One place to swap providers (e.g., OpenAI Whisper) if needed."""
    return GroqWhisperSTT()
