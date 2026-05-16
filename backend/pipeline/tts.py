"""ElevenLabs streaming TTS. Sentence-buffers an incoming text stream and yields PCM audio chunks."""
from __future__ import annotations

import re
from typing import AsyncIterator, Literal

from elevenlabs.client import AsyncElevenLabs
from loguru import logger

from backend.config import settings

# Output format: 24 kHz mono PCM
OUTPUT_FORMAT = "pcm_24000"
MODEL_ID = "eleven_multilingual_v2"

# Buffer text until a sentence-ish boundary, then emit to ElevenLabs.
_SENTENCE_END = re.compile(r"[.!?…]\s+|[\n]+")


def _voice_id(language: Literal["en", "es"]) -> str:
    vid = settings.elevenlabs_voice_id_en if language == "en" else settings.elevenlabs_voice_id_es
    if not vid:
        raise RuntimeError(f"ELEVENLABS_VOICE_ID_{language.upper()} not set")
    return vid


def _client() -> AsyncElevenLabs:
    if not settings.elevenlabs_api_key:
        raise RuntimeError("ELEVENLABS_API_KEY not set")
    return AsyncElevenLabs(api_key=settings.elevenlabs_api_key)


async def stream_tts(
    text_stream: AsyncIterator[str],
    language: Literal["en", "es"],
) -> AsyncIterator[bytes]:
    """
    Consume text deltas, batch into sentences, stream PCM bytes from ElevenLabs.
    Yields raw PCM bytes (24 kHz mono 16-bit LE) as they arrive.
    """
    voice_id = _voice_id(language)
    client = _client()
    buffer = ""

    async def synth_and_emit(text: str):
        if not text.strip():
            return
        logger.debug(f"TTS synth len={len(text)} voice={voice_id}")
        # ElevenLabs async streaming
        stream = client.text_to_speech.stream(
            voice_id=voice_id,
            optimize_streaming_latency="2",
            output_format=OUTPUT_FORMAT,
            text=text,
            model_id=MODEL_ID,
        )
        async for chunk in stream:
            if chunk:
                yield chunk

    # First emit accumulated full sentences from the input stream
    async for delta in text_stream:
        buffer += delta
        # Flush any complete sentence(s)
        while True:
            m = _SENTENCE_END.search(buffer)
            if not m:
                break
            sentence, buffer = buffer[:m.end()], buffer[m.end():]
            async for audio_chunk in synth_and_emit(sentence):
                yield audio_chunk

    # Flush any tail
    if buffer.strip():
        async for audio_chunk in synth_and_emit(buffer):
            yield audio_chunk
