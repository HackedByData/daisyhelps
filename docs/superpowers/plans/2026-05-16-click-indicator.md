# Click Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a server→client `click_indicator` message that carries pixel coordinates the frontend can use to draw a visual highlight on the user's screen, computed via a second Claude call using the computer-use tool in look-but-don't-act mode. Add a `clear_indicator` message at the top of every new turn.

**Architecture:** A new `backend/pipeline/locator.py` module wraps a Claude `claude-sonnet-4-6` call with the `computer_20250124` tool. After the existing voice turn finishes (`audio_end` sent), if a screenshot was attached this turn *and* Daisy's response text matches a click-intent regex, fire a one-shot locator call. Extract the `(x, y)` from the emitted `left_click` tool_use block, send `click_indicator`. All failures degrade silently. Voice latency is unchanged.

**Tech Stack:** Python 3.11, FastAPI, `anthropic` SDK (already pinned ≥0.40), pytest. No new dependencies — PNG dimensions are extracted from the IHDR header directly; async tests use `asyncio.run` (no `pytest-asyncio`).

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `backend/pipeline/locator.py` | Create | `ClickTarget` dataclass, `png_dimensions()`, `locate_click_target()` |
| `backend/messages.py` | Modify | Add `click_indicator_msg()` + `clear_indicator_msg()` dict helpers |
| `backend/session.py` | Modify | Add `current_indicator_task: Optional[asyncio.Task] = None` |
| `backend/readiness.py` | Modify | Add `click_indicator` and `clear_indicator` keys; bump phase to 5 / `click-indicator` |
| `backend/main.py` | Modify | Add `_CLICK_INTENT_RE`, `_emit_indicator()`, emit `clear_indicator` at top of `_run_turn`, trigger locator after `audio_end`, cancel indicator task in `_cancel_turn`, import `re` + `locate_click_target` + new msg helpers |
| `backend/prompts.py` | Modify | Append highlight paragraph to `DAISY_PROMPT_EN` and `DAISY_PROMPT_ES` |
| `tests/test_locator.py` | Create | Tests for `png_dimensions` and `locate_click_target` (with mocked Anthropic client) |
| `tests/test_indicator_messages.py` | Create | Round-trip tests for `click_indicator_msg` and `clear_indicator_msg` |
| `tests/test_indicator_flow.py` | Create | End-to-end `_run_turn` tests for clear/emit/skip/silent-failure paths and click-intent regex (EN+ES) |
| `docs/API.md` | Modify | Document new messages, update example `/api/status`, extend Vision flow note |
| `docs/ARCHITECTURE.md` | Modify | Add `Locator` row, extend Vision flow |
| `docs/DECISIONS.md` | Modify | Add decision entry |

---

## Task ordering rationale

Tasks proceed bottom-up: pure helpers (PNG dimensions, dict messages) first, then domain types (`ClickTarget`, locator with mocked client), then session/readiness wiring, then `main.py` orchestration (where everything lands), then prompts, then docs, then final acceptance. This ordering means each task's tests can run in isolation against committed prior work.

---

### Task 1: PNG dimension helper

**Files:**
- Create: `backend/pipeline/locator.py` (only the helper + a tiny module docstring; `ClickTarget` and `locate_click_target` arrive in Task 3)
- Create: `tests/test_locator.py` (only the PNG tests for now; locator tests arrive in Task 3)

- [ ] **Step 1: Write the failing tests**

Create `tests/test_locator.py`:

```python
import pytest

from backend.pipeline.locator import png_dimensions


def _fake_png(width: int, height: int) -> bytes:
    """Synthesize a minimal PNG: 8-byte signature + 13-byte IHDR length + 'IHDR' + width + height.
    Only the first 24 bytes are inspected by png_dimensions; we don't need a valid IDAT.
    """
    return (
        b"\x89PNG\r\n\x1a\n"          # PNG signature
        + b"\x00\x00\x00\x0d"         # IHDR chunk length = 13
        + b"IHDR"
        + width.to_bytes(4, "big")
        + height.to_bytes(4, "big")
    )


def test_png_dimensions_extracts_size():
    png = _fake_png(1920, 1080)
    assert png_dimensions(png) == (1920, 1080)


def test_png_dimensions_handles_non_standard_size():
    png = _fake_png(3840, 2160)
    assert png_dimensions(png) == (3840, 2160)


def test_png_dimensions_rejects_bad_magic():
    with pytest.raises(ValueError):
        png_dimensions(b"not a png" + b"\x00" * 20)


def test_png_dimensions_rejects_too_short():
    with pytest.raises(ValueError):
        png_dimensions(b"\x89PNG\r\n\x1a\n")  # signature only, no IHDR
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_locator.py -v`
Expected: `ModuleNotFoundError: No module named 'backend.pipeline.locator'`

