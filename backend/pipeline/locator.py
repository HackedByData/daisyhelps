"""Claude computer-use 'look but don't act' locator for the click indicator.

Used to compute a single (x, y) target on a screenshot the user just shared,
so the frontend can draw a visual highlight at that point. We never execute
the click — Daisy's product principle is 'guide, never do'.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Optional

from anthropic import AsyncAnthropic
from loguru import logger

from backend.config import settings

MODEL_LOCATOR = "claude-sonnet-4-6"
TOOL_TYPE = "computer_20250124"
MAX_TOKENS = 256
MAX_LABEL_CHARS = 80

_SYSTEM_PROMPT = (
    "You are a screen-region locator. Given a screenshot and a guidance message "
    "about what the user should do next, identify the single UI element they should "
    "click. Emit exactly one computer tool call with action='left_click' and "
    "coordinate=[x,y]. Do not explain. If you cannot identify the target with high "
    "confidence, do nothing."
)


@dataclass
class ClickTarget:
    x: int
    y: int
    ref_width: int
    ref_height: int
    label: Optional[str]


def png_dimensions(png: bytes) -> tuple[int, int]:
    """Read width and height from the PNG IHDR chunk (bytes 16-23).

    Avoids a Pillow dependency — we only need two big-endian uint32s.
    """
    if len(png) < 24 or png[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not a PNG")
    width = int.from_bytes(png[16:20], "big")
    height = int.from_bytes(png[20:24], "big")
    return width, height


def _client() -> AsyncAnthropic:
    if not settings.anthropic_api_key:
        raise RuntimeError("ANTHROPIC_API_KEY not set")
    return AsyncAnthropic(api_key=settings.anthropic_api_key)


def _extract_target(content_blocks, ref_width: int, ref_height: int) -> Optional[ClickTarget]:
    """Walk Claude's response content; return a ClickTarget for the first valid left_click,
    or None if no usable tool_use is present."""
    label: Optional[str] = None
    for block in content_blocks:
        btype = getattr(block, "type", None)
        if btype == "text":
            text = getattr(block, "text", "") or ""
            if text and label is None:
                label = text.strip()[:MAX_LABEL_CHARS]
        elif btype == "tool_use" and getattr(block, "name", None) == "computer":
            inp = getattr(block, "input", {}) or {}
            if inp.get("action") != "left_click":
                continue
            coord = inp.get("coordinate")
            if not (isinstance(coord, (list, tuple)) and len(coord) == 2):
                continue
            try:
                x, y = int(coord[0]), int(coord[1])
            except (TypeError, ValueError):
                continue
            if not (0 <= x < ref_width and 0 <= y < ref_height):
                return None
            return ClickTarget(x=x, y=y, ref_width=ref_width, ref_height=ref_height, label=label)
    return None


async def locate_click_target(
    image_bytes: bytes,
    guidance_text: str,
    language: Literal["en", "es"],
) -> Optional[ClickTarget]:
    """Best-effort: ask Claude (with the computer tool) to point at the element the user
    should click next. Returns None on any failure — caller must treat as 'no indicator'."""
    try:
        ref_width, ref_height = png_dimensions(image_bytes)
    except Exception as e:
        logger.warning(f"locator: bad screenshot bytes ({e}); skipping")
        return None

    import base64
    b64 = base64.standard_b64encode(image_bytes).decode("ascii")

    user_content = [
        {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": b64}},
        {
            "type": "text",
            "text": f'Daisy told the user: "{guidance_text}". Where on the screen should the user click?',
        },
    ]

    tool = {
        "type": TOOL_TYPE,
        "name": "computer",
        "display_width_px": ref_width,
        "display_height_px": ref_height,
    }

    try:
        client = _client()
        response = await client.messages.create(
            model=MODEL_LOCATOR,
            max_tokens=MAX_TOKENS,
            system=_SYSTEM_PROMPT,
            tools=[tool],
            messages=[{"role": "user", "content": user_content}],
        )
    except Exception as e:
        logger.warning(f"locator: Claude call failed ({e}); skipping indicator")
        return None

    return _extract_target(response.content, ref_width, ref_height)
