# Daisy Helps Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a FastAPI WebSocket backend for Daisy Helps — a voice AI companion that walks elderly/tech-novice users through computer tasks one step at a time using streaming VAD/STT/LLM/TTS plus screenshot vision — and deploy it to Render at `api.daisyhelps.com`.

**Architecture:** A FastAPI server holds long-lived WebSocket connections at `/ws/{session_id}`. Each connection drives a streaming audio pipeline: Silero VAD detects end-of-utterance from incoming 16 kHz PCM, Groq Whisper Large v3 Turbo transcribes the utterance, Claude (Haiku for text turns, Sonnet for screenshot turns) streams a response, and ElevenLabs streams the synthesized 24 kHz PCM audio back. The most recent screenshot (< 60s old) is attached to the next LLM call automatically. Interrupts cancel the per-turn `asyncio.Task` via `CancelledError`. Session state is in-memory.

**Tech Stack:** Python 3.11, FastAPI, Uvicorn, websockets, anthropic SDK, groq SDK, elevenlabs SDK, silero-vad (PyPI package) with torch CPU-only, httpx[http2], pydantic-settings, loguru, pytest.

**Spec:** `docs/superpowers/specs/2026-05-16-daisy-helps-backend-design.md`

---

## Parallel frontend development model

A Claude design agent builds the frontend **in parallel** with this backend. To make that work, the protocol surface and readiness state must be stable from Day 0:

1. **`docs/API.md` is complete from Phase 0** — every endpoint, every message type, every error code documented before any pipeline code lands. The frontend agent wires against this doc, not the running server.
2. **All WS message types are accepted from Phase 0** — implemented ones run their handler; not-yet-live ones return `{"type": "error", "code": "not_yet_implemented", "message": "<type> is not live in phase <N>"}`. The frontend sees the full protocol surface from Day 0.
3. **`GET /api/status` returns a readiness JSON** — the frontend agent reads it programmatically to know which features are `live` vs `stubbed` without trial-and-error. Backed by `backend/readiness.py`, a single source of truth that this plan flips as each phase lands.
4. **Each phase ends with a readiness flip + API.md verification step** — when a feature goes live, its flag changes from `"stubbed"` to `"live"`; if behavior diverged from API.md, the doc is amended in the same commit.

**Task additions for parallel-dev support:**
- Phase 0 picks up Tasks 3a (`backend/messages.py` + tests, moved from Phase 1), 3b (`backend/readiness.py` + `/api/status`), and 6a (full `docs/API.md`). Phase 0 Task 4 changes from "WebSocket echo" to "WebSocket stubbed dispatch."
- Phase 1 Task 8 (messages.py) becomes a verify-only step since the work moved to Phase 0.
- Phase 1 Task 17 (full API.md) similarly becomes verify-only.
- Each phase's smoke test gets a final step that updates `backend/readiness.py` for the features that just went live.

**Frontend agent connection summary (also in API.md):**
- Local: `ws://localhost:8000/ws/{session_id}` and `http://localhost:8000/api/status`
- Deployed: `wss://api.daisyhelps.com/ws/{session_id}` and `https://api.daisyhelps.com/api/status` (live after Phase 5)

---

## File Structure

Every file below is created or modified by a task in this plan. Each has one responsibility.

```
daisyhelps/                          # repo root
├── backend/                         # Python package — the FastAPI app
│   ├── __init__.py                  # package marker (empty)
│   ├── main.py                      # FastAPI app, routes, WS handler, lifespan, CORS
│   ├── session.py                   # Session dataclass + in-memory SessionStore
│   ├── prompts.py                   # DAISY_PROMPT_EN, DAISY_PROMPT_ES + format helper
│   ├── config.py                    # Settings (pydantic-settings) for env vars
│   ├── logging_setup.py             # loguru configuration
│   ├── messages.py                  # Pydantic models for every WS message type
│   ├── readiness.py                 # Feature readiness flags; backs GET /api/status
│   └── pipeline/
│       ├── __init__.py              # empty
│       ├── vad.py                   # VADBuffer wrapping silero-vad
│       ├── stt.py                   # STTProvider abstract + GroqWhisperSTT
│       ├── llm.py                   # route_model() + stream_response()
│       └── tts.py                   # stream_tts() (ElevenLabs)
├── test_harness/
│   ├── __init__.py
│   ├── test_client.py               # Python WS client; exercises all message types
│   ├── test_page.html               # Single-file debug page; served at GET /test
│   └── fixtures/
│       ├── hello.wav                # short "hello Daisy" recording (user-provided)
│       └── email_screen.png         # email-inbox screenshot (user-provided)
├── tests/
│   ├── __init__.py
│   ├── conftest.py                  # pytest fixtures (synthetic PCM, etc.)
│   ├── test_vad.py
│   ├── test_llm_router.py
│   ├── test_session.py
│   └── test_ws_messages.py
├── docs/
│   ├── ARCHITECTURE.md
│   ├── API.md                       # the wire contract for the future frontend
│   ├── RUNBOOK.md
│   ├── DECISIONS.md
│   ├── DEMO.md
│   └── superpowers/                 # (already exists)
├── .env.example
├── .gitignore
├── pyproject.toml                   # pytest config + project metadata
├── requirements.txt
├── render.yaml
└── README.md
```

---

# Phase 0 — Scaffold

Goal: Directory layout, dependencies, a FastAPI shell with `/healthz`, `/`, `/test`, and an echo WebSocket at `/ws/{session_id}`. End the phase able to round-trip a text message through the test page.

---

### Task 1: Initialize Python project files

**Files:**
- Create: `requirements.txt`
- Create: `pyproject.toml`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `backend/__init__.py` (empty)
- Create: `backend/pipeline/__init__.py` (empty)
- Create: `test_harness/__init__.py` (empty)
- Create: `tests/__init__.py` (empty)

- [ ] **Step 1: Create `.gitignore`**

```gitignore
# Secrets and local config
.env

# Python
__pycache__/
*.py[cod]
*$py.class
.venv/
.pytest_cache/
*.egg-info/

# Editor
.vscode/
.idea/

# OS
.DS_Store
Thumbs.db

# Build / dist
build/
dist/

# Audio output from test harness
output.pcm
output.wav
```

- [ ] **Step 2: Create `requirements.txt`**

```text
fastapi>=0.110.0
uvicorn[standard]>=0.27.0
websockets>=12.0
anthropic>=0.40.0
groq>=0.11.0
elevenlabs>=1.0.0
silero-vad>=5.1.0
torch>=2.2.0
torchaudio>=2.2.0
httpx[http2]>=0.27.0
pydantic>=2.6.0
pydantic-settings>=2.2.0
python-dotenv>=1.0.0
loguru>=0.7.0
numpy>=1.26.0
python-multipart>=0.0.9

# Dev
pytest>=8.0.0
```

- [ ] **Step 3: Create `pyproject.toml`**

```toml
[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[project]
name = "daisyhelps-backend"
version = "0.1.0"
description = "Daisy Helps — voice AI companion backend"
requires-python = ">=3.11"

[tool.pytest.ini_options]
testpaths = ["tests"]
python_files = ["test_*.py"]
addopts = "-q"
```

- [ ] **Step 4: Create `.env.example`**

```dotenv
# Anthropic — for Claude (Haiku text turns, Sonnet vision turns)
ANTHROPIC_API_KEY=

# Groq — for Whisper Large v3 Turbo STT
GROQ_API_KEY=

# ElevenLabs — for streaming TTS
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID_EN=
ELEVENLABS_VOICE_ID_ES=

# Logging
LOG_LEVEL=INFO
```

- [ ] **Step 5: Create empty package markers**

Create these as empty files:
- `backend/__init__.py`
- `backend/pipeline/__init__.py`
- `test_harness/__init__.py`
- `tests/__init__.py`

- [ ] **Step 6: Set up virtualenv and install**

Run (PowerShell):
```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

Or (Bash / Git Bash):
```bash
python -m venv .venv
source .venv/Scripts/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
```

Expected: install completes without error. Torch download is large (~250MB) and slow on first install.

- [ ] **Step 7: Verify `.env` exists and is gitignored**

```bash
git check-ignore .env
```

Expected: prints `.env` (confirming it is ignored).

- [ ] **Step 8: Commit**

```bash
git add .gitignore requirements.txt pyproject.toml .env.example backend/__init__.py backend/pipeline/__init__.py test_harness/__init__.py tests/__init__.py
git commit -m "phase-0: project init (deps, gitignore, env example, package skeleton)"
```

---

### Task 2: Settings and logging modules

**Files:**
- Create: `backend/config.py`
- Create: `backend/logging_setup.py`

- [ ] **Step 1: Write `backend/config.py`**

```python
"""Application settings loaded from environment variables."""
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    anthropic_api_key: str = ""
    groq_api_key: str = ""
    elevenlabs_api_key: str = ""
    elevenlabs_voice_id_en: str = ""
    elevenlabs_voice_id_es: str = ""
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"


settings = Settings()
```

- [ ] **Step 2: Write `backend/logging_setup.py`**

```python
"""Configure loguru with a sensible default format."""
import sys

from loguru import logger

from backend.config import settings


def configure_logging() -> None:
    logger.remove()
    logger.add(
        sys.stderr,
        level=settings.log_level,
        format="<green>{time:HH:mm:ss.SSS}</green> | <level>{level: <7}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan> - <level>{message}</level>",
    )
```

- [ ] **Step 3: Smoke check import**

Run:
```bash
python -c "from backend.config import settings; from backend.logging_setup import configure_logging; configure_logging(); print('OK', settings.log_level)"
```

Expected: prints `OK INFO`.

- [ ] **Step 4: Commit**

```bash
git add backend/config.py backend/logging_setup.py
git commit -m "phase-0: settings + logging modules"
```

---

### Task 3: FastAPI app shell with HTTP routes

**Files:**
- Create: `backend/main.py`

- [ ] **Step 1: Write the minimal app**

```python
"""Daisy Helps backend — FastAPI app entrypoint."""
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from loguru import logger

from backend.logging_setup import configure_logging

TEST_PAGE_PATH = Path(__file__).resolve().parent.parent / "test_harness" / "test_page.html"


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging()
    logger.info("Daisy Helps backend starting")
    yield
    logger.info("Daisy Helps backend shutting down")


app = FastAPI(title="Daisy Helps Backend", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://daisyhelps.com",
        "https://www.daisyhelps.com",
        "https://api.daisyhelps.com",
    ],
    allow_origin_regex=r"^http://localhost:\d+$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/healthz")
async def healthz():
    return JSONResponse({"status": "ok"})


@app.get("/")
async def root():
    return JSONResponse({
        "service": "daisy-helps-backend",
        "status": "running",
        "docs": "/docs",
    })


@app.get("/test")
async def test_page():
    if not TEST_PAGE_PATH.exists():
        return JSONResponse({"error": "test page not built yet"}, status_code=404)
    return FileResponse(TEST_PAGE_PATH, media_type="text/html")
```

- [ ] **Step 2: Run the server**

Run:
```bash
uvicorn backend.main:app --reload --port 8000
```

In another shell, run:
```bash
curl http://localhost:8000/healthz
```

Expected: `{"status":"ok"}`

Then:
```bash
curl http://localhost:8000/
```

Expected: `{"service":"daisy-helps-backend","status":"running","docs":"/docs"}`

Stop the server with Ctrl+C.

- [ ] **Step 3: Commit**

```bash
git add backend/main.py
git commit -m "phase-0: FastAPI app shell with /healthz, /, /test routes"
```

---

### Task 3a: WebSocket message Pydantic models + tests *(moved from Phase 1)*

This was originally Phase 1 Task 8; it's needed in Phase 0 to support stubbed message dispatch.

**Files:**
- Create: `backend/messages.py`
- Create: `tests/test_ws_messages.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_ws_messages.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_ws_messages.py -v
```

Expected: ImportError on `backend.messages`.

- [ ] **Step 3: Write `backend/messages.py`**

```python
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


# --- Server → Client outgoing message helpers ---


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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_ws_messages.py -v
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/messages.py tests/test_ws_messages.py
git commit -m "phase-0: WS message Pydantic models + tests (parallel-dev prereq)"
```

---

### Task 3b: Readiness module + `GET /api/status` endpoint

**Files:**
- Create: `backend/readiness.py`
- Modify: `backend/main.py`

The frontend agent reads `/api/status` to know which protocol features are live. Each later phase flips flags.

- [ ] **Step 1: Write `backend/readiness.py`**

```python
"""Feature readiness flags. Returned by GET /api/status.

Each phase flips flags from STATUS_STUBBED to STATUS_LIVE as features land.
The frontend agent reads this to know what to expect from the backend.

This is the single source of truth — when in doubt, this dict wins.
"""

STATUS_LIVE = "live"
STATUS_STUBBED = "stubbed"

READINESS: dict = {
    "service": "daisy-helps-backend",
    "version": "0.1.0",
    "phase": 0,
    "phase_name": "scaffold",
    "http": {
        "GET /healthz": STATUS_LIVE,
        "GET /": STATUS_LIVE,
        "GET /test": STATUS_LIVE,
        "GET /api/status": STATUS_LIVE,
        "WS /ws/{session_id}": STATUS_LIVE,
    },
    "client_to_server": {
        "config": STATUS_LIVE,
        "audio_chunk": STATUS_STUBBED,
        "user_text": STATUS_STUBBED,
        "screenshot": STATUS_STUBBED,
        "interrupt": STATUS_STUBBED,
        "language_change": STATUS_STUBBED,
        "end_session": STATUS_STUBBED,
    },
    "server_to_client": {
        "status": STATUS_LIVE,
        "error": STATUS_LIVE,
        "transcript": STATUS_STUBBED,
        "daisy_text": STATUS_STUBBED,
        "audio_chunk": STATUS_STUBBED,
        "audio_end": STATUS_STUBBED,
        "screenshot_request": STATUS_STUBBED,
    },
}