- [ ] **Step 3: Create the locator module with the helper**

Create `backend/pipeline/locator.py`:

```python
"""Claude computer-use 'look but don't act' locator for the click indicator.

Used to compute a single (x, y) target on a screenshot the user just shared,
so the frontend can draw a visual highlight at that point. We never execute
the click — Daisy's product principle is 'guide, never do'.
"""
from __future__ import annotations


def png_dimensions(png: bytes) -> tuple[int, int]:
    """Read width and height from the PNG IHDR chunk (bytes 16-23).

    Avoids a Pillow dependency — we only need two big-endian uint32s.
    """
    if len(png) < 24 or png[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not a PNG")
    width = int.from_bytes(png[16:20], "big")
    height = int.from_bytes(png[20:24], "big")
    return width, height
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_locator.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/pipeline/locator.py tests/test_locator.py
git commit -m "feat(locator): png_dimensions helper for screenshot ref dims"
```

---

### Task 2: Outgoing message helpers

**Files:**
- Modify: `backend/messages.py` (add two new helpers at end)
- Create: `tests/test_indicator_messages.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_indicator_messages.py`:

```python
import json

from backend.messages import click_indicator_msg, clear_indicator_msg


def test_click_indicator_msg_full_schema():
    msg = click_indicator_msg(
        x=842, y=537,
        ref_width=1920, ref_height=1080,
        label="Join button", confidence=None,
    )
    assert msg == {
        "type": "click_indicator",
        "x": 842, "y": 537,
        "ref_width": 1920, "ref_height": 1080,
        "label": "Join button",
        "confidence": None,
    }


def test_click_indicator_msg_defaults_label_and_confidence_to_none():
    msg = click_indicator_msg(x=10, y=20, ref_width=100, ref_height=200)
    assert msg["label"] is None
    assert msg["confidence"] is None


def test_click_indicator_msg_survives_json_roundtrip():
    msg = click_indicator_msg(x=1, y=2, ref_width=3, ref_height=4, label="x", confidence=None)
    assert json.loads(json.dumps(msg)) == msg


def test_clear_indicator_msg():
    assert clear_indicator_msg() == {"type": "clear_indicator"}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_indicator_messages.py -v`
Expected: `ImportError: cannot import name 'click_indicator_msg' from 'backend.messages'`

- [ ] **Step 3: Add the helpers to backend/messages.py**

Append to `backend/messages.py` (after the existing `error_msg` definition):

```python
def click_indicator_msg(
    x: int,
    y: int,
    ref_width: int,
    ref_height: int,
    label: str | None = None,
    confidence: float | None = None,
) -> dict:
    return {
        "type": "click_indicator",
        "x": x,
        "y": y,
        "ref_width": ref_width,
        "ref_height": ref_height,
        "label": label,
        "confidence": confidence,
    }


def clear_indicator_msg() -> dict:
    return {"type": "clear_indicator"}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_indicator_messages.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/messages.py tests/test_indicator_messages.py
git commit -m "feat(messages): click_indicator and clear_indicator helpers"
```

---

### Task 3: ClickTarget + locate_click_target (with mocked Anthropic client)

**Files:**
- Modify: `backend/pipeline/locator.py` (add `ClickTarget` dataclass and `locate_click_target` async function)
- Modify: `tests/test_locator.py` (add locator tests)

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_locator.py`:

```python
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from backend.pipeline import locator as locator_mod
from backend.pipeline.locator import ClickTarget, locate_click_target


def _tool_use_block(x: int, y: int):
    return SimpleNamespace(
        type="tool_use",
        name="computer",
        input={"action": "left_click", "coordinate": [x, y]},
    )


def _text_block(text: str):
    return SimpleNamespace(type="text", text=text)


def _mock_client_returning(content_blocks):
    """Build a mock that quacks like AsyncAnthropic for a single .messages.create call."""
    response = SimpleNamespace(content=content_blocks)
    client = MagicMock()
    client.messages.create = AsyncMock(return_value=response)
    return client


