"""Claude LLM routing and streaming."""
from __future__ import annotations

import base64
from typing import AsyncIterator, Literal

from anthropic import AsyncAnthropic
from loguru import logger

from backend.config import settings
from backend.prompts import get_prompt

MODEL_SONNET = "claude-sonnet-4-6"
MODEL_HAIKU = "claude-haiku-4-5-20251001"
MAX_TOKENS = 1024


def route_model(has_image: bool) -> str:
    """Sonnet for vision turns; Haiku for everything else."""
    return MODEL_SONNET if has_image else MODEL_HAIKU


def _client() -> AsyncAnthropic:
    if not settings.anthropic_api_key:
        raise RuntimeError("ANTHROPIC_API_KEY not set")
    return AsyncAnthropic(api_key=settings.anthropic_api_key)


def _build_messages(history: list[dict], new_user_text: str, image_bytes: bytes | None) -> list[dict]:
    """Build the Claude `messages` array, optionally appending an image block to the new user turn."""
    msgs = [{"role": m["role"], "content": m["content"]} for m in history]

    if image_bytes is not None:
        b64 = base64.standard_b64encode(image_bytes).decode("ascii")
        user_content = [
            {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": b64}},
            {"type": "text", "text": new_user_text},
        ]
    else:
        user_content = new_user_text

    msgs.append({"role": "user", "content": user_content})
    return msgs


async def stream_response(
    history: list[dict],
    user_text: str,
    image_bytes: bytes | None,
    language: Literal["en", "es"],
) -> AsyncIterator[str]:
    """Async generator yielding text deltas from Claude's streaming API."""
    model = route_model(has_image=image_bytes is not None)
    messages = _build_messages(history, user_text, image_bytes)
    system_prompt = get_prompt(language)

    logger.debug(f"LLM call model={model} msgs={len(messages)} lang={language} image={image_bytes is not None}")

    async with _client().messages.stream(
        model=model,
        max_tokens=MAX_TOKENS,
        system=system_prompt,
        messages=messages,
    ) as stream:
        async for text in stream.text_stream:
            yield text