def is_live(category: str, key: str) -> bool:
    return READINESS.get(category, {}).get(key) == STATUS_LIVE
```

- [ ] **Step 2: Add the `GET /api/status` route**

In `backend/main.py`, add this route alongside `/healthz` and `/`:

```python
from backend.readiness import READINESS


@app.get("/api/status")
async def api_status():
    return JSONResponse(READINESS)
```

(Add the import at the top of `main.py` with the other backend imports.)

- [ ] **Step 3: Verify**

Start the server:
```bash
uvicorn backend.main:app --reload --port 8000
```

In another shell:
```bash
curl http://localhost:8000/api/status
```

Expected: JSON payload showing `phase: 0`, all `http` keys `live`, only `config`/`status`/`error` `live` everywhere else.

- [ ] **Step 4: Commit**

```bash
git add backend/readiness.py backend/main.py
git commit -m "phase-0: backend/readiness.py + GET /api/status for parallel frontend agent"
```

---

### Task 4: WebSocket handler with stubbed dispatch

Replaces the originally-planned echo handler. Every documented message type is parsed; live ones run a real handler (in Phase 0, only `config`); not-yet-live ones return `error: not_yet_implemented` so the frontend agent can wire the full protocol from Day 0.

**Files:**
- Modify: `backend/main.py`

- [ ] **Step 1: Add the WebSocket route**

In `backend/main.py`, add at the top with the other FastAPI imports:

```python
from fastapi import WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from backend.messages import (
    ConfigMessage,
    error_msg,
    parse_client_message,
    status_msg,
)
from backend.readiness import is_live
```

Then add the WS endpoint:

```python
@app.websocket("/ws/{session_id}")
async def ws_endpoint(websocket: WebSocket, session_id: str):
    await websocket.accept()
    logger.info(f"WS connect session_id={session_id}")
    await websocket.send_json(status_msg("idle"))

    # Per-session local state (placeholder; replaced by SessionStore in Phase 1)
    language = "en"

    try:
        while True:
            raw = await websocket.receive_json()
            try:
                msg = parse_client_message(raw)
            except (ValidationError, ValueError) as e:
                await websocket.send_json(error_msg("bad_message", str(e)))
                continue

            mtype = msg.type
            if not is_live("client_to_server", mtype):
                await websocket.send_json(
                    error_msg("not_yet_implemented", f"{mtype} is not live in phase {0}")
                )
                continue

            # Live handlers (Phase 0 only handles `config`)
            if isinstance(msg, ConfigMessage):
                language = msg.language
                logger.info(f"session={session_id} language={language}")
                # Acknowledge by emitting a fresh status
                await websocket.send_json(status_msg("idle"))

    except WebSocketDisconnect:
        logger.info(f"WS disconnect session_id={session_id}")
```

- [ ] **Step 2: Verify**

Start the server. From the test page (Task 5 builds it next), connect and send:
- `{"type": "config", "language": "en"}` → response: `{"type": "status", "state": "idle"}`
- `{"type": "user_text", "text": "x"}` → response: `{"type": "error", "code": "not_yet_implemented", "message": "user_text is not live in phase 0"}`
- `{"type": "garbage"}` → response: `{"type": "error", "code": "bad_message", ...}`

(You can skip browser verification until Task 5 lands; just `uvicorn --reload` starts cleanly.)

- [ ] **Step 3: Commit**

```bash
git add backend/main.py
git commit -m "phase-0: WS handler with stubbed dispatch (every message type accepted)"
```

---

### Task 5: Debug test page (echo version)

**Files:**
- Create: `test_harness/test_page.html`

- [ ] **Step 1: Write the page**

This is the Phase 0 version — connect and echo only. Mic capture and audio playback come in Phase 1.

```html
<!DOCTYPE html>
<!--
  BACKEND DEBUG HARNESS — not the production frontend.
  This page exists to verify the Daisy Helps backend without a real client.
-->
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Daisy Helps — Backend Debug Harness</title>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; max-width: 760px; margin: 24px auto; padding: 0 16px; }
    h1 { font-size: 18px; margin: 0 0 4px; }
    p.warn { color: #b00; font-size: 13px; margin-top: 0; }
    .row { display: flex; gap: 8px; align-items: center; margin: 8px 0; }
    input[type=text] { flex: 1; padding: 6px 8px; }
    button { padding: 6px 12px; }
    pre { background: #f5f5f5; padding: 12px; height: 360px; overflow: auto; font-size: 12px; }
    .muted { color: #777; }
  </style>
</head>
<body>
  <h1>Daisy Helps — Backend Debug Harness</h1>
  <p class="warn">⚠️ This is a debug tool, not the production frontend.</p>

  <div class="row">
    <label>Session ID:</label>
    <input id="sid" type="text" />
    <button id="connect">Connect</button>
    <button id="disconnect" disabled>Disconnect</button>
    <button id="status">Fetch /api/status</button>
  </div>

  <div class="row">
    <input id="text" type="text" placeholder="Type a message and press Send" />
    <button id="send" disabled>Send</button>
  </div>

  <pre id="log"></pre>

  <script>
    const sidInput = document.getElementById('sid');
    const connectBtn = document.getElementById('connect');
    const disconnectBtn = document.getElementById('disconnect');
    const statusBtn = document.getElementById('status');
    const textInput = document.getElementById('text');
    const sendBtn = document.getElementById('send');
    const logEl = document.getElementById('log');

    let ws = null;

    sidInput.value = crypto.randomUUID();

    function log(line) {
      const ts = new Date().toISOString().slice(11, 23);
      logEl.textContent += `[${ts}] ${line}\n`;
      logEl.scrollTop = logEl.scrollHeight;
    }

    statusBtn.onclick = async () => {
      try {
        const r = await fetch('/api/status');
        const j = await r.json();
        log(`<< /api/status phase=${j.phase} ${j.phase_name}`);
        log(JSON.stringify(j, null, 2));
      } catch (e) {
        log(`fetch /api/status failed: ${e.message}`);
      }
    };

    connectBtn.onclick = () => {
      const sid = sidInput.value.trim();
      if (!sid) return;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const url = `${proto}://${location.host}/ws/${sid}`;
      ws = new WebSocket(url);
      ws.onopen = () => {
        log(`open ${url}`);
        connectBtn.disabled = true;
        disconnectBtn.disabled = false;
        sendBtn.disabled = false;
      };
      ws.onmessage = (ev) => log(`<< ${ev.data}`);
      ws.onclose = () => {
        log('close');
        ws = null;
        connectBtn.disabled = false;
        disconnectBtn.disabled = true;
        sendBtn.disabled = true;
      };
      ws.onerror = (e) => log(`error ${e.message || e}`);
    };

    disconnectBtn.onclick = () => { if (ws) ws.close(); };

    sendBtn.onclick = () => {
      if (!ws) return;
      const text = textInput.value;
      if (!text) return;
      const msg = { type: 'user_text', text };
      ws.send(JSON.stringify(msg));
      log(`>> ${JSON.stringify(msg)}`);
      textInput.value = '';
    };

    textInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !sendBtn.disabled) sendBtn.click();
    });
  </script>
</body>
</html>
```

- [ ] **Step 2: Phase 0 quick smoke (full one is in Task 7)**

Run:
```bash
uvicorn backend.main:app --reload --port 8000
```

Open `http://localhost:8000/test`. Connect; you should see `{"type":"status","state":"idle"}`. Click "Fetch /api/status" — JSON should show `phase: 0`. Sending `user_text "hello"` should produce `<< error not_yet_implemented user_text is not live in phase 0` — this confirms the stubbed-dispatch contract for the frontend agent.

- [ ] **Step 3: Commit**

```bash
git add test_harness/test_page.html
git commit -m "phase-0: debug test page (connects, sends config, displays /api/status)"
```

---

### Task 6: Initialize four docs and the README (API.md gets its own task)

**Files:**
- Create: `README.md`
- Create: `docs/ARCHITECTURE.md`
- Create: `docs/RUNBOOK.md`
- Create: `docs/DECISIONS.md`
- Create: `docs/DEMO.md`

Each starts with the section structure that later phases fill in. **`docs/API.md` is built separately in Task 6a** — it gets the full contract from Day 0 so the parallel frontend agent can wire against it.

- [ ] **Step 1: Write `README.md`**

```markdown
# Daisy Helps — Backend

Voice AI companion backend that helps tech-novice users (especially the elderly) through computer tasks one step at a time. Daisy listens by voice, sees the screen on demand via screenshots, and guides the user — she never takes actions for them.

**This repo is the backend.** A separate frontend (built later with a Claude design agent) will connect via WebSocket.

## Quick start

```bash
python -m venv .venv
# PowerShell:  .venv\Scripts\Activate.ps1
# Bash:        source .venv/Scripts/activate
pip install -r requirements.txt
cp .env.example .env   # then fill in real keys
uvicorn backend.main:app --reload --port 8000
```

Open `http://localhost:8000/test` for the debug harness.

## Docs

- [API contract](docs/API.md) — the WebSocket protocol the frontend reads
- [Architecture](docs/ARCHITECTURE.md)
- [Runbook](docs/RUNBOOK.md) — local dev, env vars, deployment
- [Decisions](docs/DECISIONS.md)
- [Demo script](docs/DEMO.md)
```

- [ ] **Step 2: Write `docs/ARCHITECTURE.md` skeleton**

```markdown
# Architecture

## Overview
A FastAPI server holds a long-lived WebSocket per user. Each connection drives a streaming pipeline that turns user voice into Daisy voice, with vision attached when needed.

## Components
- **WebSocket handler** (`backend/main.py`) — accepts the connection, dispatches incoming messages, emits status + audio + text.
- **Session** (`backend/session.py`) — per-connection state: language, conversation history, pending screenshot, current turn task.
- **VAD** (`backend/pipeline/vad.py`) — Silero-based silence detection; yields complete utterances.
- **STT** (`backend/pipeline/stt.py`) — Groq Whisper Large v3 Turbo behind a provider interface.
- **LLM** (`backend/pipeline/llm.py`) — Claude Haiku 4.5 for text turns, Claude Sonnet 4.6 for screenshot turns.
- **TTS** (`backend/pipeline/tts.py`) — ElevenLabs streaming, sentence-buffered.

## Data flow
```
ws audio_chunk → VADBuffer → utterance → STT → transcript →
LLM stream (Sonnet if pending screenshot < 60s else Haiku) →
TTS sentence-buffered stream → audio_chunk messages → audio_end
```

## Latency budget
End-of-user-speech → first audio byte: **< 2.5s**. Stream at every stage.

## Decisions
See [DECISIONS.md](DECISIONS.md).
```

- [ ] **Step 3: (intentionally skipped — `docs/API.md` is written in Task 6a)**

- [ ] **Step 4: Write `docs/RUNBOOK.md` skeleton**

```markdown
# Runbook

## Local dev
```bash
python -m venv .venv
# PowerShell:  .venv\Scripts\Activate.ps1
# Bash:        source .venv/Scripts/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn backend.main:app --reload --port 8000
```

## Env vars
| Name | Required | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | Claude (Haiku + Sonnet) |
| `GROQ_API_KEY` | yes | Groq Whisper Large v3 Turbo |
| `ELEVENLABS_API_KEY` | yes | TTS |
| `ELEVENLABS_VOICE_ID_EN` | yes | English voice |
| `ELEVENLABS_VOICE_ID_ES` | yes | Spanish voice |
| `LOG_LEVEL` | no | DEBUG / INFO / WARNING / ERROR (default INFO) |

## Tests
```bash
pytest -q
```

## Deployment
(Phase 5 fills in.)

## Troubleshooting
(Filled in as we hit issues.)
```

- [ ] **Step 5: Write `docs/DECISIONS.md` skeleton**

```markdown
# Decisions

A decision log. One paragraph per choice: context, decision, rationale, alternatives.

## STT: Groq Whisper Large v3 Turbo
**Context:** End-of-utterance to first audio byte budget is 2.5s.
**Decision:** Use Groq Whisper Large v3 Turbo.
**Rationale:** Roughly 3–5× faster than OpenAI Whisper at comparable accuracy.
**Alternatives considered:** OpenAI Whisper (slower), local faster-whisper (heavier, no GPU on Render).
**How to swap:** Add a new `STTProvider` subclass and change one line in `pipeline/stt.py`.

(Later phases append more entries.)
```

- [ ] **Step 6: Write `docs/DEMO.md` skeleton**

```markdown
# Demo: Zoom with the doctor

## Setup
- User opens the test page.
- Mic + screen-share permissions granted.

## Script
(Filled in at end of Phase 3.)