def test_locate_click_target_returns_coords_on_success(monkeypatch):
    png = _fake_png(1920, 1080)
    client = _mock_client_returning([_text_block("Join button"), _tool_use_block(842, 537)])
    monkeypatch.setattr(locator_mod, "_client", lambda: client)

    result = asyncio.run(locate_click_target(png, "Click the Join button.", "en"))

    assert result == ClickTarget(x=842, y=537, ref_width=1920, ref_height=1080, label="Join button")
    # Verify we asked Sonnet with computer tool sized to the screenshot
    args, kwargs = client.messages.create.call_args
    assert kwargs["model"] == "claude-sonnet-4-6"
    tool = kwargs["tools"][0]
    assert tool["type"] == "computer_20250124"
    assert tool["display_width_px"] == 1920
    assert tool["display_height_px"] == 1080


def test_locate_click_target_returns_none_when_no_tool_use(monkeypatch):
    png = _fake_png(1920, 1080)
    client = _mock_client_returning([_text_block("I cannot determine the target.")])
    monkeypatch.setattr(locator_mod, "_client", lambda: client)

    result = asyncio.run(locate_click_target(png, "Click somewhere.", "en"))
    assert result is None


def test_locate_click_target_returns_none_when_out_of_bounds(monkeypatch):
    png = _fake_png(1920, 1080)
    client = _mock_client_returning([_tool_use_block(5000, 5000)])  # outside screenshot
    monkeypatch.setattr(locator_mod, "_client", lambda: client)

    result = asyncio.run(locate_click_target(png, "Click somewhere.", "en"))
    assert result is None


def test_locate_click_target_returns_none_on_exception(monkeypatch):
    png = _fake_png(1920, 1080)
    client = MagicMock()
    client.messages.create = AsyncMock(side_effect=RuntimeError("network down"))
    monkeypatch.setattr(locator_mod, "_client", lambda: client)

    result = asyncio.run(locate_click_target(png, "Click somewhere.", "en"))
    assert result is None


def test_locate_click_target_returns_none_when_action_is_not_left_click(monkeypatch):
    png = _fake_png(1920, 1080)
    block = SimpleNamespace(
        type="tool_use",
        name="computer",
        input={"action": "type", "text": "hello"},
    )
    client = _mock_client_returning([block])
    monkeypatch.setattr(locator_mod, "_client", lambda: client)

    result = asyncio.run(locate_click_target(png, "Click somewhere.", "en"))
    assert result is None


def test_locate_click_target_returns_none_on_bad_png(monkeypatch):
    # No client should be needed — png_dimensions raises before any API call.
    client = MagicMock()
    client.messages.create = AsyncMock()
    monkeypatch.setattr(locator_mod, "_client", lambda: client)

    result = asyncio.run(locate_click_target(b"not a png at all", "Click somewhere.", "en"))
    assert result is None
    client.messages.create.assert_not_called()


def test_locate_click_target_trims_long_label(monkeypatch):
    png = _fake_png(1920, 1080)
    long_text = "x" * 500
    client = _mock_client_returning([_text_block(long_text), _tool_use_block(10, 10)])
    monkeypatch.setattr(locator_mod, "_client", lambda: client)

    result = asyncio.run(locate_click_target(png, "Click.", "en"))
    assert result is not None
    assert len(result.label) <= 80
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_locator.py -v`
Expected: 7 new failures with `ImportError: cannot import name 'ClickTarget'` (the 4 PNG tests still pass).

- [ ] **Step 3: Implement ClickTarget and locate_click_target**

Replace the contents of `backend/pipeline/locator.py` with:

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_locator.py -v`
Expected: 11 passed (4 png_dimensions + 7 locator).

- [ ] **Step 5: Commit**

```bash
git add backend/pipeline/locator.py tests/test_locator.py
git commit -m "feat(locator): ClickTarget + locate_click_target via computer-use"
```

---

### Task 4: Session tracks indicator task

**Files:**
- Modify: `backend/session.py` (add field)
- Modify: `tests/test_session.py` (add field-default test)

- [ ] **Step 1: Write the failing test**

Append to `tests/test_session.py`:

```python
def test_session_current_indicator_task_default_none():
    s = Session(session_id=uuid4())
    assert s.current_indicator_task is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_session.py::test_session_current_indicator_task_default_none -v`
Expected: `AttributeError: 'Session' object has no attribute 'current_indicator_task'`

- [ ] **Step 3: Add the field**

In `backend/session.py`, modify the `Session` dataclass (immediately after `current_turn_task` line):

