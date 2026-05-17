# CLAUDE.md

Project orientation for Claude Code (or any AI coding agent) working in this repo. Keep this file under ~200 lines; detailed material lives in `docs/` and `TODO.md`.

## What this is

**Daisy Helps** — a voice AI companion that walks tech-novice users (especially the elderly) through computer tasks one step at a time. Daisy listens by voice, sees the screen when asked, and guides — she never takes actions for the user.

This repo holds three things:
1. **`backend/`** — FastAPI + WebSocket server deployed at `api.daisyhelps.com`. Single long-lived WS per client (`/ws/{session_id}`) driving a streaming pipeline: VAD → STT → LLM (Claude Haiku/Sonnet) → TTS. Multilingual (EN + ES). Per-turn cancellation enables sub-200ms interrupts. Session state is in-memory.
2. **`desktop/`** — Electron + TypeScript Windows app users download from `daisyhelps.com`. Ports the legacy `test_harness/test_page.html` into a production UI; adds native one-click screen capture via `desktopCapturer`, system-tray support, and auto-update from GitHub Releases.
3. **`landing/`** — Static single-page site served from a Render Static Site at `daisyhelps.com`. "Download for Windows" CTA redirects to the latest GitHub Release asset.

The backend is **feature-complete through Phase 5** (voice loop, vision, multi-turn, interrupts, language toggle, text fallback, click-indicator) and deployed. Phase 6 is the desktop + landing pivot — see `docs/superpowers/specs/2026-05-16-daisy-helps-desktop-pivot-design.md`.

## Build / run / test

```bash
# Setup (one-time)
python -m venv .venv
# PowerShell:  .venv\Scripts\Activate.ps1
# Bash:        source .venv/Scripts/activate
pip install -r requirements.txt
cp .env.example .env   # then fill the 5 required keys

# Run dev server
uvicorn backend.main:app --reload --port 8000
# Open http://localhost:8000/test for the debug harness

# Unit tests (29 tests, target <5s, all green)
pytest -q
```

Required env vars: `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID_EN`, `ELEVENLABS_VOICE_ID_ES`. Optional `LOG_LEVEL` (default INFO). All loaded via `pydantic-settings` — don't read `.env` directly.

## Desktop app — build / run

```powershell
# Setup (one-time)
cd desktop
npm install

# Run from source (connects to wss://api.daisyhelps.com)
npm start

# Build Windows installer locally
npm run release
# → desktop/release/DaisyHelps-Setup.exe

# Cut a public release (CI builds and publishes to GitHub Releases)
git tag v0.1.x
git push --tags
```

## Landing page — local preview

```powershell
cd landing
python -m http.server 8080
# Open http://localhost:8080/
```

Production deploy is automatic via the Render Blueprint in `render.yaml`.

## What's been built (Phases 0–6)

| Phase | Scope | Status |
|---|---|---|
| 0 — Scaffold | FastAPI shell, `/healthz`, `/`, `/api/status`, `/test`, `/ws/{sid}` with stubbed dispatch, message Pydantic models + tests, full `docs/API.md` from Day 0 for parallel frontend dev | ✅ |
| 1 — Voice loop | Silero VAD, Groq Whisper STT, Claude Haiku, ElevenLabs streaming TTS, full `_run_turn` async pipeline in `backend/main.py`, mic + audio playback in test page, language toggle, text fallback | ✅ |
| 2 — Vision | Screenshot PNG validation, 60s TTL, Sonnet routing when image attached, consumed flag prevents re-attach, proactive `screenshot_request` on visual-cue words | ✅ |
| 3 — Multi-turn + interrupts | `current_turn_task: asyncio.Task` cancelled via `interrupt`, TTS stream `aclose()` on `CancelledError`, conversation history preserved across turns | ✅ |
| 4 — Language + text | EN↔ES voice flip per turn (verified — `_voice_id(language)` called inside `stream_tts`), `user_text` fully bypasses STT | ✅ |
| 5 — Deploy + docs | `render.yaml`, `test_harness/test_client.py`, finalized RUNBOOK + DECISIONS + README | Code ready; deploy pending |
| 6 — Desktop + landing | Electron Windows app under `desktop/`; landing site under `landing/`; CI release workflow; daisyhelps.com live | ✅ |

Five automated smokes (Phase 0–4) passed end-to-end against real Anthropic + ElevenLabs APIs. See git history for per-task commits (`phase-N:` prefix).

## Source of truth