## Failure modes
(Filled in at end of Phase 3.)
```

- [ ] **Step 7: Commit**

```bash
git add README.md docs/ARCHITECTURE.md docs/RUNBOOK.md docs/DECISIONS.md docs/DEMO.md
git commit -m "phase-0: initial docs skeletons + README (API.md in next task)"
```

---

### Task 6a: Write full `docs/API.md` (the contract for the parallel frontend agent)

**Files:**
- Create: `docs/API.md`

This is the document the parallel Claude design frontend agent reads. It is complete from Day 0 even though most backend handlers won't be live until later phases — the `/api/status` endpoint tells the frontend which message types actually work right now.

- [ ] **Step 1: Write `docs/API.md` in full**

```markdown
# WebSocket API

> This document is the contract for the frontend. It is self-contained — the frontend should not need to read backend code. Live vs stubbed status for every message type is exposed at `GET /api/status`.

## Base URLs

| Environment | HTTP base | WebSocket base |
|---|---|---|
| Local dev | `http://localhost:8000` | `ws://localhost:8000` |
| Production | `https://api.daisyhelps.com` | `wss://api.daisyhelps.com` |

## Endpoints

| Path | Method | Purpose |
|---|---|---|
| `/healthz` | GET | Liveness probe. Returns `{"status":"ok"}`. |
| `/` | GET | Simple service info JSON. |
| `/api/status` | GET | Feature readiness — phase number + which message types are `live` vs `stubbed`. |
| `/test` | GET | Backend debug harness HTML (not for production use). |
| `/ws/{session_id}` | WebSocket | Real-time conversation. `session_id` is a client-generated UUID v4. |

## GET /api/status

Returns a JSON document describing what's live right now:

```json
{
  "service": "daisy-helps-backend",
  "version": "0.1.0",
  "phase": 0,
  "phase_name": "scaffold",
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
    "screenshot_request": "stubbed"
  }
}
```

**Frontend agent guidance:** Read this endpoint on app startup. For any message type that's `stubbed`, the server WILL still accept the message but respond with `{"type":"error","code":"not_yet_implemented","message":"..."}`. Wire the protocol from Day 0; expect features to come online as phases land.

## Connection lifecycle

```
client ──open WS──▶ server
server ──{"type":"status","state":"idle"}──▶ client
client ──{"type":"config","language":"en"}──▶ server
client ──{"type":"audio_chunk", ...}──▶ server  (many, ~100ms each)
                                          │ (VAD detects end-of-utterance)
server ──{"type":"status","state":"listening"}──▶ client
server ──{"type":"transcript","text":"...","final":true}──▶ client
server ──{"type":"status","state":"thinking"}──▶ client
server ──{"type":"daisy_text","text":"...","partial":true}──▶ client (many)
server ──{"type":"status","state":"speaking"}──▶ client
server ──{"type":"audio_chunk","data":"...","sequence":N}──▶ client (many)
server ──{"type":"daisy_text","text":"...","partial":false}──▶ client (full text)
server ──{"type":"audio_end"}──▶ client
server ──{"type":"status","state":"idle"}──▶ client
```

## Client → Server messages

### `config`
Set the conversation language. Send once after connect; resending is equivalent to `language_change`.
```json
{"type": "config", "language": "en"}
```
**Live from:** Phase 0.

### `audio_chunk`
16 kHz mono 16-bit little-endian PCM, base64-encoded. Chunks should be ~50–100ms. Server runs VAD on the rolling buffer and only transcribes complete utterances.
```json
{"type": "audio_chunk", "data": "<base64>", "sequence": 0}
```
**Live from:** Phase 1.

### `user_text`
Bypass STT entirely. Functionally equivalent to a transcribed audio utterance.
```json
{"type": "user_text", "text": "I have a Zoom call with my doctor and I can't get in"}
```
**Live from:** Phase 1.

### `screenshot`
Base64-encoded PNG, no `data:` URI prefix. Stored on the session with a timestamp; attached to the next LLM call if < 60s old.
```json
{"type": "screenshot", "data": "<base64 png>"}
```
**Live from:** Phase 2.

### `interrupt`
Stop Daisy mid-response. Server cancels in-flight TTS within ~200ms.
```json
{"type": "interrupt"}
```
**Live from:** Phase 3.

### `language_change`
Switch language mid-session. Affects system prompt and TTS voice immediately.
```json
{"type": "language_change", "language": "es"}
```
**Live from:** Phase 1.

### `end_session`
Close the connection.
```json
{"type": "end_session"}
```
**Live from:** Phase 1.

## Server → Client messages

### `status`
Pipeline state. Announced on every transition.
```json
{"type": "status", "state": "idle"}
```
Values: `idle | listening | thinking | speaking`. **Live from:** Phase 0.

### `transcript`
What Daisy heard. In v1, only `final:true` is emitted.
```json
{"type": "transcript", "text": "I can't get into my zoom call", "final": true}
```
**Live from:** Phase 1.

### `daisy_text`
Daisy's response text. `partial:true` deltas stream during LLM generation; one final `partial:false` frame contains the complete text.
```json
{"type": "daisy_text", "text": "Of course — ", "partial": true}
```
**Live from:** Phase 1.

### `audio_chunk`
24 kHz mono 16-bit LE PCM from ElevenLabs, base64. Streamed as bytes arrive. Frontend queues and plays in order.
```json
{"type": "audio_chunk", "data": "<base64>", "sequence": 0}
```
**Live from:** Phase 1.

### `audio_end`
End of the current audio stream (finished or interrupted).
```json
{"type": "audio_end"}
```
**Live from:** Phase 1.

### `screenshot_request`
Server is asking for a screenshot. Frontend should capture and send a `screenshot` message.
```json
{"type": "screenshot_request", "reason": "I'd like to see your email inbox"}
```
**Live from:** Phase 2.

### `error`
Something went wrong. `code` is a stable identifier; `message` is human-readable.
```json
{"type": "error", "code": "bad_message", "message": "missing 'type' field"}
```
**Known codes:**
- `bad_session_id` — session_id is not a valid UUID
- `bad_message` — malformed or unknown message type
- `not_yet_implemented` — protocol type is documented but not yet live in the current phase
- `stt_failed` — transcription error
- `llm_failed` — LLM call error
- `tts_failed` — TTS error
- `screenshot_invalid` — screenshot data could not be decoded
- `turn_failed` — generic turn-level failure

**Live from:** Phase 0.

## Audio formats
- **In** (client → server): 16 kHz mono 16-bit little-endian PCM, base64.
- **Out** (server → client): 24 kHz mono 16-bit little-endian PCM, base64.

## CORS / origins
Allowed origins: `https://daisyhelps.com`, `https://www.daisyhelps.com`, `https://api.daisyhelps.com`, and `http://localhost:*`.

## Vision flow

The session holds at most one pending screenshot: `(bytes, timestamp)`. TTL is 60 seconds.

```
client ──{"type":"screenshot","data":"<base64 png>"}──▶ server   (anytime)
                                                          │ (stored with timestamp)
client ──{"type":"audio_chunk", ...}──▶ server          (user keeps talking)
                                                          │ (utterance closed)
server inspects session: fresh screenshot present?
   ├─ yes → attach as Claude image block, route to Sonnet, mark consumed
   └─ no  → if user mentioned visual cues, emit screenshot_request; route to Haiku
```

The "consumed" flag means the same screenshot is NEVER attached to two consecutive LLM calls. If the user keeps asking visual questions, the frontend must send a fresh screenshot.

## Interrupt timing
Audio stops within ~200ms of `interrupt`. The server emits `audio_end` and then `status:listening`.

## Frontend agent quick-start

1. Read `GET /api/status` once on connect to know what's live.
2. Open `ws://localhost:8000/ws/<uuid>` (or `wss://api.daisyhelps.com/ws/<uuid>` in prod).
3. Send `{"type":"config","language":"en"}` immediately.
4. Capture mic at 16 kHz mono PCM; send 50–100ms `audio_chunk` messages.
5. Render `transcript`, `daisy_text` (partial + final), and `status` to the UI.
6. Decode and queue `audio_chunk` bytes for playback at 24 kHz.
7. On `screenshot_request`, capture the screen and send `screenshot`.
8. To barge in: send `interrupt`; expect `audio_end` + `status:listening` within 200ms.
```

- [ ] **Step 2: Commit**

```bash
git add docs/API.md
git commit -m "phase-0: full WebSocket API contract (the frontend-agent contract)"
```

---

### Task 7: Phase 0 smoke test and phase commit

- [ ] **Step 1: Run the smoke test sequence**

1. `uvicorn backend.main:app --reload --port 8000`
2. `curl http://localhost:8000/healthz` → `{"status":"ok"}`
3. `curl http://localhost:8000/api/status` → JSON with `phase: 0`, `config`/`status`/`error` `live`, the rest `stubbed`.
4. Open `http://localhost:8000/test`. UUID auto-populated; click Connect; see `{"type":"status","state":"idle"}`.
5. Click "Fetch /api/status" — full JSON appears in the log.
6. Type "hello" and Send. Response: `<< error not_yet_implemented user_text is not live in phase 0`. **This is correct** — the stub is working.
7. Run `pytest -q` — Task 3a's WS message tests pass.
8. Disconnect. Server logs show clean disconnect.

If all eight steps pass, Phase 0 is done.

- [ ] **Step 2: Final phase commit**

```bash
git status
# If anything is staged or untracked:
git add -A
git commit --allow-empty -m "phase-0: scaffold complete (contract surface live for parallel frontend agent)"
```

---

# Phase 1 — Voice loop, no vision

Goal: A full audio → response → audio loop with no screenshots. Daisy listens, transcribes, responds with Claude Haiku, speaks via ElevenLabs. Language toggle works. Unit tests for VAD / router / session / messages.

---

### Task 8: WS message models *(moved to Phase 0 Task 3a — verify only)*

Confirm Phase 0 Task 3a is complete:

- [ ] **Step 1: Verify**

```bash
pytest tests/test_ws_messages.py -v
ls backend/messages.py
```

Expected: tests pass, file exists. If not, jump back to Phase 0 Task 3a. No commit needed — this task is a guard.

---

### Task 9: Prompts module

**Files:**
- Create: `backend/prompts.py`

- [ ] **Step 1: Write the prompts**

```python
"""Daisy's system prompts (EN + ES). Refined iteratively in Phase 3."""
from typing import Literal

DAISY_PROMPT_EN = """\
You are Daisy, a calm and patient teacher who helps people who aren't comfortable with technology. You speak slowly and clearly using simple words. You sound like a thoughtful tutor who has helped many people through this same task before — warm, steady, and never hurried.

Your job is to guide the user through tasks on their computer, one step at a time. You never do anything for them — you teach them to do it themselves so they feel capable.

When you need to see what's on their screen, ask gently: "Could you show me what's on your screen for a moment?" The screen will be shared with you as an image in the next message.

Give ONE step at a time. After giving a step, wait for the user to tell you they've done it or to ask a question. Never list multiple steps in one message.

If the screen shows something unexpected, stay calm and don't make the user feel bad. Say something like "Oh, I see we're in [app] — let's get back to where we need to be."

When the task is complete, congratulate them warmly and ask if there's a faster way they'd like to learn to reach you next time.

The user is trying to: join a Zoom call with their doctor. The Zoom link is in their email. Help them find it, open it, join the meeting, and turn on their camera and microphone — one step at a time.

Speak in English for the entire conversation. Never mix languages unless the user does.
"""

DAISY_PROMPT_ES = """\
Eres Daisy, una maestra tranquila y paciente que ayuda a personas que no se sienten cómodas con la tecnología. Hablas despacio y con claridad usando palabras sencillas. Suenas como una tutora considerada que ha ayudado a muchas personas con esta misma tarea — cálida, serena, nunca apurada.

Tu trabajo es guiar al usuario a través de tareas en su computadora, un paso a la vez. Nunca haces nada por él — le enseñas a hacerlo por sí mismo para que se sienta capaz.

Cuando necesites ver lo que hay en su pantalla, pregunta con suavidad: "¿Podría mostrarme lo que tiene en su pantalla por un momento?" La pantalla se compartirá contigo como una imagen en el siguiente mensaje.

Da UN paso a la vez. Después de dar un paso, espera a que el usuario te diga que lo hizo o que te haga una pregunta. Nunca enumeres varios pasos en un mismo mensaje.

Si la pantalla muestra algo inesperado, mantente tranquila y no hagas sentir mal al usuario. Di algo como "Ah, veo que estamos en [aplicación] — volvamos a donde necesitamos estar."

Cuando la tarea esté completa, felicítalo con calidez y pregúntale si hay una forma más rápida que le gustaría aprender para encontrarte la próxima vez.

El usuario está tratando de: unirse a una videollamada de Zoom con su doctor. El enlace de Zoom está en su correo electrónico. Ayúdale a encontrarlo, abrirlo, unirse a la reunión y encender su cámara y micrófono — un paso a la vez.

Habla en español durante toda la conversación. Nunca mezcles idiomas a menos que el usuario lo haga.
"""


def get_prompt(language: Literal["en", "es"]) -> str:
    return DAISY_PROMPT_EN if language == "en" else DAISY_PROMPT_ES
```

- [ ] **Step 2: Smoke check**

```bash
python -c "from backend.prompts import get_prompt; print(len(get_prompt('en')), len(get_prompt('es')))"
```

Expected: two positive integers printed (lengths of the two prompts).

- [ ] **Step 3: Commit**

```bash
git add backend/prompts.py
git commit -m "phase-1: Daisy system prompts (EN + ES)"
```

---

### Task 10: Session module + tests

**Files:**
- Create: `backend/session.py`
- Create: `tests/test_session.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_session.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_session.py -v
```