```python
    current_turn_task: Optional[asyncio.Task] = None
    current_indicator_task: Optional[asyncio.Task] = None
    vad_buffer: Optional["VADBuffer"] = None
```

(Insert the new line between `current_turn_task` and `vad_buffer`.)

- [ ] **Step 4: Run all session tests to verify they pass**

Run: `pytest tests/test_session.py -v`
Expected: all session tests pass (existing + new).

- [ ] **Step 5: Commit**

```bash
git add backend/session.py tests/test_session.py
git commit -m "feat(session): track current_indicator_task for cancellation"
```

---

### Task 5: Readiness — add keys, bump phase

**Files:**
- Modify: `backend/readiness.py`
- Create: `tests/test_readiness_indicator.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_readiness_indicator.py`:

```python
from backend.readiness import READINESS, is_live


def test_phase_bumped_to_click_indicator():
    assert READINESS["phase"] == 5
    assert READINESS["phase_name"] == "click-indicator"


def test_click_indicator_live():
    assert is_live("server_to_client", "click_indicator")


def test_clear_indicator_live():
    assert is_live("server_to_client", "clear_indicator")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_readiness_indicator.py -v`
Expected: 3 failures (`assert 4 == 5`, missing keys).

- [ ] **Step 3: Update readiness.py**

In `backend/readiness.py`, change the `phase` and `phase_name`, then add the two new keys to `server_to_client`:

```python
    "phase": 5,
    "phase_name": "click-indicator",
```

```python
    "server_to_client": {
        "status": STATUS_LIVE,
        "error": STATUS_LIVE,
        "transcript": STATUS_LIVE,
        "daisy_text": STATUS_LIVE,
        "audio_chunk": STATUS_LIVE,
        "audio_end": STATUS_LIVE,
        "screenshot_request": STATUS_LIVE,
        "click_indicator": STATUS_LIVE,
        "clear_indicator": STATUS_LIVE,
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_readiness_indicator.py -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/readiness.py tests/test_readiness_indicator.py
git commit -m "feat(readiness): phase 5 click-indicator + new server msg types"
```

---

### Task 6: Wire clear_indicator + locator trigger into _run_turn

**Files:**
- Modify: `backend/main.py` (imports, `_CLICK_INTENT_RE`, `_emit_indicator`, top-of-`_run_turn` emission, post-`audio_end` trigger, `_cancel_turn` updates)
- Create: `tests/test_indicator_flow.py`

This is the largest task. It changes orchestration in several places. Steps are split fine-grained so a fresh agent can follow without re-reading.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_indicator_flow.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_indicator_flow.py -v`
Expected: tests fail on import — `ImportError: cannot import name '_CLICK_INTENT_RE' from 'backend.main'`.

- [ ] **Step 3: Add imports and the click-intent regex to backend/main.py**

In `backend/main.py`, modify the top-of-file imports to add `re` and the new symbols.

Add `import re` near the top (after `import asyncio`).

Extend the `from backend.messages import (...)` block to include the two new helpers:

```python
from backend.messages import (
    AudioChunkMessage,
    ConfigMessage,
    EndSessionMessage,
    InterruptMessage,
    LanguageChangeMessage,
    ScreenshotMessage,
    UserTextMessage,
    audio_chunk_msg,
    audio_end_msg,
    clear_indicator_msg,
    click_indicator_msg,
    daisy_text_msg,
    error_msg,
    parse_client_message,
    status_msg,
    transcript_msg,
)
```

Add a new import line below the existing `from backend.pipeline.llm import stream_response`:

```python
from backend.pipeline.locator import locate_click_target
```

Below the existing `_VISUAL_HINT_WORDS` tuple, add:

```python
# Imperative verbs in Daisy's response that indicate she's asking the user to act
# on a specific UI element. Used to gate the click-indicator locator call.
_CLICK_INTENT_RE = re.compile(
    r"\b(click|tap|press|select|choose|open|hit"
    r"|haz\s+clic|presiona|toca|selecciona|abre|elige|pulsa)\b",
    re.IGNORECASE,
)
```

- [ ] **Step 4: Add the _emit_indicator helper to backend/main.py**

Add this helper above `_run_turn`:

```python
async def _emit_indicator(
    websocket: WebSocket,
    image_bytes: bytes,
    guidance_text: str,
    language: str,
):
    """Best-effort: ask the locator for a click target, send click_indicator if found.

    Swallows all exceptions — the indicator is additive and must never disturb
    the rest of the turn.
    """
    try:
        target = await locate_click_target(image_bytes, guidance_text, language)
    except Exception as e:
        logger.warning(f"indicator: locator raised ({e}); skipping")
        return
    if target is None:
        return
    try:
        await websocket.send_json(click_indicator_msg(
            x=target.x,
            y=target.y,
            ref_width=target.ref_width,
            ref_height=target.ref_height,
            label=target.label,
            confidence=None,
        ))
    except Exception as e:
        logger.warning(f"indicator: send failed ({e})")