- **Wire protocol** — `docs/API.md` (complete contract; the parallel frontend agent reads this, not backend code)
- **Feature liveness** — `backend/readiness.py` + `GET /api/status` (controls the `not_yet_implemented` gate in the WS handler)
- **Daisy's voice** — `backend/prompts.py` (`DAISY_PROMPT_EN`, `DAISY_PROMPT_ES`)
- **Why decisions were made** — `docs/DECISIONS.md`
- **Demo script** — `docs/DEMO.md`
- **Current state + remaining work** — `TODO.md`
- **Original spec / plan** — `docs/superpowers/specs/2026-05-16-daisy-helps-backend-design.md` and `docs/superpowers/plans/2026-05-16-daisy-helps-backend.md`
- **Desktop client behavior** — `desktop/src/renderer/app.ts` (WebSocket client, mic, audio playback, UI state)
- **Desktop native bridge** — `desktop/src/main.ts` (screen capture, tray, auto-update); `desktop/src/preload.ts` (renderer-exposed API surface)
- **Landing page** — `landing/index.html`

## Working conventions

- **Commits are phase-prefixed.** Use `phase-N: <what>` for backend work, `docs: <what>` for doc-only changes, `chore: <what>` for housekeeping. One logical change per commit.
- **Stage by explicit path** (`git add path/to/file`). Never `git add -A` — repo root has untracked `.env` (secrets), `rosa-claude-code-prompt.md`, and `elevenlabs-voice-prompt.md` that must stay untracked.
- **Smokes use `fastapi.testclient.TestClient`** for in-process WS + HTTP exercise. Don't background `uvicorn` for verification.
- **Unit tests in `tests/`.** Four files (VAD, LLM router, session, WS messages). All four must stay green. Add a test file when introducing a module with non-trivial logic; skip tests for thin HTTP wrappers (STT, TTS) — those are smoke-tested through the pipeline.
- **Pipeline modules** in `backend/pipeline/` follow a consistent shape: abstract interface (or pure function) + concrete impl + factory (e.g., `STTProvider` + `GroqWhisperSTT` + `make_stt_provider`).
- **Don't bump `readiness.py` ahead of behavior.** The dict is the source of truth for what's actually live; flipping a flag while the handler still raises `not_yet_implemented` will desync the parallel frontend agent.
- **`teammates push to this repo` — verify before force-pushing.** Niya Paul (UCI teammate) pushes occasionally; her commits get rebased on top of, never destroyed.
- **Desktop commits use `desktop:` prefix**, landing uses `landing:`, CI uses `ci:`. Backend keeps `phase-N:` as before.
- **The desktop app speaks the same WebSocket contract as the test harness.** Don't change one without the other — `docs/API.md` is the single contract for both.

## Known constraints / gotchas

- **Python 3.14 locally** emits two `DeprecationWarning`s: `datetime.utcnow()` in `session.py` and `torch.jit.load` from `silero-vad`. Render deploys on Python 3.11 where the torch one doesn't fire. Don't silence via `filterwarnings`; fix at source when convenient.
- **Anthropic vision API rejects 1×1 PNGs** (HTTP 400 "Could not process image"). Test fixtures need ≥128×128.
- **`base64.standard_b64decode` does NOT accept `validate=True`** — only `b64decode` does. Already fixed in the screenshot handler.
- **`session.vad_buffer: Optional[VADBuffer]`** is declared with `TYPE_CHECKING` to avoid pulling torch into every `Session` import. Don't break this pattern.
- **First WS connect loads silero-vad into memory** (~10s cold). Warm with `/healthz` or `/test` before any demo.
- **`.env` has a stray `XAI_API_KEY`** from another project — unused here, harmless, can delete.
- **`NavigEase_Requirements_Document.docx` at repo root** is from teammate Niya; for a different project but committed to this repo's history.
- **Test page uses `ScriptProcessorNode`** (deprecated Web Audio API). Works in all browsers. Future migration to `AudioWorklet` is queued (see below).
- **Desktop app uses `ScriptProcessorNode`** for mic capture (same as the test harness). Future migration to `AudioWorklet` is queued.
- **Multi-monitor screen picker** uses `nodeIntegration: true` for the small picker window — needed for the `require('electron')` call. Renderer that talks to the network stays sandboxed.
- **Code signing deferred at v1** — Windows users see a SmartScreen "Unknown publisher" warning. Landing page documents how to click through.
- **Auto-update feed lives at GitHub Releases.** electron-updater reads `latest.yml` from `releases/latest/`. If a release is in "draft" state, auto-update won't see it — publish releases via the GitHub UI or rely on CI's `--publish always` to publish directly.
- **The `landing/_redirects` file and `render.yaml`'s `routes` block both define the `/download` redirect.** Render reads `routes`; the `_redirects` file is a fallback for non-Render hosts.