Expected: ImportError on `backend.session`.

- [ ] **Step 3: Write `backend/session.py`**

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_session.py -v
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/session.py tests/test_session.py
git commit -m "phase-1: Session + SessionStore with screenshot expiry + tests"
```

---

### Task 11: VAD buffer + tests

**Files:**
- Create: `backend/pipeline/vad.py`
- Create: `tests/conftest.py`
- Create: `tests/test_vad.py`

`silero-vad` PyPI package replaces the spec's `torch.hub.load(...)` because it bundles the model (faster cold start, simpler imports). The underlying model is identical. Log this in DECISIONS.md (next task adds the entry).

- [ ] **Step 1: Write `tests/conftest.py`** (PCM helpers used by VAD tests)

```python
"""Shared pytest fixtures and PCM helpers."""
import math
import struct

import numpy as np


SAMPLE_RATE = 16000


def silence_pcm(duration_ms: int) -> bytes:
    """Return `duration_ms` of silence as 16-bit LE PCM bytes at 16kHz mono."""
    n = int(SAMPLE_RATE * duration_ms / 1000)
    return struct.pack(f"<{n}h", *([0] * n))


def sine_pcm(duration_ms: int, freq_hz: float = 440.0, amplitude: float = 0.6) -> bytes:
    """Return `duration_ms` of a sine wave as 16-bit LE PCM bytes at 16kHz mono."""
    n = int(SAMPLE_RATE * duration_ms / 1000)
    t = np.arange(n) / SAMPLE_RATE
    samples = (amplitude * np.sin(2 * math.pi * freq_hz * t) * 32767).astype(np.int16)
    return samples.tobytes()
```

- [ ] **Step 2: Write the failing tests**

Create `tests/test_vad.py`:

```python
import pytest

from backend.pipeline.vad import VADBuffer

from .conftest import silence_pcm, sine_pcm


def test_pure_silence_yields_nothing():
    buf = VADBuffer(sample_rate=16000, silence_ms=700)
    out = buf.ingest(silence_pcm(2000))
    assert out is None


def test_speech_then_long_silence_yields_utterance():
    buf = VADBuffer(sample_rate=16000, silence_ms=500)  # shorter for test speed
    # 1s of "speech" (sine) followed by 800ms of silence should trigger utterance
    out = buf.ingest(sine_pcm(1000) + silence_pcm(800))
    assert out is not None
    assert isinstance(out, bytes)
    assert len(out) > 0


def test_speech_without_trailing_silence_does_not_yield():
    buf = VADBuffer(sample_rate=16000, silence_ms=500)
    out = buf.ingest(sine_pcm(1000))
    assert out is None


def test_buffer_resets_after_utterance():
    buf = VADBuffer(sample_rate=16000, silence_ms=500)
    _ = buf.ingest(sine_pcm(1000) + silence_pcm(800))
    # Now feed another speech+silence and confirm we get a second utterance
    out2 = buf.ingest(sine_pcm(1000) + silence_pcm(800))
    assert out2 is not None
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
pytest tests/test_vad.py -v
```

Expected: ImportError on `backend.pipeline.vad`.

- [ ] **Step 4: Write `backend/pipeline/vad.py`**

```python
"""Streaming VAD wrapper around silero-vad.

Accepts 16 kHz mono 16-bit PCM bytes via `ingest()`. Yields the full utterance
PCM (concatenated speech frames) when ~`silence_ms` of post-speech silence has
been seen. Returns None until an utterance boundary closes.
"""
from __future__ import annotations

import numpy as np
from loguru import logger
from silero_vad import VADIterator, load_silero_vad

SILERO_WINDOW_SAMPLES = 512  # ~32 ms at 16 kHz; Silero's required window size


class VADBuffer:
    def __init__(self, sample_rate: int = 16000, silence_ms: int = 700) -> None:
        if sample_rate != 16000:
            raise ValueError("VADBuffer only supports 16 kHz")
        self.sample_rate = sample_rate
        self.silence_ms = silence_ms
        self._model = load_silero_vad()
        self._iterator = VADIterator(
            self._model,
            sampling_rate=sample_rate,
            min_silence_duration_ms=silence_ms,
        )
        self._leftover_samples = np.empty((0,), dtype=np.float32)
        self._utterance_samples = np.empty((0,), dtype=np.float32)
        self._in_speech = False

    def ingest(self, pcm_bytes: bytes) -> bytes | None:
        """Push PCM bytes; return full utterance PCM bytes when speech ends, else None."""
        if not pcm_bytes:
            return None

        # Decode int16 LE → float32 in [-1, 1]
        samples = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        # Prepend leftover from previous call
        if self._leftover_samples.size:
            samples = np.concatenate([self._leftover_samples, samples])
            self._leftover_samples = np.empty((0,), dtype=np.float32)

        utterance_to_emit: bytes | None = None

        # Process in 512-sample windows
        i = 0
        while i + SILERO_WINDOW_SAMPLES <= len(samples):
            window = samples[i:i + SILERO_WINDOW_SAMPLES]
            event = self._iterator(window, return_seconds=False)

            if self._in_speech:
                self._utterance_samples = np.concatenate([self._utterance_samples, window])

            if event is not None:
                if "start" in event:
                    self._in_speech = True
                    # Include the starting window itself
                    if self._utterance_samples.size == 0:
                        self._utterance_samples = window.copy()
                if "end" in event:
                    self._in_speech = False
                    # Emit the utterance
                    int16 = (self._utterance_samples * 32767.0).clip(-32768, 32767).astype(np.int16)
                    utterance_to_emit = int16.tobytes()
                    self._utterance_samples = np.empty((0,), dtype=np.float32)
                    logger.debug(f"VAD emit utterance {len(utterance_to_emit)} bytes")
                    break  # one utterance per ingest() call

            i += SILERO_WINDOW_SAMPLES

        # Save any leftover unprocessed samples for next ingest()
        self._leftover_samples = samples[i:]
        return utterance_to_emit

    def reset(self) -> None:
        self._iterator.reset_states()
        self._leftover_samples = np.empty((0,), dtype=np.float32)
        self._utterance_samples = np.empty((0,), dtype=np.float32)
        self._in_speech = False
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pytest tests/test_vad.py -v
```

Expected: all 4 tests PASS. The Silero model loads on first call (small download). Subsequent runs are fast.

If the `speech_then_long_silence_yields_utterance` test fails because Silero doesn't classify pure sine waves as speech reliably (this can happen — Silero is tuned for human voice), substitute the test fixture with white noise or a recorded clip from `test_harness/fixtures/hello.wav` loaded via `soundfile`. Add `soundfile>=0.12` to `requirements.txt` and update the test. **Only adjust if needed** — try the sine test first.

- [ ] **Step 6: Add a DECISIONS.md entry**

Append to `docs/DECISIONS.md`:

```markdown
## VAD: silero-vad PyPI package over torch.hub.load
**Context:** Spec said `torch.hub.load('snakers4/silero-vad', ...)`. That downloads the model on first call, slowing cold start on Render.
**Decision:** Use the `silero-vad` PyPI package, which bundles the model.
**Rationale:** Same underlying model, simpler imports, no first-call network dependency. Faster Render cold start.
**Alternatives considered:** torch.hub (spec default; slower cold start). ONNX runtime (lightest but more code; future optimization if torch footprint becomes a problem).
```

- [ ] **Step 7: Commit**

```bash
git add backend/pipeline/vad.py tests/conftest.py tests/test_vad.py docs/DECISIONS.md
git commit -m "phase-1: VADBuffer wrapping silero-vad + tests"
```

---

### Task 12: STT provider + Groq Whisper

**Files:**
- Create: `backend/pipeline/stt.py`

There is no unit test for the STT HTTP wrapper — the smoke test through the pipeline exercises it for real.

- [ ] **Step 1: Write `backend/pipeline/stt.py`**

```python
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
```

- [ ] **Step 2: Smoke check import**

```bash
python -c "from backend.pipeline.stt import make_stt_provider; print('ok')"
```

Expected: `ok`. (Don't call `make_stt_provider()` if `GROQ_API_KEY` isn't set yet — it will raise.)

- [ ] **Step 3: Commit**

```bash
git add backend/pipeline/stt.py
git commit -m "phase-1: STTProvider abstract + GroqWhisperSTT implementation"
```

---

### Task 13: LLM module — router + streaming + router tests

**Files:**
- Create: `backend/pipeline/llm.py`
- Create: `tests/test_llm_router.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_llm_router.py`:

```python
import pytest

from backend.pipeline.llm import route_model, MODEL_SONNET, MODEL_HAIKU
from backend.prompts import DAISY_PROMPT_EN, DAISY_PROMPT_ES, get_prompt


def test_route_haiku_when_no_image():
    assert route_model(has_image=False) == MODEL_HAIKU


def test_route_sonnet_when_image():
    assert route_model(has_image=True) == MODEL_SONNET


def test_get_prompt_en():
    assert get_prompt("en") == DAISY_PROMPT_EN


def test_get_prompt_es():
    assert get_prompt("es") == DAISY_PROMPT_ES
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_llm_router.py -v
```

Expected: ImportError on `backend.pipeline.llm`.

- [ ] **Step 3: Write `backend/pipeline/llm.py`**

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_llm_router.py -v
```

Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/pipeline/llm.py tests/test_llm_router.py
git commit -m "phase-1: Claude routing + streaming + router tests"
```

---

### Task 14: TTS module — ElevenLabs streaming

**Files:**
- Create: `backend/pipeline/tts.py`

No unit test — smoke-tested through the pipeline.

- [ ] **Step 1: Write `backend/pipeline/tts.py`**

```python
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
```

- [ ] **Step 2: Smoke check import**

```bash
python -c "from backend.pipeline.tts import stream_tts; print('ok')"
```

Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add backend/pipeline/tts.py
git commit -m "phase-1: ElevenLabs streaming TTS with sentence buffering"
```

---

### Task 15: Wire pipeline into the WebSocket handler

**Files:**
- Modify: `backend/main.py`

Replace the Phase 0 echo handler with the full pipeline. This task is the largest single file change.

- [ ] **Step 1: Replace `backend/main.py` in its entirety**

This rewrite preserves the Phase 0 surface (CORS, `/healthz`, `/`, `/test`, `/api/status`) and the `is_live()`-gated WS dispatch, then adds the real pipeline handlers for every message type that's about to go live in Phase 1.