```

- [ ] **Step 5: Emit clear_indicator at the top of _run_turn**

In `backend/main.py`, change the start of `_run_turn`. The current function begins:

```python
async def _run_turn(
    websocket: WebSocket,
    session: Session,
    utterance_audio: bytes | None,
    user_text: str | None,
):
    """Run a full turn: STT (if audio) → LLM stream → TTS stream."""
    try:
        # Transcribe if audio
        if utterance_audio is not None:
```

Insert a `clear_indicator` emission as the very first action inside the `try`:

```python
async def _run_turn(
    websocket: WebSocket,
    session: Session,
    utterance_audio: bytes | None,
    user_text: str | None,
):
    """Run a full turn: STT (if audio) → LLM stream → TTS stream."""
    try:
        # Clear any prior turn's click indicator — fulfills the "indicator clears
        # on next user utterance" lifecycle. Send-errors are swallowed; the rest
        # of the turn must proceed regardless.
        try:
            await websocket.send_json(clear_indicator_msg())
        except Exception:
            pass

        # Transcribe if audio
        if utterance_audio is not None:
```

- [ ] **Step 6: Trigger the locator after audio_end**

In `backend/main.py`, the end of `_run_turn` currently looks like:

```python
        await websocket.send_json(audio_end_msg())
        session.set_status("idle")
        await websocket.send_json(status_msg("idle"))
```

Insert the locator trigger between `audio_end_msg()` and `set_status("idle")`:

```python
        await websocket.send_json(audio_end_msg())

        # Click-indicator: best-effort, post-audio. Only fires when a screenshot
        # was actually consumed this turn AND Daisy asked the user to click.
        if image_bytes is not None and _CLICK_INTENT_RE.search(full):
            session.current_indicator_task = asyncio.create_task(
                _emit_indicator(websocket, image_bytes, full, session.language)
            )

        session.set_status("idle")
        await websocket.send_json(status_msg("idle"))
```

- [ ] **Step 7: Cancel the indicator task in _cancel_turn**

In `backend/main.py`, change `_cancel_turn` to also cancel `current_indicator_task`. The current function:

```python
async def _cancel_turn(websocket: WebSocket, session: Session, send_audio_end: bool = True):
    task = session.current_turn_task
    if task and not task.done():
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass
    session.current_turn_task = None
    if send_audio_end and session.status == "speaking":
        try:
            await websocket.send_json(audio_end_msg())
            await websocket.send_json(status_msg("listening"))
            session.set_status("listening")
        except Exception:
            pass
```

Replace with:

```python
async def _cancel_turn(websocket: WebSocket, session: Session, send_audio_end: bool = True):
    # Cancel the in-flight turn first.
    task = session.current_turn_task
    if task and not task.done():
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass
    session.current_turn_task = None

    # And any pending indicator call from this turn.
    itask = session.current_indicator_task
    if itask and not itask.done():
        itask.cancel()
        try:
            await itask
        except (asyncio.CancelledError, Exception):
            pass
    session.current_indicator_task = None

    if send_audio_end and session.status == "speaking":
        try:
            await websocket.send_json(audio_end_msg())
            await websocket.send_json(status_msg("listening"))
            session.set_status("listening")
        except Exception:
            pass
```

- [ ] **Step 8: Run the indicator-flow tests**

Run: `pytest tests/test_indicator_flow.py -v`
Expected: all tests pass (3 regex parametrizations + 6 flow tests = 18 test cases).

- [ ] **Step 9: Run the full suite to check for regressions**

Run: `pytest -q`
Expected: all existing tests still pass.

- [ ] **Step 10: Commit**

```bash
git add backend/main.py tests/test_indicator_flow.py
git commit -m "feat(indicator): wire clear_indicator + locator into _run_turn"
```

---

### Task 7: System-prompt addition (EN + ES)

**Files:**
- Modify: `backend/prompts.py`

This task has no new unit test — `test_llm_router.py` already asserts that `get_prompt("en")` returns `DAISY_PROMPT_EN`. We add a content-presence assertion to confirm the new paragraph landed.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_llm_router.py`:

```python
def test_en_prompt_mentions_circle_highlight():
    # The system prompt must mention the on-screen highlight so Daisy can
    # introduce it once per session without sounding surprised.
    assert "circle" in DAISY_PROMPT_EN.lower()


def test_es_prompt_mentions_circle_highlight():
    assert "círculo" in DAISY_PROMPT_ES.lower()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_llm_router.py -v`
Expected: 2 new failures (`assert 'circle' in ...`).

- [ ] **Step 3: Append the highlight paragraph to each prompt**

In `backend/prompts.py`, modify `DAISY_PROMPT_EN`. Find the line `Speak in English for the entire conversation. Never mix languages unless the user does.` Insert a new paragraph immediately before it:

```python
When you ask the user to click or tap something, a circle will appear on their screen pointing to the right spot. The first time it's relevant in our conversation, mention this gently — for example: "You'll see a little circle appear right where you should click." After that, you don't need to mention it again.

Speak in English for the entire conversation. Never mix languages unless the user does.
```

In `DAISY_PROMPT_ES`, find `Habla en español durante toda la conversación. Nunca mezcles idiomas a menos que el usuario lo haga.` Insert a new paragraph immediately before it:

```python
Cuando le pidas al usuario que haga clic o toque algo, aparecerá un círculo en su pantalla señalando el lugar correcto. La primera vez que sea relevante en nuestra conversación, menciónalo con suavidad — por ejemplo: "Verá aparecer un pequeño círculo justo donde debe hacer clic." Después, no necesitas mencionarlo de nuevo.

Habla en español durante toda la conversación. Nunca mezcles idiomas a menos que el usuario lo haga.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_llm_router.py -v`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/prompts.py tests/test_llm_router.py
git commit -m "feat(prompts): mention click-indicator circle once per session"
```

---

### Task 8: Documentation — API.md

**Files:**
- Modify: `docs/API.md`

- [ ] **Step 1: Update the example /api/status payload**

In `docs/API.md`, find the JSON block under the `## GET /api/status` heading. Replace the `phase`/`phase_name` lines and the `server_to_client` block:

```json
{
  "service": "daisy-helps-backend",
  "version": "0.1.0",
  "phase": 5,
  "phase_name": "click-indicator",
  "http": {
    "GET /healthz": "live",
    "GET /": "live",
    "GET /test": "live",
    "GET /api/status": "live",
    "WS /ws/{session_id}": "live"
  },
  "client_to_server": {
    "config": "live",
    "audio_chunk": "stubbed",
    "user_text": "stubbed",
    "screenshot": "stubbed",
    "interrupt": "stubbed",
    "language_change": "stubbed",
    "end_session": "stubbed"
  },
  "server_to_client": {
    "status": "live",
    "error": "live",
    "transcript": "stubbed",
    "daisy_text": "stubbed",
    "audio_chunk": "stubbed",
    "audio_end": "stubbed",
    "screenshot_request": "stubbed",
    "click_indicator": "stubbed",
    "clear_indicator": "stubbed"
  }
}
```

(This block describes Phase 0 baseline behavior for stubbed types — runtime values are reported live by the server. The `stubbed` values for non-Phase-0 types are illustrative, matching the existing pattern in the file.)

- [ ] **Step 2: Add the two new server→client message sections**

In `docs/API.md`, find the existing `### error` heading under `## Server → Client messages`. Insert two new sections immediately before `### error`:

```markdown
### `click_indicator`
Pixel coordinates the frontend should highlight on the user's screen. At most one per turn, emitted after `audio_end`. The locator runs only when a screenshot was attached to the current turn AND Daisy's response asked the user to click something. Failures are silent (no message emitted, no `error` frame).

```json
{
  "type": "click_indicator",
  "x": 842,
  "y": 537,
  "ref_width": 1920,
  "ref_height": 1080,
  "label": "Join button",
  "confidence": null
}
```

| Field | Type | Notes |
|---|---|---|
| `x`, `y` | int | Coordinates in the screenshot's native pixel space. |
| `ref_width`, `ref_height` | int | Dimensions of the screenshot. Scale via `(x/ref_width, y/ref_height)` to map onto the user's actual screen. |
| `label` | string \| null | Short hint describing the target element (≤80 chars). |
| `confidence` | number \| null | Reserved for forward compatibility; always `null` in v1. |

**Live from:** Phase 5.

### `clear_indicator`
Sent as the first frame of every new turn (before `transcript`), regardless of whether the new turn will emit its own `click_indicator`. Guarantees the lifecycle "indicator clears on next user utterance." The server does not emit a time-based `clear_indicator` — the frontend may choose to fade the indicator after a duration of its own choosing.

```json
{"type": "clear_indicator"}
```

**Live from:** Phase 5.
```