## Pending work — 3 user-action items

Detailed in `TODO.md`. Summary:

1. **Deploy to Render** — Blueprint from `render.yaml`, set the 5 secret env vars in the dashboard
2. **DNS for `api.daisyhelps.com`** — CNAME at the registrar to the Render-supplied target
3. **Final smoke + `readiness.py` bump to phase 5** — runs after deploy succeeds

## Features deferred for future additions

When picking one up, here's where to start:

| Feature | Entry point |
|---|---|
| **AudioWorklet mic capture** (replaces deprecated `ScriptProcessorNode`) | `test_harness/test_page.html` — swap the `createScriptProcessor` block for an `AudioWorklet` that does the float32 → int16 conversion in the worklet thread |
| **ONNX-based Silero VAD** (cuts ~250MB torch from deploy footprint) | Replace `silero-vad` PyPI with `onnxruntime` in `backend/pipeline/vad.py`; spec section 11 has the rationale |
| **Multi-image conversation memory** (currently one screenshot, consumed once) | `Session.pending_screenshot: Optional[tuple[bytes, datetime]]` — generalize to a small ring buffer keyed by turn index; update vision branch in `_run_turn` |
| **Alternative STT provider** (e.g., local `faster-whisper`) | New `STTProvider` subclass in `backend/pipeline/stt.py`; change one line in `make_stt_provider()` |
| **Auth / rate limiting** (currently anyone with the URL can connect) | Middleware before the WS handler; verify `Authorization` header in the connect step before `await websocket.accept()` |
| **Session persistence** (currently dies with the WS connection) | `SessionStore` is the abstraction — swap to a Redis-backed impl; care needed for `current_turn_task` which is non-serializable |
| **More languages beyond EN/ES** | `messages.py` `Language` literal + `prompts.py` `get_prompt()` + `tts.py` `_voice_id()` + `readiness.py` flags. ElevenLabs `eleven_multilingual_v2` already supports many languages |
| **More demo tasks beyond Zoom-with-doctor** (currently hardcoded in prompts) | Pull task into a `config`-message field and `format()` into the system prompt at session start, or refactor to let the LLM infer the task from the first user message |
| **Real STT integration (mic input) verified end-to-end** | Already wired; needs a manual browser run with a real recording. Watch server logs for `Groq STT` calls |
| **Daisy persona iteration** (plan Task 26 — partially deferred) | Run the Zoom-with-doctor demo 5+ times by voice; tighten `DAISY_PROMPT_EN`/`ES` for "lists multiple steps", "jargon", "doesn't recover gracefully" failure patterns. Commit each tweak separately. Stop after 3 smooth consecutive runs |
| **Retry on TTS / LLM transient errors** (currently emits `turn_failed` once and stops) | Wrap the API calls in `_run_turn` with one retry + brief backoff; preserve cancellation semantics |
| **macOS / Linux installers** | electron-builder cross-target is already configured for Windows in `desktop/electron-builder.yml`. Adding macOS requires an Apple Developer cert ($99/yr) + signing + notarization; Linux just needs adding `target: AppImage` to the same file. The CI workflow needs a matrix expansion. |
| **Signed Windows installer** | Add `certificateFile` + `certificatePassword` (CI secret) to `desktop/electron-builder.yml` `win` block. EV cert recommended (~$300/yr) to skip SmartScreen entirely. |
| **Migrate `datetime.utcnow()` → `datetime.now(timezone.utc)`** | Two call sites in `backend/session.py` (`set_screenshot`, `has_fresh_screenshot`); update `tests/test_session.py` similarly |

## Subagent-driven workflow notes

This codebase was built using `superpowers:subagent-driven-development`. The plan at `docs/superpowers/plans/2026-05-16-daisy-helps-backend.md` was authored with verbatim per-task code so implementer subagents can copy + verify. Each phase ended with a smoke test (real Anthropic + ElevenLabs API call, ~$0.01 per turn). If continuing in this style:

- One implementer subagent per task; provide full task text in the prompt — don't make the subagent read the plan file
- For substantive code tasks, the implementer reports `DONE`/`DONE_WITH_CONCERNS`/`BLOCKED`/`NEEDS_CONTEXT` — handle each appropriately
- Verify the diff in-controller for trivial scaffolding tasks; dispatch a separate reviewer subagent for meaty changes
- `pytest -q` should stay at 29 passed across the whole sequence (until new tests are added)