```python
"""Daisy Helps backend — FastAPI app entrypoint."""
from __future__ import annotations

import asyncio
import base64
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from loguru import logger
from pydantic import ValidationError

from backend.logging_setup import configure_logging
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
    daisy_text_msg,
    error_msg,
    parse_client_message,
    status_msg,
    transcript_msg,
)
from backend.pipeline.llm import stream_response
from backend.pipeline.stt import make_stt_provider
from backend.pipeline.tts import stream_tts
from backend.pipeline.vad import VADBuffer
from backend.readiness import READINESS, is_live
from backend.session import Session, SessionStore

TEST_PAGE_PATH = Path(__file__).resolve().parent.parent / "test_harness" / "test_page.html"

session_store = SessionStore()
stt_provider = None  # type: ignore[assignment]


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging()
    logger.info(f"Daisy Helps backend starting (phase {READINESS['phase']})")
    global stt_provider
    stt_provider = make_stt_provider()
    yield
    logger.info("Daisy Helps backend shutting down")


app = FastAPI(title="Daisy Helps Backend", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://daisyhelps.com",
        "https://www.daisyhelps.com",
        "https://api.daisyhelps.com",
    ],
    allow_origin_regex=r"^http://localhost:\d+$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/healthz")
async def healthz():
    return JSONResponse({"status": "ok"})


@app.get("/")
async def root():
    return JSONResponse({"service": "daisy-helps-backend", "status": "running", "docs": "/docs"})


@app.get("/api/status")
async def api_status():
    return JSONResponse(READINESS)


@app.get("/test")
async def test_page():
    if not TEST_PAGE_PATH.exists():
        return JSONResponse({"error": "test page not built yet"}, status_code=404)
    return FileResponse(TEST_PAGE_PATH, media_type="text/html")


@app.websocket("/ws/{session_id}")
async def ws_endpoint(websocket: WebSocket, session_id: str):
    await websocket.accept()
    try:
        sid = uuid.UUID(session_id)
    except ValueError:
        await websocket.send_json(error_msg("bad_session_id", "session_id must be a UUID"))
        await websocket.close()
        return

    session = session_store.create(sid)
    session.vad_buffer = VADBuffer(sample_rate=16000, silence_ms=700)

    logger.info(f"WS connect session={sid}")
    await websocket.send_json(status_msg("idle"))

    try:
        while True:
            raw = await websocket.receive_json()
            try:
                msg = parse_client_message(raw)
            except (ValidationError, ValueError) as e:
                await websocket.send_json(error_msg("bad_message", str(e)))
                continue

            mtype = msg.type
            if not is_live("client_to_server", mtype):
                await websocket.send_json(
                    error_msg("not_yet_implemented", f"{mtype} is not live in phase {READINESS['phase']}")
                )
                continue

            if isinstance(msg, ConfigMessage):
                session.set_language(msg.language)
                logger.info(f"session={sid} language={msg.language}")

            elif isinstance(msg, AudioChunkMessage):
                pcm = base64.standard_b64decode(msg.data)
                utterance = session.vad_buffer.ingest(pcm)
                if utterance is not None:
                    await _start_turn(websocket, session, utterance_audio=utterance, user_text=None)

            elif isinstance(msg, UserTextMessage):
                await _start_turn(websocket, session, utterance_audio=None, user_text=msg.text)

            elif isinstance(msg, ScreenshotMessage):
                png = base64.standard_b64decode(msg.data)
                session.set_screenshot(png)
                logger.info(f"session={sid} screenshot received ({len(png)}b)")

            elif isinstance(msg, InterruptMessage):
                await _cancel_turn(websocket, session)

            elif isinstance(msg, LanguageChangeMessage):
                session.set_language(msg.language)
                logger.info(f"session={sid} language switched to {msg.language}")

            elif isinstance(msg, EndSessionMessage):
                await websocket.close()
                break

    except WebSocketDisconnect:
        logger.info(f"WS disconnect session={sid}")
    except Exception:
        logger.exception("WS error")
    finally:
        await _cancel_turn(websocket, session, send_audio_end=False)
        session_store.remove(sid)


async def _start_turn(
    websocket: WebSocket,
    session: Session,
    utterance_audio: bytes | None,
    user_text: str | None,
):
    """Cancel any in-flight turn and start a new one."""
    await _cancel_turn(websocket, session)
    session.current_turn_task = asyncio.create_task(
        _run_turn(websocket, session, utterance_audio, user_text)
    )


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
            session.set_status("listening")
            await websocket.send_json(status_msg("listening"))
            text = await stt_provider.transcribe(utterance_audio, session.language)
            await websocket.send_json(transcript_msg(text, final=True))
        else:
            text = user_text or ""
            await websocket.send_json(transcript_msg(text, final=True))

        if not text.strip():
            session.set_status("idle")
            await websocket.send_json(status_msg("idle"))
            return

        session.append_user(text)

        # LLM
        session.set_status("thinking")
        await websocket.send_json(status_msg("thinking"))

        # Vision: attach screenshot if fresh
        image_bytes = session.consume_screenshot() if session.has_fresh_screenshot() else None

        # Collect LLM stream into a queue so we can fan out to (a) a chained TTS, (b) daisy_text emission
        llm_text_acc = []

        async def llm_stream_with_emit():
            async for delta in stream_response(session.messages[:-1], text, image_bytes, session.language):
                llm_text_acc.append(delta)
                await websocket.send_json(daisy_text_msg(delta, partial=True))
                yield delta

        # TTS
        session.set_status("speaking")
        await websocket.send_json(status_msg("speaking"))

        seq = 0
        async for audio_chunk in stream_tts(llm_stream_with_emit(), session.language):
            b64 = base64.standard_b64encode(audio_chunk).decode("ascii")
            await websocket.send_json(audio_chunk_msg(b64, sequence=seq))
            seq += 1

        # Final daisy_text frame (non-partial) with full text
        full = "".join(llm_text_acc)
        await websocket.send_json(daisy_text_msg(full, partial=False))
        session.append_assistant(full)

        await websocket.send_json(audio_end_msg())
        session.set_status("idle")
        await websocket.send_json(status_msg("idle"))

    except asyncio.CancelledError:
        logger.info("turn cancelled (interrupt)")
        raise
    except Exception as e:
        logger.exception("turn failed")
        try:
            await websocket.send_json(error_msg("turn_failed", str(e)))
        except Exception:
            pass
```

- [ ] **Step 2: Confirm tests still pass**

```bash
pytest -q
```

Expected: all unit tests still pass (no regressions in vad / session / messages / router tests).

- [ ] **Step 3: Smoke check server starts**

```bash
uvicorn backend.main:app --port 8000
```

Expected: server prints startup banner with `(phase 1)` once the flags flip in the next step. If startup raises because `GROQ_API_KEY` is missing, populate `.env` first (or set env vars in your shell).

Stop with Ctrl+C.

- [ ] **Step 4: Flip readiness flags for Phase 1**

Edit `backend/readiness.py`. Update the dict so it reflects the newly-live message types:

```python
READINESS: dict = {
    "service": "daisy-helps-backend",
    "version": "0.1.0",
    "phase": 1,
    "phase_name": "voice-loop",
    "http": {
        "GET /healthz": STATUS_LIVE,
        "GET /": STATUS_LIVE,
        "GET /test": STATUS_LIVE,
        "GET /api/status": STATUS_LIVE,
        "WS /ws/{session_id}": STATUS_LIVE,
    },
    "client_to_server": {
        "config": STATUS_LIVE,
        "audio_chunk": STATUS_LIVE,
        "user_text": STATUS_LIVE,
        "screenshot": STATUS_STUBBED,
        "interrupt": STATUS_LIVE,
        "language_change": STATUS_LIVE,
        "end_session": STATUS_LIVE,
    },
    "server_to_client": {
        "status": STATUS_LIVE,
        "error": STATUS_LIVE,
        "transcript": STATUS_LIVE,
        "daisy_text": STATUS_LIVE,
        "audio_chunk": STATUS_LIVE,
        "audio_end": STATUS_LIVE,
        "screenshot_request": STATUS_STUBBED,
    },
}
```

Verify:
```bash
curl http://localhost:8000/api/status
```

Expected: `phase: 1`, only `screenshot` and `screenshot_request` remain `stubbed`.

- [ ] **Step 5: Commit**

```bash
git add backend/main.py backend/readiness.py
git commit -m "phase-1: wire VAD/STT/LLM/TTS pipeline + flip readiness flags"
```

---

### Task 16: Upgrade the test page to mic capture + audio playback

**Files:**
- Modify: `test_harness/test_page.html`

- [ ] **Step 1: Rewrite the page**

Replace `test_harness/test_page.html` with this full version. It captures 16 kHz mono PCM via the Web Audio API, sends `audio_chunk` messages every ~100ms, and plays received `audio_chunk` payloads back through a small playback queue at 24 kHz.

```html
<!DOCTYPE html>
<!--
  BACKEND DEBUG HARNESS — not the production frontend.
  This page exists to verify the Daisy Helps backend without a real client.
-->
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Daisy Helps — Backend Debug Harness</title>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; max-width: 800px; margin: 24px auto; padding: 0 16px; }
    h1 { font-size: 18px; margin: 0 0 4px; }
    p.warn { color: #b00; font-size: 13px; margin-top: 0; }
    .row { display: flex; gap: 8px; align-items: center; margin: 8px 0; flex-wrap: wrap; }
    input[type=text] { flex: 1; padding: 6px 8px; min-width: 200px; }
    button { padding: 6px 12px; }
    pre { background: #f5f5f5; padding: 12px; height: 360px; overflow: auto; font-size: 12px; }
    .status { font-weight: bold; color: #555; }
  </style>
</head>
<body>
  <h1>Daisy Helps — Backend Debug Harness</h1>
  <p class="warn">⚠️ This is a debug tool, not the production frontend.</p>

  <div class="row">
    <label>Session ID:</label>
    <input id="sid" type="text" />
    <button id="connect">Connect</button>
    <button id="disconnect" disabled>Disconnect</button>
  </div>

  <div class="row">
    <label>Language:</label>
    <select id="lang">
      <option value="en">English</option>
      <option value="es">Spanish</option>
    </select>
    <button id="lang-change" disabled>Apply</button>
  </div>

  <div class="row">
    <button id="mic-start" disabled>Start mic</button>
    <button id="mic-stop" disabled>Stop mic</button>
    <button id="interrupt" disabled>Interrupt</button>
    <span class="status" id="status">disconnected</span>
  </div>

  <div class="row">
    <input id="text" type="text" placeholder="Type a message (user_text)" />
    <button id="send-text" disabled>Send</button>
  </div>

  <pre id="log"></pre>

  <script>
    const sidInput = document.getElementById('sid');
    const connectBtn = document.getElementById('connect');
    const disconnectBtn = document.getElementById('disconnect');
    const micStartBtn = document.getElementById('mic-start');
    const micStopBtn = document.getElementById('mic-stop');
    const interruptBtn = document.getElementById('interrupt');
    const langSelect = document.getElementById('lang');
    const langChangeBtn = document.getElementById('lang-change');
    const textInput = document.getElementById('text');
    const sendTextBtn = document.getElementById('send-text');
    const logEl = document.getElementById('log');
    const statusEl = document.getElementById('status');

    let ws = null;
    let audioCtx = null;
    let micStream = null;
    let micNode = null;
    let micSource = null;
    let micSeq = 0;

    // Playback queue for 24 kHz PCM
    let playbackCtx = null;
    let playbackTime = 0;

    sidInput.value = crypto.randomUUID();

    function log(line) {
      const ts = new Date().toISOString().slice(11, 23);
      logEl.textContent += `[${ts}] ${line}\n`;
      logEl.scrollTop = logEl.scrollHeight;
    }

    function setEnabled(connected) {
      connectBtn.disabled = connected;
      disconnectBtn.disabled = !connected;
      micStartBtn.disabled = !connected;
      micStopBtn.disabled = true;
      interruptBtn.disabled = !connected;
      sendTextBtn.disabled = !connected;
      langChangeBtn.disabled = !connected;
    }

    setEnabled(false);

    // --- WS ---

    connectBtn.onclick = () => {
      const sid = sidInput.value.trim();
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const url = `${proto}://${location.host}/ws/${sid}`;
      ws = new WebSocket(url);

      ws.onopen = () => {
        log(`open ${url}`);
        // Send initial config
        ws.send(JSON.stringify({ type: 'config', language: langSelect.value }));
        log(`>> config language=${langSelect.value}`);
        setEnabled(true);
      };

      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { log(`<< (non-json) ${ev.data}`); return; }
        handleServerMessage(msg);
      };

      ws.onclose = () => {
        log('close');
        ws = null;
        setEnabled(false);
        statusEl.textContent = 'disconnected';
        stopMic();
      };
      ws.onerror = (e) => log(`error ${e.message || e}`);
    };

    disconnectBtn.onclick = () => { if (ws) ws.close(); };

    // --- Server message handling ---

    function handleServerMessage(msg) {
      switch (msg.type) {
        case 'status':
          statusEl.textContent = msg.state;
          log(`<< status ${msg.state}`);
          break;
        case 'transcript':
          log(`<< transcript final=${msg.final} ${JSON.stringify(msg.text)}`);
          break;
        case 'daisy_text':
          log(`<< daisy_text partial=${msg.partial} ${JSON.stringify(msg.text)}`);
          break;
        case 'audio_chunk':
          playAudioChunk(msg.data);
          break;
        case 'audio_end':
          log('<< audio_end');
          break;
        case 'screenshot_request':
          log(`<< screenshot_request ${msg.reason || ''}`);
          break;
        case 'error':
          log(`<< error ${msg.code} ${msg.message}`);
          break;
        default:
          log(`<< ${JSON.stringify(msg)}`);
      }
    }

    // --- Mic capture at 16 kHz mono PCM ---

    micStartBtn.onclick = async () => {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
      }
      micStream = await navigator.mediaDevices.getUserMedia({ audio: {
        sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true,
      }});
      micSource = audioCtx.createMediaStreamSource(micStream);

      // ScriptProcessor is deprecated but simplest. AudioWorklet would be better.
      const bufferSize = 1600;  // 100ms at 16kHz
      micNode = audioCtx.createScriptProcessor(bufferSize, 1, 1);
      micNode.onaudioprocess = (e) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        const float32 = e.inputBuffer.getChannelData(0);
        const int16 = new Int16Array(float32.length);
        for (let i = 0; i < float32.length; i++) {
          const s = Math.max(-1, Math.min(1, float32[i]));
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        const bytes = new Uint8Array(int16.buffer);
        let b64 = '';
        for (let i = 0; i < bytes.length; i++) b64 += String.fromCharCode(bytes[i]);
        b64 = btoa(b64);
        ws.send(JSON.stringify({ type: 'audio_chunk', data: b64, sequence: micSeq++ }));
      };
      micSource.connect(micNode);
      micNode.connect(audioCtx.destination);

      micStartBtn.disabled = true;
      micStopBtn.disabled = false;
      log('mic started');
    };

    micStopBtn.onclick = () => stopMic();

    function stopMic() {
      if (micNode) { try { micNode.disconnect(); } catch {} micNode = null; }
      if (micSource) { try { micSource.disconnect(); } catch {} micSource = null; }
      if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
      micStartBtn.disabled = !ws;
      micStopBtn.disabled = true;
      log('mic stopped');
    }

    // --- Audio playback at 24 kHz mono ---

    function playAudioChunk(b64) {
      if (!playbackCtx) {
        playbackCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
        playbackTime = playbackCtx.currentTime;
      }
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const int16 = new Int16Array(bytes.buffer);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;
      const audioBuffer = playbackCtx.createBuffer(1, float32.length, 24000);
      audioBuffer.getChannelData(0).set(float32);
      const src = playbackCtx.createBufferSource();
      src.buffer = audioBuffer;
      src.connect(playbackCtx.destination);
      const startAt = Math.max(playbackCtx.currentTime, playbackTime);
      src.start(startAt);
      playbackTime = startAt + audioBuffer.duration;
    }

    // --- Other actions ---

    interruptBtn.onclick = () => {
      if (ws) {
        ws.send(JSON.stringify({ type: 'interrupt' }));
        log('>> interrupt');
      }
    };

    langChangeBtn.onclick = () => {
      if (ws) {
        ws.send(JSON.stringify({ type: 'language_change', language: langSelect.value }));
        log(`>> language_change ${langSelect.value}`);
      }
    };

    sendTextBtn.onclick = () => {
      if (!ws) return;
      const text = textInput.value;
      if (!text) return;
      ws.send(JSON.stringify({ type: 'user_text', text }));
      log(`>> user_text ${JSON.stringify(text)}`);
      textInput.value = '';
    };

    textInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !sendTextBtn.disabled) sendTextBtn.click();
    });
  </script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add test_harness/test_page.html