- [ ] **Step 3: Extend the Vision flow section**

In `docs/API.md`, find the `## Vision flow` heading (the first one, not the duplicate at the end). Append a paragraph at the end of that section:

```markdown
After the LLM turn finishes (`audio_end` sent), if a screenshot was consumed this turn AND Daisy's response text contains a click intent ("click", "tap", "press", "open", and Spanish equivalents), the backend makes a second Claude call against the same screenshot using the computer-use tool in "look but don't act" mode. The resulting `(x, y)` is sent as a `click_indicator` message. The locator is best-effort: any failure (timeout, refusal, missing tool_use, out-of-bounds coords) drops silently — no indicator, no `error` frame.
```

- [ ] **Step 4: Commit**

```bash
git add docs/API.md
git commit -m "docs(api): document click_indicator and clear_indicator"
```

---

### Task 9: Documentation — ARCHITECTURE.md

**Files:**
- Modify: `docs/ARCHITECTURE.md`

- [ ] **Step 1: Add Locator to the components table**

In `docs/ARCHITECTURE.md`, find the `## Components` table. Add a new row after the existing `Config` row (or at the end of the table, before the closing of the section):

```markdown
| Locator | `backend/pipeline/locator.py` | Best-effort computer-use call to identify the click target; returns `ClickTarget(x, y, ref_width, ref_height, label)` or `None` |
```

- [ ] **Step 2: Extend the Vision flow section with the locator branch**

In `docs/ARCHITECTURE.md`, find the `## Vision flow` heading. Append at the end of the section:

```markdown
3. After `audio_end`, if `image_bytes` was used this turn AND Daisy's response matched the click-intent regex, the server schedules a `locate_click_target(image_bytes, full_response, language)` call (Claude Sonnet + `computer_20250124` tool). On a valid `left_click` tool_use, the server emits `click_indicator`. The call is best-effort and degrades silently. The indicator is cleared on the *next* turn via `clear_indicator` emitted as the first frame of `_run_turn`.
```

- [ ] **Step 3: Commit**

```bash
git add docs/ARCHITECTURE.md
git commit -m "docs(architecture): add Locator component and click-indicator flow"
```

---

### Task 10: Documentation — DECISIONS.md

**Files:**
- Modify: `docs/DECISIONS.md`

- [ ] **Step 1: Append the new decision entry**

Append to `docs/DECISIONS.md`:

```markdown
## Click indicator: Claude computer-use tool in look-but-don't-act mode
**Context:** Elderly and tech-novice users struggle to locate UI elements from a verbal description alone. Daisy says "click the blue Join button" and the user can't find it on a crowded page.
**Decision:** After the voice response finishes, make a second `claude-sonnet-4-6` call against the same screenshot with the `computer_20250124` tool enabled. Read the `(x, y)` from the emitted `left_click` tool_use block, send it to the frontend as `click_indicator`. Never execute the click — Daisy's "guide, never do" principle is preserved.
**Rationale:** Computer-use is first-party, requires zero new dependencies, and per Anthropic's own guidance is dramatically more reliable for pixel coordinates than raw-JSON prompting. The locator runs after `audio_end` so voice latency is unaffected. The indicator is best-effort and degrades silently on any failure.
**Alternatives considered:** Set-of-Mark prompting with OmniParser or OCR (very accurate but adds a UI-element detector dependency and a pre-processing pass per screenshot). Raw JSON prompting ("return `{x, y}`") — unreliable for pixel coords. Multiple-indicator sequences — defers to v2; conflicts with the "one step at a time" prompt rule. Bounding-box indicators — defers to v2; computer-use returns a point, region would need a follow-up call.
**How to swap:** Replace the body of `backend/pipeline/locator.locate_click_target` with any other targeting backend that returns a `ClickTarget`. Wire format and trigger conditions are unchanged.
```

- [ ] **Step 2: Commit**

```bash
git add docs/DECISIONS.md
git commit -m "docs(decisions): record click-indicator locator decision"
```

---

### Task 11: Final acceptance

**Files:** none new.

- [ ] **Step 1: Run the full test suite**

Run: `pytest -q`
Expected: all tests pass. Note the count; record any new test failures in the task list for resolution before claiming done.

- [ ] **Step 2: Manually verify /api/status**

Start the server: `uvicorn backend.main:app --reload --port 8000` (run in a separate shell or background).

Hit the endpoint: `curl http://localhost:8000/api/status` (or open in browser).

Expected JSON contains:
```
"phase": 5
"phase_name": "click-indicator"
"server_to_client": { ... "click_indicator": "live", "clear_indicator": "live" }
```

Stop the server.

- [ ] **Step 3: Smoke-test via the test harness (optional but recommended)**

The repo already includes `tests/` Python harnesses and `backend/test_harness/test_page.html`. If `ANTHROPIC_API_KEY` is configured locally:

1. Start the server.
2. Open `http://localhost:8000/test` in a browser.
3. Upload a screenshot via the screenshot field.
4. Send a text message like "Where do I click to open my email?"
5. Confirm in the WS frame log: (a) Daisy responds with text + audio, (b) a `click_indicator` frame appears after `audio_end` with `x`/`y` inside the screenshot bounds, (c) sending another message produces a `clear_indicator` as the first frame of that next turn.

If the key isn't configured, skip — unit tests already cover the wiring.

- [ ] **Step 4: Confirm git log shows clean, focused commits**

Run: `git log --oneline -15`

Expected: each task's commit is visible, in order, with the prefixes from each task.

---

## Self-review

**Spec coverage check (against `docs/superpowers/specs/2026-05-16-click-indicator-design.md`):**

| Spec section | Covered by |
|---|---|
| §3 `click_indicator` schema | Task 2 (helper) + Task 6 (emission) + Task 8 (docs) |
| §3 `clear_indicator` schema | Task 2 (helper) + Task 6 (top-of-`_run_turn` emit) + Task 8 (docs) |
| §3 readiness keys + phase bump | Task 5 |
| §4 architecture / data flow | Task 6 (`_run_turn` edits) + Task 9 (docs) |
| §4 cancellation (`current_indicator_task`) | Task 4 (field) + Task 6 (`_cancel_turn` edits) |
| §4 screenshot lifecycle unchanged | Implicit — Task 6 reuses `image_bytes` from `_run_turn` local scope, no session-state touch |
| §5 `ClickTarget` + `locate_click_target` | Task 3 |
| §5 PNG dimensions | Task 1 |
| §5 computer-use tool config | Task 3 (model/tool config + system prompt) |
| §5 response handling (label trim, out-of-bounds, exceptions) | Task 3 (`_extract_target`) + tests |
| §6 click-intent regex | Task 6 (`_CLICK_INTENT_RE`) + tests |
| §6 trigger condition | Task 6 (post-`audio_end` if block) |
| §6 `clear_indicator` at top of turn | Task 6 (Step 5) |
| §7 prompt addition EN+ES | Task 7 |
| §8 docs (API, ARCHITECTURE, DECISIONS) | Tasks 8, 9, 10 |
| §9 test list | Mapped across Tasks 1, 2, 3, 6, 7 |
| §10 acceptance criteria | Task 11 |
| §11 non-goals | Honored: no click execution (Task 3 only reads tool_use); no new deps (custom PNG parse); locator runs after `audio_end` (Task 6 Step 6); single indicator (Task 6 logic); no server-side auto-clear (lifecycle is utterance-only via Task 6 Step 5) |
| §12 future work | Out of scope by design |

No gaps.

**Placeholder scan:** No "TBD", "TODO", "implement later", or "similar to Task N" placeholders. All code blocks contain complete code.

**Type consistency check:**
- `ClickTarget` defined in Task 3 with fields `(x, y, ref_width, ref_height, label)`. Used in Task 6 indicator-emission code with the same field names. ✓
- `locate_click_target(image_bytes, guidance_text, language)` signature in Task 3 matches the call site in Task 6 `_emit_indicator`. ✓
- `click_indicator_msg(x, y, ref_width, ref_height, label, confidence)` signature in Task 2 matches the call in Task 6's `_emit_indicator`. ✓
- `clear_indicator_msg()` (no args) in Task 2 matches the call in Task 6 Step 5. ✓
- `Session.current_indicator_task` added in Task 4 matches assignments/reads in Task 6 Steps 6 and 7. ✓
- `_CLICK_INTENT_RE` defined in Task 6 Step 3 matches usage in Task 6 Step 6 and tests in Step 1. ✓