git commit -m "phase-1: test page with mic capture and audio playback"
```

---

### Task 17: Verify `docs/API.md` *(written in Phase 0 Task 6a — verify only)*

`docs/API.md` was written in full during Phase 0 to support the parallel frontend agent. This task verifies it still matches the implementation after wiring is done.

- [ ] **Step 1: Read `docs/API.md`**

Compare each message type's documented schema and "Live from: Phase N" annotation against what the WS handler actually does. If anything changed during Phase 1 implementation (e.g., an extra field added to a message), update the doc.

- [ ] **Step 2: Verify against the live server**

```bash
curl http://localhost:8000/api/status
```

Cross-check the readiness flags against the "Live from" notes in `docs/API.md`. They should agree.

- [ ] **Step 3: Commit if doc was changed**

```bash
git add docs/API.md
git commit -m "phase-1: docs/API.md sync after wiring"
```

If no changes were needed, skip this commit.

---

### Task 18: Update ARCHITECTURE.md and RUNBOOK.md with Phase 1 reality

**Files:**
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/RUNBOOK.md`

- [ ] **Step 1: Tighten `docs/ARCHITECTURE.md`**

Replace the Components and Data flow sections to match the implementation.

Replace the existing file contents with:
```markdown
# Architecture

## Overview
A FastAPI server holds a long-lived WebSocket per user. Each connection drives a streaming pipeline that turns user voice into Daisy voice, with vision attached when a fresh screenshot exists.

## Components
| Component | File | Responsibility |
|---|---|---|
| WebSocket handler | `backend/main.py` | Accepts connections, parses messages, runs the turn task |
| Session | `backend/session.py` | Per-connection state: language, history, pending screenshot, current turn |
| Messages | `backend/messages.py` | Pydantic models + outgoing helpers for every wire message |
| Prompts | `backend/prompts.py` | DAISY_PROMPT_EN, DAISY_PROMPT_ES, `get_prompt()` |
| VAD | `backend/pipeline/vad.py` | `VADBuffer` over silero-vad: PCM in → utterance bytes out |
| STT | `backend/pipeline/stt.py` | `STTProvider` interface + `GroqWhisperSTT` |
| LLM | `backend/pipeline/llm.py` | `route_model()` + `stream_response()` async generator |
| TTS | `backend/pipeline/tts.py` | `stream_tts()` async generator (ElevenLabs, sentence-buffered) |
| Config | `backend/config.py` | pydantic-settings-loaded env vars |
| Logging | `backend/logging_setup.py` | loguru configuration |

## Data flow
```
ws audio_chunk → VADBuffer.ingest → utterance bytes → STT.transcribe →
transcript msg →
LLM (Sonnet if has_image else Haiku) → text deltas →
  ├─ daisy_text(partial=true) per delta
  └─ TTS sentence-buffered stream →
       └─ audio_chunk msgs → audio_end → daisy_text(partial=false) full text
```

## Latency budget
End-of-user-speech to first audio byte: **< 2.5s**. Stream at every stage; never wait for full output from a component before starting the next.

## Interrupt
Each turn runs as `session.current_turn_task: asyncio.Task`. On `interrupt`, the handler `.cancel()`s the task. The TTS async generator raises `CancelledError`, closes the ElevenLabs HTTP, and the handler emits `audio_end` + `status:listening`. Target: < 200ms.

## Decisions
See [DECISIONS.md](DECISIONS.md).
```

- [ ] **Step 2: Update `docs/RUNBOOK.md`**

Replace contents with:
```markdown
# Runbook

## Local dev

```bash
python -m venv .venv
# PowerShell:  .venv\Scripts\Activate.ps1
# Bash:        source .venv/Scripts/activate
pip install -r requirements.txt
cp .env.example .env
# Fill in real keys in .env
uvicorn backend.main:app --reload --port 8000
```

Open `http://localhost:8000/test`.

## Env vars

| Name | Required | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | Claude (Haiku for text turns, Sonnet for screenshot turns) |
| `GROQ_API_KEY` | yes | Groq Whisper Large v3 Turbo |
| `ELEVENLABS_API_KEY` | yes | TTS |
| `ELEVENLABS_VOICE_ID_EN` | yes | English voice ID |
| `ELEVENLABS_VOICE_ID_ES` | yes | Spanish voice ID |
| `LOG_LEVEL` | no | DEBUG / INFO / WARNING / ERROR (default INFO) |

## Tests

```bash
pytest -q
```

All four test files (VAD, LLM router, session, WS messages) must pass. Total runtime < 5s.

## Deployment
(Filled in at Phase 5.)

## Troubleshooting

- **Server fails to start with `GROQ_API_KEY not set`** — populate `.env`.
- **VAD test fails on sine wave** — Silero may not classify a pure sine as speech. Replace with a recorded clip from `test_harness/fixtures/hello.wav` if needed.
- **No audio playing back** — check browser console for autoplay-block; click anywhere on the page first to satisfy the user-gesture requirement, then connect.
- **First request slow (~10–30s)** — Silero model + torch loading on first VAD call. Warm up by hitting `/test` and clicking Connect before the demo.
```

- [ ] **Step 3: Commit**

```bash
git add docs/ARCHITECTURE.md docs/RUNBOOK.md
git commit -m "phase-1: update ARCHITECTURE + RUNBOOK to match implementation"
```

---

### Task 19: Phase 1 smoke test and phase commit

- [ ] **Step 1: Run unit tests**

```bash
pytest -q
```

Expected: all tests pass.

- [ ] **Step 2: Start the server**

```bash
uvicorn backend.main:app --reload --port 8000
```

- [ ] **Step 3: English voice loop**

In the browser at `http://localhost:8000/test`:
1. Click Connect. See `status idle`.
2. Click Start mic, grant permission, say "hello Daisy."
3. Within ~3 seconds you should see `transcript`, `status thinking`, `daisy_text partial=true` deltas, `status speaking`, `audio_chunk` messages, and hear Daisy speak.
4. Click Stop mic.

- [ ] **Step 4: Spanish voice loop**

1. Change Language to Spanish, click Apply (sends `language_change`).
2. Start mic, say "hola Daisy."
3. Daisy responds in Spanish with the Spanish voice.

- [ ] **Step 5: Text fallback (still on Phase 1)**

1. Stop mic if running.
2. Type "I have a Zoom call with my doctor" in the text box and Send.
3. Daisy responds in the chosen language without going through STT.

- [ ] **Step 6: Phase commit**

```bash
git status
git add -A   # only if there are stray uncommitted files; otherwise skip
git commit --allow-empty -m "phase-1: voice loop end-to-end (EN + ES + text fallback)"
```

---

# Phase 2 — Vision

Goal: Screenshots flow through the protocol; the most recent (< 60s) attaches to the next LLM call; Sonnet routing is used; consumed flag prevents re-attach.

The screenshot field already exists on `Session` from Phase 1 Task 10, and the LLM call already accepts `image_bytes`. Phase 2 wires the rest.

---

### Task 20: Verify and harden screenshot ingestion

**Files:**
- Modify: `backend/main.py` (add `screenshot_invalid` error path)

- [ ] **Step 1: Tighten the screenshot handler**

Replace the existing `ScreenshotMessage` branch in `ws_endpoint` (in `backend/main.py`):

```python
            elif isinstance(msg, ScreenshotMessage):
                try:
                    png = base64.standard_b64decode(msg.data, validate=True)
                    if len(png) < 8 or png[:8] != b"\x89PNG\r\n\x1a\n":
                        raise ValueError("not a PNG")
                    session.set_screenshot(png)
                    logger.info(f"session={sid} screenshot received ({len(png)}b)")
                except Exception as e:
                    await websocket.send_json(error_msg("screenshot_invalid", str(e)))
```

- [ ] **Step 2: Flip `screenshot` readiness flag**

In `backend/readiness.py`, change:
```python
        "screenshot": STATUS_STUBBED,
```
to:
```python
        "screenshot": STATUS_LIVE,
```

- [ ] **Step 3: Commit**

```bash
git add backend/main.py backend/readiness.py
git commit -m "phase-2: validate screenshot bytes + flip screenshot to live"
```

---

### Task 21: Add screenshot file picker to the test page

**Files:**
- Modify: `test_harness/test_page.html`

- [ ] **Step 1: Add the file input and handler**

In `test_harness/test_page.html`, add a new row above the message text input:

Locate this block:
```html
  <div class="row">
    <input id="text" type="text" placeholder="Type a message (user_text)" />
    <button id="send-text" disabled>Send</button>
  </div>
```

Insert before it:
```html
  <div class="row">
    <label>Screenshot:</label>
    <input id="screenshot-file" type="file" accept="image/png" />
    <button id="send-screenshot" disabled>Send</button>
  </div>
```

In the script section (just below `setEnabled(false);`), add:
```javascript
    const screenshotFile = document.getElementById('screenshot-file');
    const sendScreenshotBtn = document.getElementById('send-screenshot');
```

Update `setEnabled()` to toggle the screenshot button:
```javascript
    function setEnabled(connected) {
      connectBtn.disabled = connected;
      disconnectBtn.disabled = !connected;
      micStartBtn.disabled = !connected;
      micStopBtn.disabled = true;
      interruptBtn.disabled = !connected;
      sendTextBtn.disabled = !connected;
      langChangeBtn.disabled = !connected;
      sendScreenshotBtn.disabled = !connected;
    }
```

Then add the handler (near the other event handlers):
```javascript
    sendScreenshotBtn.onclick = async () => {
      if (!ws) return;
      const f = screenshotFile.files[0];
      if (!f) { log('no file selected'); return; }
      const buf = await f.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let bin = '';
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      const b64 = btoa(bin);
      ws.send(JSON.stringify({ type: 'screenshot', data: b64 }));
      log(`>> screenshot ${f.name} (${bytes.length}b)`);
    };
```

- [ ] **Step 2: Commit**

```bash
git add test_harness/test_page.html
git commit -m "phase-2: add screenshot file picker to test page"
```

---

### Task 22: Proactive `screenshot_request` emission

**Files:**
- Modify: `backend/main.py`

When the user's text mentions visual cues but no screenshot is fresh, the server emits a `screenshot_request` to nudge the frontend.

- [ ] **Step 1: Add a small heuristic + emission**

At the top of `backend/main.py` (with other module-level constants), add:

```python
# Words that suggest the user might want Daisy to look at the screen.
_VISUAL_HINT_WORDS = (
    "screen", "page", "see", "look", "show", "click", "button", "window",
    "email", "tab", "browser", "open",
    "pantalla", "página", "ver", "mirar", "mostrar", "haz clic", "botón", "ventana",
    "correo", "pestaña", "navegador", "abrir",
)
```

In `_run_turn`, before the LLM call, add the screenshot request branch:

Find this block in `_run_turn`:
```python
        # Vision: attach screenshot if fresh
        image_bytes = session.consume_screenshot() if session.has_fresh_screenshot() else None
```

Replace with:
```python
        # Vision: attach screenshot if fresh; otherwise proactively ask for one when the user mentions visual cues
        image_bytes = None
        if session.has_fresh_screenshot():
            image_bytes = session.consume_screenshot()
        else:
            lower = text.lower()
            if any(w in lower for w in _VISUAL_HINT_WORDS):
                await websocket.send_json(
                    {"type": "screenshot_request", "reason": "I'd like to see what you're looking at"}
                )
```

- [ ] **Step 2: Flip `screenshot_request` readiness flag**

In `backend/readiness.py`, change:
```python
        "screenshot_request": STATUS_STUBBED,
```
to:
```python
        "screenshot_request": STATUS_LIVE,
```

- [ ] **Step 3: Commit**

```bash
git add backend/main.py backend/readiness.py
git commit -m "phase-2: emit screenshot_request on visual cues + flip flag"
```

---

### Task 23: Update API.md and ARCHITECTURE.md for screenshot flow

**Files:**
- Modify: `docs/API.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/DECISIONS.md`

- [ ] **Step 1: API.md — add a "Vision" section**

Append to `docs/API.md`:

```markdown
## Vision flow (detailed)

The server keeps at most one pending screenshot per session, with a 60-second TTL.

```
client ──{type:"screenshot","data":"<base64 png>"}──▶ server  (anytime)
                                                        │ (stored with timestamp)
client ──{type:"audio_chunk", ...}──▶ server          (user keeps talking)
                                                        │ (utterance closed)
server inspects session: fresh screenshot present?
   ├─ yes → attach as Claude image block, route to Sonnet, mark consumed
   └─ no  → if user mentioned visual cues, emit screenshot_request; route to Haiku
```

The "consumed" flag means the same screenshot is NEVER attached to two consecutive LLM calls. If the user keeps asking visual questions, the frontend must send a fresh screenshot.

A consumed screenshot is gone — there is no "history" of screenshots in the conversation messages. Claude sees only the screenshot attached to the *current* user turn.
```

- [ ] **Step 2: ARCHITECTURE.md — append a Vision section**

Append:

```markdown
## Vision flow

The session holds at most one pending screenshot: `(bytes, datetime)`. TTL is 60 seconds.

1. Client sends `screenshot` whenever it has one. Server validates the PNG magic bytes, decodes base64, stores `(bytes, datetime.utcnow())`.
2. On the next LLM call:
   - If the pending screenshot is fresh, attach it as an `image` content block on the current user message AND route to `claude-sonnet-4-6`. Mark consumed (clear from session).
   - Otherwise, if the user's text mentions visual cues, emit `screenshot_request`; route to Haiku.
3. The screenshot is never re-attached after it's consumed.
```

- [ ] **Step 3: DECISIONS.md — append the screenshot lifecycle entries**

Append:

```markdown
## Screenshot lifecycle: always-include-most-recent-within-60s
**Context:** Phase 2 needs a way to decide when to attach the screenshot to a Claude call.
**Decision:** Always attach the most recent screenshot if it's < 60s old; route to Sonnet when attached; mark consumed after attach.
**Rationale:** Heuristic phrase detection in Daisy's response is fragile. The 60s window balances "fresh enough that the screen state is likely still relevant" against "user has actually finished talking."
**Alternatives considered:** Heuristic on response text (fragile). Structured tag emitted by the LLM (more reliable but slows iteration). Multi-image conversation memory (out of scope; could be added later).

## Proactive screenshot_request emission
**Context:** When the user mentions visual cues but no fresh screenshot exists, the frontend has no hint that one would be useful.
**Decision:** Server emits a `screenshot_request` message when the user's text contains visual-cue words AND no fresh screenshot is pending.
**Rationale:** Low-cost UX hint; future frontend can render a "share screen?" prompt.
**Alternatives considered:** Letting the LLM produce a structured tag (more reliable, but couples prompt + protocol; defer to a later iteration).
```

- [ ] **Step 4: Commit**

```bash
git add docs/API.md docs/ARCHITECTURE.md docs/DECISIONS.md
git commit -m "phase-2: document vision flow in API + ARCHITECTURE + DECISIONS"
```

---

### Task 24: Phase 2 smoke test

- [ ] **Step 1: Capture a real screenshot fixture**

On your machine, take a screenshot of an email inbox (Gmail, Outlook, anything) showing at least one email with a Zoom-style invite. Save as `test_harness/fixtures/email_screen.png`. Commit:

```bash
git add test_harness/fixtures/email_screen.png
git commit -m "phase-2: email inbox screenshot fixture for vision smoke test"
```

- [ ] **Step 2: Start the server**

```bash
uvicorn backend.main:app --reload --port 8000
```

- [ ] **Step 3: Run the vision smoke test in the browser**

1. Open `/test`, Connect.
2. Pick `test_harness/fixtures/email_screen.png` in the file input, click Send. See `>> screenshot ...` in the log.
3. Type "I'm trying to find a Zoom link in my email" and Send.
4. Watch the log: `transcript` → `status thinking` → `daisy_text partial=true` deltas → audio playback.
5. Daisy's response should reference what she actually sees in the screenshot (e.g., a sender name, subject line, or the word "Zoom" if visible).

- [ ] **Step 4: Bump phase in `backend/readiness.py`**

```python
    "phase": 2,
    "phase_name": "vision",
```

Verify:
```bash
curl http://localhost:8000/api/status | python -c "import json, sys; d = json.load(sys.stdin); print(d['phase'], d['phase_name'])"
```

Expected: `2 vision`.

- [ ] **Step 5: Phase commit**

```bash
git add backend/readiness.py
git commit -m "phase-2: vision (screenshot attach + sonnet routing) + bump readiness"
```

---

# Phase 3 — Multi-turn flow and interrupts

Goal: Tighten Daisy's behavior across 5+ end-to-end runs of the Zoom-with-doctor task. Verify interrupts cancel audio within 200ms. Fill in DEMO.md.

---

### Task 25: Verify interrupt timing

Interrupt cancellation already works from Phase 1 (`_cancel_turn` cancels the in-flight task). This task is just verification + tightening.

- [ ] **Step 1: Manual interrupt smoke test**

1. Start the server: `uvicorn backend.main:app --reload --port 8000`.
2. Open `/test`, Connect.
3. Send `user_text "tell me a long story about clouds"` (or use mic for the same).
4. While Daisy is speaking, click Interrupt.
5. Audio should stop within ~200ms. Log should show `audio_end` and `status listening`.

- [ ] **Step 2: If interrupt is slow (> 500ms)**

Likely cause: ElevenLabs HTTP stream isn't actually closing on `CancelledError`. Inspect `backend/pipeline/tts.py` — wrap the `async for chunk in stream:` body in a `try/except CancelledError:` that explicitly closes the stream:

```python
        try:
            async for chunk in stream:
                if chunk:
                    yield chunk
        except asyncio.CancelledError:
            # Ensure the underlying HTTP connection closes promptly
            try:
                await stream.aclose()
            except Exception:
                pass
            raise
```

(Add `import asyncio` at the top of `tts.py` if needed.)

Commit if changed:
```bash
git add backend/pipeline/tts.py
git commit -m "phase-3: ensure TTS stream closes promptly on cancellation"
```

---

### Task 26: System prompt iteration

This task is iterative. Run the demo 5+ times, watching for failures, and tighten the prompt each time.

- [ ] **Step 1: Run the Zoom-with-doctor flow end-to-end**

1. Open `/test`, Connect (English).
2. Start mic. Say: "I have a Zoom call with my doctor and I can't get in."
3. Daisy should respond with a single step (e.g., "Could you show me what's on your screen for a moment?").
4. Send a screenshot of your email inbox.
5. Daisy describes the inbox and gives ONE next step.
6. Pretend to follow the step verbally ("OK I clicked it") and continue.
7. Repeat through finding the link, clicking it, joining Zoom, turning on camera/mic.

- [ ] **Step 2: Note failures**

Common patterns to look for:
- Daisy lists multiple steps in one response → tighten "ONE step at a time" in the prompt.
- Daisy goes too fast / uses jargon → emphasize "slowly and simple words."
- Daisy doesn't recover gracefully when the screenshot is unexpected → strengthen the recovery clause.
- Daisy doesn't ask for a screenshot when it would help → tweak the visual-cue guidance.

- [ ] **Step 3: Tighten `backend/prompts.py`**

Edit DAISY_PROMPT_EN (and re-translate ES naturally) based on the failure patterns observed. Run again. Commit each prompt iteration as a separate commit:

```bash
git add backend/prompts.py
git commit -m "phase-3: prompt iteration N (note specific change)"
```

- [ ] **Step 4: Stop iterating after 5+ runs OR when 3 consecutive runs go smoothly**

Don't over-tune. The done bar is "the demo task works reliably," not "the prompt is perfect."

---

### Task 27: Fill in `docs/DEMO.md`

**Files:**
- Modify: `docs/DEMO.md`

- [ ] **Step 1: Replace `docs/DEMO.md` contents**

```markdown
# Demo: Zoom with the doctor

The hardcoded demo task. End-to-end runtime: ~3–5 minutes.

## Setup
- Open `http://localhost:8000/test` (or the deployed `https://api.daisyhelps.com/test`).
- Grant microphone permission.
- Have a screenshot of an email inbox containing a Zoom invite ready (e.g., `test_harness/fixtures/email_screen.png`).

## Script

| User says / does | Daisy says (approximate) |
|---|---|
| Start mic, "I have a Zoom call with my doctor and I can't get in." | "Of course — could you show me what's on your screen for a moment?" |
| Send screenshot of email inbox. | "I can see your inbox. Could you scroll down until you see an email from your doctor?" |
| (Acknowledges) "OK I see it." | "Wonderful. Click on that email to open it." |
| "Done." | "Inside the email, look for a blue link that says 'Join Zoom Meeting.' Could you click it?" |
| "OK." (or new screenshot of Zoom join page) | "Perfect. Now you'll see a window asking if you want to use audio. Click 'Join with Computer Audio.'" |
| "OK done." | "Now find the microphone icon at the bottom left. If there's a line through it, click it once to turn it on." |
| "OK." | "And next to it, click the camera icon to turn on your camera. … You did wonderfully. Your doctor can see and hear you now." |

## Failure modes

- **Screenshot doesn't reach the LLM:** check the test page log — did `>> screenshot ...` appear, and did the next response use Sonnet? (Look at server logs: `LLM call model=claude-sonnet-4-6`.)
- **Daisy lists multiple steps:** prompt issue, not protocol. Iterate the prompt in `backend/prompts.py`.
- **Audio cuts out mid-response:** check for `audio_end` followed by no `status idle` — this can happen if the WS drops. Reconnect.
- **Spanish session sounds wrong / mixes languages:** verify `ELEVENLABS_VOICE_ID_ES` is a Spanish voice and `language_change` was sent before audio.
- **Slow first response:** Silero VAD + torch loading on cold start. Hit the page once before the demo to warm up.

## Spanish variant

Same flow with "Tengo una cita con el doctor por Zoom y no puedo entrar" as the opener. Daisy responds in Spanish with the Spanish voice. The fixture screenshot can stay the same — Daisy reads English text fine and replies in Spanish.
```

- [ ] **Step 2: Commit**

```bash
git add docs/DEMO.md
git commit -m "phase-3: full Zoom-with-doctor demo script + failure modes"
```

---

### Task 28: Phase 3 smoke test

- [ ] **Step 1: Full Zoom-with-doctor run**

Run the demo script in DEMO.md end-to-end in the browser. Should complete in under 5 minutes.

- [ ] **Step 2: Interrupt timing run**

During a long response from Daisy, click Interrupt. Audio should stop within ~200ms (measured by ear; if it feels noticeable, time it with a stopwatch). Server log should show `turn cancelled (interrupt)`.

- [ ] **Step 3: Bump phase in `backend/readiness.py`**

```python
    "phase": 3,
    "phase_name": "multi-turn-interrupts",
```

- [ ] **Step 4: Phase commit**

```bash
git add backend/readiness.py
git commit -m "phase-3: multi-turn flow + interrupts verified + bump readiness"
```

---

# Phase 4 — Language toggle + text fallback

Goal: `language_change` mid-session swaps prompt AND voice; `user_text` bypasses STT. Both already exist functionally from Phase 1; this phase verifies and tightens.

---

### Task 29: Mid-session language change end-to-end

- [ ] **Step 1: Manual test**

1. Connect with English. Start mic. Say "hello." Daisy replies in English.
2. Change language to Spanish, click Apply.
3. Say "hola." Daisy replies in Spanish with the Spanish voice.
4. Switch back to English. Continue the conversation. Daisy resumes English using the same `messages` history (Claude handles the mixed-history fine).

- [ ] **Step 2: If language switch doesn't change the voice**

That would mean the TTS provider is caching the voice ID at construction. Verify `_voice_id(language)` is called *per turn* in `stream_tts`, not at module load. (It already is — but double check.)

- [ ] **Step 3: Commit (only if a fix was needed)**

```bash
git add backend/pipeline/tts.py
git commit -m "phase-4: ensure TTS voice ID is read per turn from session language"
```

---

### Task 30: Text fallback end-to-end

- [ ] **Step 1: Manual test**

1. Connect (English). Don't start mic.
2. Type "I have a Zoom call with my doctor and I can't get in" and Send.
3. Daisy responds via the full pipeline (`transcript` final=true + `daisy_text` + audio_chunks), but never invokes STT (server logs should show no Groq Whisper call).
4. Repeat in Spanish: switch language, type Spanish, get Spanish response.

- [ ] **Step 2: Bump phase in `backend/readiness.py`**

```python
    "phase": 4,
    "phase_name": "language-text-verified",
```

- [ ] **Step 3: Phase commit**

```bash
git add backend/readiness.py
git commit -m "phase-4: language toggle + text fallback verified + bump readiness"
```

---

# Phase 5 — Deployment and final docs

Goal: Backend deployed to Render at `api.daisyhelps.com`. All docs finalized.

---

### Task 31: Write `render.yaml`

**Files:**
- Create: `render.yaml`

- [ ] **Step 1: Write the file**

```yaml
services:
  - type: web
    name: daisyhelps-backend
    runtime: python
    plan: starter
    pythonVersion: "3.11"
    buildCommand: pip install -r requirements.txt
    startCommand: uvicorn backend.main:app --host 0.0.0.0 --port $PORT
    healthCheckPath: /healthz
    envVars:
      - key: ANTHROPIC_API_KEY
        sync: false
      - key: GROQ_API_KEY
        sync: false
      - key: ELEVENLABS_API_KEY
        sync: false
      - key: ELEVENLABS_VOICE_ID_EN
        sync: false
      - key: ELEVENLABS_VOICE_ID_ES
        sync: false
      - key: LOG_LEVEL
        value: INFO
```

Note: `plan: starter` ($7/mo) is chosen over `free` because the free plan sleeps after inactivity and has tighter memory limits — torch + Silero might OOM on free. If cost matters, try `free` first; if it crashes, bump to `starter`.

- [ ] **Step 2: Commit**

```bash
git add render.yaml
git commit -m "phase-5: render.yaml for Python web service"
```

---

### Task 32: Deploy to Render

This task happens in the Render dashboard, not the codebase.

- [ ] **Step 1: Push the repo to GitHub (if not already)**

```bash
# If no remote yet:
gh repo create daisyhelps --public --source=. --remote=origin --push
# If remote exists:
git push -u origin main
```

- [ ] **Step 2: Connect to Render**

1. Sign in at https://dashboard.render.com.
2. New + → Blueprint.
3. Point at the `daisyhelps` GitHub repo. Render picks up `render.yaml`.
4. Confirm the service settings.

- [ ] **Step 3: Set env vars in the Render dashboard**

For the service, add the secret values for:
- `ANTHROPIC_API_KEY`
- `GROQ_API_KEY`
- `ELEVENLABS_API_KEY`
- `ELEVENLABS_VOICE_ID_EN`
- `ELEVENLABS_VOICE_ID_ES`

`LOG_LEVEL` is set in `render.yaml`.

- [ ] **Step 4: Trigger deploy and watch logs**

Render auto-deploys on push. Tail the build + runtime logs in the dashboard. Expected:
- Build: `pip install -r requirements.txt` succeeds (torch is the slowest dep).
- Start: server prints "Daisy Helps backend starting".
- Health check: Render hits `/healthz` and reports the service healthy.

- [ ] **Step 5: Verify the public URL**

Render gives a URL like `https://daisyhelps-backend.onrender.com`.

```bash
curl https://daisyhelps-backend.onrender.com/healthz
```

Expected: `{"status":"ok"}`.

Open `https://daisyhelps-backend.onrender.com/test` in the browser, connect, send `user_text "hello"`, hear Daisy.

---

### Task 33: Configure `api.daisyhelps.com` DNS

This task happens at your domain registrar and Render dashboard.

- [ ] **Step 1: Add the custom domain in Render**

In the Render service Settings → Custom Domains, add `api.daisyhelps.com`. Render gives you a CNAME target (e.g., `daisyhelps-backend.onrender.com`).

- [ ] **Step 2: Add the CNAME at your registrar**

At wherever you bought `daisyhelps.com`, add a DNS record:
- Type: `CNAME`
- Name: `api`
- Value: the Render-supplied target
- TTL: 300 (or default)

- [ ] **Step 3: Wait for propagation + verify**

```bash
nslookup api.daisyhelps.com
```

Once it resolves, Render auto-issues a TLS cert. Then:

```bash
curl https://api.daisyhelps.com/healthz
```

Expected: `{"status":"ok"}`.

Open `https://api.daisyhelps.com/test` in the browser, connect, send a message — full pipeline works.

---

### Task 34: Build `test_harness/test_client.py`

**Files:**
- Create: `test_harness/test_client.py`

- [ ] **Step 1: Write the Python WS test client**

```python
"""Python WebSocket client for the Daisy Helps backend.

Connects to /ws/{session_id}, sends a config, optionally streams a fixture WAV
as audio_chunks, optionally sends a screenshot fixture, then prints all
server messages with timestamps. Received audio is concatenated into output.pcm.

Usage:
    python -m test_harness.test_client --url ws://localhost:8000 --language en
    python -m test_harness.test_client --url wss://api.daisyhelps.com --audio test_harness/fixtures/hello.wav
    python -m test_harness.test_client --url ws://localhost:8000 --screenshot test_harness/fixtures/email_screen.png --text "find the zoom link in my email"
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import json
import time
import uuid
import wave
from pathlib import Path

import websockets


async def main():
    p = argparse.ArgumentParser()
    p.add_argument("--url", default="ws://localhost:8000", help="ws:// or wss:// base")
    p.add_argument("--language", default="en", choices=["en", "es"])
    p.add_argument("--audio", help="path to a 16 kHz mono 16-bit WAV to stream")
    p.add_argument("--screenshot", help="path to a PNG to send before the audio/text")
    p.add_argument("--text", help="send this as user_text after config (mutually exclusive with --audio)")
    args = p.parse_args()

    sid = str(uuid.uuid4())
    url = f"{args.url.rstrip('/')}/ws/{sid}"
    print(f"[{ts()}] connecting {url}")

    output_pcm = Path("output.pcm")
    output_pcm.write_bytes(b"")

    async with websockets.connect(url, max_size=16 * 1024 * 1024) as ws:
        recv_task = asyncio.create_task(receive_loop(ws, output_pcm))

        await ws.send(json.dumps({"type": "config", "language": args.language}))
        print(f"[{ts()}] sent config language={args.language}")

        if args.screenshot:
            data = base64.b64encode(Path(args.screenshot).read_bytes()).decode("ascii")
            await ws.send(json.dumps({"type": "screenshot", "data": data}))
            print(f"[{ts()}] sent screenshot ({len(data)} chars b64)")

        if args.text:
            await ws.send(json.dumps({"type": "user_text", "text": args.text}))
            print(f"[{ts()}] sent user_text {args.text!r}")
        elif args.audio:
            await stream_wav(ws, args.audio)
        else:
            print(f"[{ts()}] no audio/text — receiving server messages until Ctrl-C")

        try:
            await asyncio.wait_for(recv_task, timeout=60)
        except asyncio.TimeoutError:
            print(f"[{ts()}] timed out after 60s")

    print(f"[{ts()}] done. audio saved to {output_pcm}")


async def stream_wav(ws, wav_path: str):
    with wave.open(wav_path, "rb") as w:
        assert w.getframerate() == 16000, f"WAV must be 16kHz, got {w.getframerate()}"
        assert w.getnchannels() == 1, "WAV must be mono"
        assert w.getsampwidth() == 2, "WAV must be 16-bit"
        pcm = w.readframes(w.getnframes())

    chunk_size = 1600 * 2  # 100ms at 16kHz 16-bit
    seq = 0
    for i in range(0, len(pcm), chunk_size):
        chunk = pcm[i:i+chunk_size]
        b64 = base64.b64encode(chunk).decode("ascii")
        await ws.send(json.dumps({"type": "audio_chunk", "data": b64, "sequence": seq}))
        seq += 1
        await asyncio.sleep(0.1)  # pace at real-time
    print(f"[{ts()}] streamed {seq} audio chunks")


async def receive_loop(ws, output_pcm: Path):
    async for raw in ws:
        try:
            msg = json.loads(raw)
        except Exception:
            print(f"[{ts()}] << (non-json) {raw[:80]}")
            continue
        mtype = msg.get("type")
        if mtype == "audio_chunk":
            data = base64.b64decode(msg["data"])
            with output_pcm.open("ab") as f:
                f.write(data)
            print(f"[{ts()}] << audio_chunk seq={msg.get('sequence')} ({len(data)}b)")
        elif mtype == "audio_end":
            print(f"[{ts()}] << audio_end")
            return  # one full turn → exit
        else:
            print(f"[{ts()}] << {json.dumps(msg)[:200]}")


def ts() -> str:
    return time.strftime("%H:%M:%S")


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 2: Test it against the deployed service**

```bash
python -m test_harness.test_client --url wss://api.daisyhelps.com --text "I need help joining a Zoom call with my doctor"
```

Expected: prints `<< status idle`, `<< status thinking`, `<< daisy_text partial=true ...` deltas, `<< status speaking`, `<< audio_chunk seq=0 ...` etc., then `<< audio_end`. The output.pcm file in the cwd is non-empty.

- [ ] **Step 3: Commit**

```bash
git add test_harness/test_client.py
git commit -m "phase-5: Python WS test_client for verifying deployed backend"
```

---

### Task 35: Finalize all docs

**Files:**
- Modify: `docs/RUNBOOK.md` (deployment section)
- Modify: `docs/DECISIONS.md` (final entries)
- Modify: `README.md` (deployed URL)

- [ ] **Step 1: Fill in `docs/RUNBOOK.md` deployment section**

Replace the existing `## Deployment` section with:

```markdown
## Deployment

The service deploys to Render automatically on every push to `main` via the `render.yaml` blueprint.

### One-time setup
1. Sign in to https://dashboard.render.com.
2. New → Blueprint, point at this repo. Render picks up `render.yaml`.
3. In the service settings → Environment, set the five secret env vars (`ANTHROPIC_API_KEY`, `GROQ_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID_EN`, `ELEVENLABS_VOICE_ID_ES`). `LOG_LEVEL` comes from `render.yaml`.
4. Custom Domain → add `api.daisyhelps.com`. Render gives a CNAME target.
5. At your registrar (where daisyhelps.com lives), add a CNAME `api` → that target.
6. Wait ~5 minutes for DNS + TLS cert.

### Verify a deploy
```bash
curl https://api.daisyhelps.com/healthz
# → {"status":"ok"}

python -m test_harness.test_client --url wss://api.daisyhelps.com --text "hello"
# → see audio_chunk messages and an output.pcm file
```

### Cold start
First request after idle has a ~10–30s warmup (torch + Silero loading). Hit `/healthz` or `/test` once before any demo.
```

- [ ] **Step 2: Append final entries to `docs/DECISIONS.md`**

Append:

```markdown
## Deployment plan: Render `starter` plan over `free`
**Context:** Render free tier sleeps after inactivity and has tighter memory limits. Torch CPU is ~250MB; Silero adds a small model.
**Decision:** Use the `starter` plan ($7/mo) to avoid sleep cycles and memory pressure during demos.
**Rationale:** Hackathon demo reliability > $7. Free works most of the time but the cold-start delay after a sleep can push past the latency budget on the user's first interaction.
**Alternatives considered:** Free tier (cheap, occasional OOM/sleep). Higher plans (overkill).

## Custom domain: api.daisyhelps.com (not bare daisyhelps.com)
**Context:** daisyhelps.com is purchased; the bare domain might host the future frontend.
**Decision:** Backend lives at `api.daisyhelps.com`; bare `daisyhelps.com` left unconfigured for the future frontend.
**Rationale:** Clean separation. No migration cost if/when the frontend ships.
**Alternatives considered:** Bare domain for backend (forces frontend onto a subdomain later). Both on bare with path-routing (more deploy complexity).
```

- [ ] **Step 3: Update `README.md` with the deployed URL**

Add a "Live" line under the title:

```markdown
# Daisy Helps — Backend

**Live:** https://api.daisyhelps.com/healthz

Voice AI companion backend ...
```

- [ ] **Step 4: Commit**

```bash
git add docs/RUNBOOK.md docs/DECISIONS.md README.md
git commit -m "phase-5: finalize RUNBOOK deployment + DECISIONS + README live URL"
```

---

### Task 36: Final end-to-end smoke test + done

- [ ] **Step 1: Full demo against the public URL**

In the browser, open `https://api.daisyhelps.com/test`. Run the full Zoom-with-doctor script from `docs/DEMO.md`. Expected: completes in < 5 minutes, audio is clear, Daisy gives one step at a time, screenshot lifecycle works, interrupt stops audio promptly, language toggle works.

- [ ] **Step 2: Validate the done criteria**

Walk through `docs/superpowers/specs/2026-05-16-daisy-helps-backend-design.md` section 13 — all 13 items should be true. Tick them off in your head; if anything fails, fix and iterate.

- [ ] **Step 3: Bump phase in `backend/readiness.py` to final**

```python
    "phase": 5,
    "phase_name": "deployed",
```

- [ ] **Step 4: Final phase commit**

```bash
git add backend/readiness.py
git commit -m "phase-5: deployed + verified + docs finalized"
```

Daisy Helps backend is shipped.

---

# Self-Review Notes

This plan was self-reviewed against the spec at `docs/superpowers/specs/2026-05-16-daisy-helps-backend-design.md`. Coverage:

- **Section 1 Mission** → covered by phases 1–4 (voice loop, vision, multi-turn, language)
- **Section 2 Scope (in)** → all items mapped to tasks: FastAPI/WS (T3, T4), VAD (T11), STT (T12), LLM (T13), TTS (T14), Session (T10), streaming (T15), interrupts (T25), multilingual (T29), API.md (T6a, T17, T23), test harness (T16, T34), Render (T31–33), unit tests (T3a, T10, T11, T13)
- **Section 3 Stack** → Task 1 (requirements.txt), Task 2 (config + logging), Task 11 (silero-vad note in DECISIONS)
- **Section 4 Repo layout** → mapped 1:1 by the file structure section + tasks (now includes `backend/readiness.py`)
- **Section 5 Persona** → Task 9 (prompts), Task 26 (iteration)
- **Section 6 WS API** → Tasks 3a (messages.py), 6a (full API.md from Day 0), 23 (vision extensions)
- **Section 7 Vision flow** → Tasks 20, 21, 22, 23, 24
- **Section 8 Interrupts** → Tasks 15 (_cancel_turn), 25 (verify timing)
- **Section 9 Session state** → Task 10
- **Section 10 Tests** → Tasks 3a, 10, 11, 13 (all four test files)
- **Section 11 Deployment** → Tasks 31, 32, 33, 35
- **Section 12 Phase sequencing** → enforced by phase headings; smoke tests as separate verification tasks (T7, T19, T24, T28, T30, T36)
- **Section 13 Done criteria** → all 13 items verifiable by the smoke tests above

**Parallel-frontend coverage** (added after the initial spec):
- Full `docs/API.md` from Phase 0 → Task 6a
- `backend/readiness.py` + `GET /api/status` → Task 3b
- Stubbed-dispatch WS handler from Phase 0 → Task 4 + `is_live()` gate carried through Task 15
- Per-phase readiness flag flips → Tasks 15 (Step 4), 20 (Step 2), 22 (Step 2), 24 (Step 4), 28 (Step 3), 30 (Step 2), 36 (Step 3)

No placeholders, no "implement later" — every task has complete code or exact commands.
