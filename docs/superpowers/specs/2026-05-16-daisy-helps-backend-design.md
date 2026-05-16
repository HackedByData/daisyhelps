# Daisy Helps — Backend Design Spec

**Date:** 2026-05-16
**Owner:** Devin
**Source prompt:** `rosa-claude-code-prompt.md` (the Rosa hackathon prompt this design adapts)
**Domain:** daisyhelps.com (purchased; `api.daisyhelps.com` planned for this service)
**Status:** Approved for implementation

---

## 1. Mission

Build the **backend for Daisy Helps**, a voice AI companion for tech-novice and elderly users. Daisy holds a patient voice conversation with the user in their native language (English or Spanish) and processes screenshots of the user's screen to guide them through tasks one step at a time. Daisy never performs actions for the user — she teaches them to do it themselves so they feel capable.

**Demo task (hardcoded):** Help the user join a Zoom call with their doctor. Full flow: user says "I have a Zoom call with my doctor and I can't get in," Daisy asks to see the screen, then walks them through finding the Zoom link in their email, opening it, joining the meeting, and turning on camera and microphone — all by voice, with screenshots taken on demand to verify state.

**Frontend timeline:** This spec covers the backend only. A Claude design agent builds the frontend **in parallel** against the backend. To make parallel development safe:
- `docs/API.md` is the contract; it is complete from Phase 0 (not filled in over time).
- `GET /api/status` returns machine-readable readiness flags so the frontend can introspect which features are `live` vs `stubbed`.
- The WebSocket handler accepts every documented message type from Phase 0; stubbed types return `error: not_yet_implemented` until their phase enables them. The protocol surface is stable from Day 0.

---

## 2. Scope

**In scope:**
- FastAPI server with a WebSocket endpoint
- Voice pipeline: VAD → STT → LLM → TTS
- Vision pipeline: screenshot → Claude Sonnet
- Session state management (in-memory)
- Streaming at every stage
- Interruption handling
- Multilingual support (English + Spanish)
- Precise WebSocket API specification in `docs/API.md`
- Test harness (Python WebSocket client + standalone HTML debug page)
- Unit tests for VAD, LLM routing, session state, WS message validation
- Deployment to Render at `api.daisyhelps.com`

**Out of scope:**
- Production frontend UI (handled by future Claude design agent)
- Visual design, accessibility styling
- Browser mic/screen capture code beyond the test harness
- Auth, persistence, multi-tenancy

---

## 3. Stack

| Stage | Choice | Notes |
|---|---|---|
| Runtime | Python 3.11 | Pinned in `render.yaml` |
| Web framework | FastAPI + Uvicorn + WebSockets | |
| VAD | Silero VAD via `torch.hub`, CPU-only | ~250MB torch footprint; OK on Render free tier with cold-start delay |
| STT | **Groq Whisper Large v3 Turbo** (`groq` SDK), abstracted behind `STTProvider` interface | Picked over OpenAI Whisper for lower latency. Swap remains a one-line change. |
| LLM | Anthropic Claude — `claude-sonnet-4-6` for turns with a screenshot, `claude-haiku-4-5-20251001` for plain text turns | |
| TTS | ElevenLabs streaming (Multilingual v2 family), separate voice IDs for EN/ES | |
| HTTP client | `httpx[http2]` | |
| Config | `pydantic-settings` + `.env` | |
| Logging | `loguru` | |
| Tests | `pytest` (config in `pyproject.toml`) | |
| Deployment | Render Python web service | Custom domain `api.daisyhelps.com` |

**Required env vars:** `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID_EN`, `ELEVENLABS_VOICE_ID_ES`, `LOG_LEVEL`.

**Latency budget:** End-of-user-speech to first-audio-byte under **2.5 seconds**. Stream at every stage — never wait for full output from any component before starting the next.

---

## 4. Repo layout

This repo (`daisyhelps/`) is the backend. The frontend, when it ships later, will live in a separate repo.

```
daisyhelps/                  # repo root
├── backend/                 # Python package
│   ├── __init__.py
│   ├── main.py              # FastAPI app, routes, WS handler, lifespan
│   ├── session.py           # Session class + in-memory store
│   ├── prompts.py           # DAISY_PROMPT_EN, DAISY_PROMPT_ES
│   ├── config.py            # pydantic-settings
│   ├── logging_setup.py     # loguru config
│   └── pipeline/
│       ├── __init__.py
│       ├── vad.py           # Silero wrapper + VADBuffer
│       ├── stt.py           # STTProvider interface + GroqWhisperSTT
│       ├── llm.py           # Claude routing + vision + streaming
│       └── tts.py           # ElevenLabs streaming
├── test_harness/
│   ├── test_client.py       # Python WebSocket test client
│   ├── test_page.html       # Debug page served at GET /test
│   └── fixtures/
│       ├── hello.wav        # Short "hello Daisy" clip
│       └── email_screen.png # Email-inbox screenshot fixture
├── tests/                   # Unit tests (pace = hackathon + tests)
│   ├── __init__.py
│   ├── test_vad.py
│   ├── test_llm_router.py
│   ├── test_session.py
│   └── test_ws_messages.py
├── docs/
│   ├── ARCHITECTURE.md
│   ├── API.md               # Contract for the future frontend agent
│   ├── RUNBOOK.md
│   ├── DECISIONS.md
│   └── DEMO.md
├── .env.example
├── .gitignore
├── pyproject.toml           # pytest config + project metadata
├── requirements.txt
├── render.yaml
└── README.md
```

---

## 5. Brand and persona

**Product:** Daisy Helps. **Character:** Daisy.

**Persona — calm patient teacher.** Warm but grounded. Speaks slowly and clearly with simple words, like a kind tutor who has helped many people through the same thing before. Steadier and slightly more confident than a grandmotherly persona; never effusive or bubbly. Never condescending, never hurried.

**Behavioral rules baked into the system prompt:**
- Give **ONE step at a time**. Never list multiple steps in one message.
- After each step, wait for the user to confirm they've done it or to ask a question.
- When Daisy needs to see the screen, ask gently: **"Could you show me what's on your screen for a moment?"** — then expect a screenshot in the next message.
- If a screenshot shows the user is in an unexpected state, recover gracefully: "Oh, I see we're in [app] — no problem, let's get back to where we need to be."
- Never make the user feel bad. Never imply they did something wrong.
- Close sessions warmly. Offer empowerment.

**Starting system prompt (refined iteratively in Phase 3):**

```
You are Daisy, a calm and patient teacher who helps people who aren't comfortable
with technology. You speak slowly and clearly using simple words. You sound like
a thoughtful tutor who has helped many people through this same task before —
warm, steady, and never hurried.

Your job is to guide the user through tasks on their computer, one step at a
time. You never do anything for them — you teach them to do it themselves so
they feel capable.

When you need to see what's on their screen, ask gently: "Could you show me
what's on your screen for a moment?" The screen will be shared with you as an
image in the next message.

Give ONE step at a time. After giving a step, wait for the user to tell you
they've done it or to ask a question. Never list multiple steps in one message.

If the screen shows something unexpected, stay calm and don't make the user
feel bad. Say something like "Oh, I see we're in [app] — let's get back to
where we need to be."

When the task is complete, congratulate them warmly and ask if there's a faster
way they'd like to learn to reach you next time.

The user is trying to: join a Zoom call with their doctor. The Zoom link is in
their email. Help them find it, open it, join the meeting, and turn on their
camera and microphone — one step at a time.

Speak in {LANGUAGE} for the entire conversation. Never mix languages unless the
user does.
```

`DAISY_PROMPT_ES` is a natural translation in the same warm, calm-teacher register — not literal. Refined in Phase 3 alongside EN.

**ElevenLabs voice direction:** Medium-warm female, unhurried cadence, gentle authority. Avoid overly cheery or grandmotherly voices. Same direction for the Spanish voice.

**Rebrand mechanics (literal changes from the Rosa source prompt):**
- All "Rosa" → "Daisy" in code, comments, identifiers, docs.
- `ROSA_PROMPT_EN`/`ROSA_PROMPT_ES` → `DAISY_PROMPT_EN`/`DAISY_PROMPT_ES`.
- "Can I take a peek at your screen?" → "Could you show me what's on your screen for a moment?"
- Product name "Rosa" → "Daisy Helps" in README, page titles, log identifiers.

---

## 6. WebSocket API (contract summary)

Full schemas, example payloads, and edge cases go in `docs/API.md` — written continuously through every phase. This section is the summary.

**Connection:** `wss://api.daisyhelps.com/ws/{session_id}` (UUID v4 generated client-side).

On connect, server sends `{"type": "status", "state": "idle"}`. Client must send `config` before audio/text.

**Client → Server:**
```json
{"type": "config", "language": "en" | "es"}
{"type": "audio_chunk", "data": "<base64 PCM 16kHz mono 16-bit LE>", "sequence": <int>}
{"type": "user_text", "text": "..."}
{"type": "screenshot", "data": "<base64 PNG, no data: URI prefix>"}
{"type": "interrupt"}
{"type": "language_change", "language": "en" | "es"}
{"type": "end_session"}
```

**Server → Client:**
```json
{"type": "transcript", "text": "...", "final": true | false}
{"type": "daisy_text", "text": "...", "partial": true | false}
{"type": "audio_chunk", "data": "<base64 PCM 24kHz mono>", "sequence": <int>}
{"type": "audio_end"}
{"type": "screenshot_request", "reason": "..."}
{"type": "status", "state": "idle" | "listening" | "thinking" | "speaking"}
{"type": "error", "code": "...", "message": "..."}
```

**Note on `daisy_text`:** The source Rosa prompt used `rosa_text` as the wire-format type name. We rename to `daisy_text` for clarity. Logged in DECISIONS.md. All other type names are unchanged from the source prompt.

**Audio formats:**
- In (client → server): 16 kHz mono 16-bit PCM, base64, ~50-100ms chunks.
- Out (server → client): 24 kHz mono PCM from ElevenLabs, base64, streamed as bytes arrive.

**Errors:** Every error has `code` (e.g. `stt_failed`, `tts_failed`, `llm_failed`, `screenshot_invalid`, `bad_message`) and human-readable `message`.

**Status:** Every state transition (`idle` → `listening` → `thinking` → `speaking` → `idle`) is announced.

**CORS:** Allow `https://daisyhelps.com`, `https://*.daisyhelps.com`, and `http://localhost:*` (development).

---

## 7. Vision flow

**Strategy: always include the most recent screenshot if one exists within the last 60 seconds.** Heuristic phrase detection in Daisy's text is rejected — too fragile.

1. Frontend sends `{"type": "screenshot", "data": "..."}` whenever it has one (after permission grant, or in response to a `screenshot_request`).
2. Server decodes the base64, stores `(bytes, timestamp)` on the session as the pending screenshot.
3. On the next LLM call: if a pending screenshot is < 60s old, attach it as a Claude image content block AND route to **Sonnet**. Otherwise route to **Haiku**.
4. After the LLM call begins, mark the screenshot as "consumed" — do NOT re-attach to subsequent calls. (Prevents stale-image bugs.)
5. The server may emit `screenshot_request` proactively when an LLM turn would have benefited from a screenshot and none was available. The future frontend uses this to render a UI hint.

---

## 8. Interrupts

**Mechanism: per-turn `asyncio.Task` cancelled via `CancelledError` propagation.**

- Each user utterance starts a "turn task" that runs LLM streaming → TTS streaming → WS send.
- The session keeps a reference: `current_turn_task: asyncio.Task | None`.
- When `{"type": "interrupt"}` arrives, the WS handler calls `current_turn_task.cancel()`.
- The TTS streamer's async generator raises `CancelledError`, closes the ElevenLabs HTTP connection, and propagates up.
- The WS handler catches `CancelledError`, sends `{"type": "audio_end"}` and `{"type": "status", "state": "listening"}`.
- The LLM token stream is allowed to drain in the background to update the conversation history; no further `audio_chunk` messages are emitted for that turn.

**Target:** audio stops within **200ms** of interrupt receipt.

---

## 9. Session state

`Session` is a dataclass held in an in-memory dict keyed by `session_id`. No persistence — appropriate for hackathon scope. (Logged in DECISIONS.md.)

```python
@dataclass
class Session:
    session_id: UUID
    language: Literal["en", "es"]              # default "en"; set on first config msg
    messages: list[dict]                       # Claude-format conversation history
    pending_screenshot: tuple[bytes, datetime] | None
    consumed_screenshots: int
    status: Literal["idle", "listening", "thinking", "speaking"]
    current_turn_task: asyncio.Task | None
    vad_buffer: VADBuffer
```

Lifecycle: session created on WS connect, destroyed on WS disconnect or `end_session`. No cleanup task for idle sessions in v1 — they die with their connection.

---

## 10. Tests

Focused, hackathon-pace. High leverage / low cost only. No mock-only HTTP wrapper tests.

| File | Coverage |
|---|---|
| `tests/test_vad.py` | `VADBuffer.ingest()` with synthetic PCM (silence vs sine bursts) yields complete utterances only after the 700ms silence threshold; resets after each utterance |
| `tests/test_llm_router.py` | `route_model(has_image)` → `claude-sonnet-4-6` vs `claude-haiku-4-5-20251001`; system prompt selected by language |
| `tests/test_session.py` | Screenshot expires after 60s; consumed flag prevents re-attach; status transitions valid; history append-only |
| `tests/test_ws_messages.py` | Pydantic models for every C→S message type parse valid examples; reject malformed input; unknown `type` produces an `error` response with code `bad_message` |

`pytest -q` total runtime target: under 5 seconds. No external API calls in unit tests.

**Skipped:** STT/LLM/TTS provider HTTP wrappers (smoke tests catch real breakage), audio encode/decode (smoke-covered), ElevenLabs streaming.

---

## 11. Deployment

**Render Python web service.** `render.yaml`:
- Python 3.11 pinned
- Build: `pip install -r requirements.txt`
- Start: `uvicorn backend.main:app --host 0.0.0.0 --port $PORT`

**Env vars in Render dashboard:** `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID_EN`, `ELEVENLABS_VOICE_ID_ES`, `LOG_LEVEL`.

**Custom domain:** Configure `api.daisyhelps.com` to CNAME to the Render service in Phase 5. Bare `daisyhelps.com` stays unconfigured for the future frontend. Steps documented in RUNBOOK.md.

**Cold-start watch-out:** torch CPU-only is ~250MB; Render free tier fits but cold start is ~10-30s. If memory pressure ever bites, swap Silero to ONNX export (no torch). Noted as a future optimization, not done now.

---

## 12. Phase sequencing

Strictly in order. Commit at end of each phase. Smoke test must pass before next phase starts. >30min stuck on anything → simplify, log decision, move on.

| Phase | Duration | Goal | Smoke test |
|---|---|---|---|
| 0 — Scaffold | 1-2h | Layout, `requirements.txt`, `.env.example`, FastAPI shell (`/healthz`, `/`, `/ws/{session_id}` echo, `/test`), empty docs, README, `pyproject.toml`, `tests/` dir | Connect via test_page.html, send text, see echo |
| 1 — Voice loop, no vision | 4-6h | VAD + Groq Whisper STT + Claude Haiku + ElevenLabs TTS wired through WS. Session state. `language_change`. Unit tests pass. API.md complete. | Say "hello" → Daisy responds within 3s. Same in Spanish via `language_change`. |
| 2 — Vision | 3-5h | Screenshot lifecycle: store 60s, attach + Sonnet on next call, consumed flag. `screenshot_request` protocol field. | Send email-inbox screenshot via `/test`, ask "find the Zoom link" — Daisy describes what she sees. |
| 3 — Multi-turn + interrupts | 4-6h | System prompt iteration through Zoom-with-doctor 5+ times. Interrupt via `CancelledError`, audio stops <200ms. Detailed status emissions. DEMO.md filled in. | Full Zoom-with-doctor end-to-end. Interrupt mid-response → silent <200ms, status→listening. |
| 4 — Language toggle + text fallback | 1-2h | `language_change` swaps prompt + voice mid-session. `user_text` STT bypass. Spanish full flow works. | From `/test`, type Spanish opener, get Spanish response. Switch back to English mid-session, Daisy continues correctly. |
| 5 — Deployment + final docs | 2-3h | `render.yaml` working, env vars set, deployed, `api.daisyhelps.com` CNAME configured at registrar, public URL verified. All five docs finalized. | Full Zoom-with-doctor through test harness against public `https://api.daisyhelps.com/ws/...`. |

**Total wall-clock estimate: 15-24 hours.**

---

## 13. Done criteria

Backend is shipped when all of these are true against the public `api.daisyhelps.com` URL:

1. WS connects, `config` sets language, `status: idle` is received.
2. Streaming mic audio results in a final `transcript` within 500ms of end-of-speech.
3. LLM routes correctly: Haiku for text-only turns, Sonnet when a screenshot is attached.
4. TTS audio chunks begin arriving within 2.5s of end-of-user-speech.
5. Screenshot lifecycle works: image included in next LLM call, Daisy describes what she sees.
6. Interrupt stops Daisy's audio within 200ms and transitions to `listening`.
7. `language_change` switches both system prompt and TTS voice; English and Spanish both complete the Zoom-with-doctor flow end-to-end.
8. `user_text` works as a complete bypass of STT.
9. The full Zoom-with-doctor demo task completes in under 5 minutes through the test harness.
10. `docs/API.md` is complete enough that a future Claude design agent could build a frontend against it without reading backend code.
11. All five docs in `docs/` are current.
12. All `tests/` pass with `pytest -q` in under 5s.
13. Deployed at `https://api.daisyhelps.com`, `/healthz` returns 200.

When all 13 are true, the backend is shipped and ready for the future frontend agent.

---

## 14. Initial DECISIONS.md seed

These are decided as of this spec — each gets a paragraph in `docs/DECISIONS.md` during Phase 0:

1. **STT provider: Groq Whisper Large v3 Turbo** over OpenAI Whisper. Picked for ~3-5x lower latency. Abstracted behind `STTProvider` so swap is a one-line change.
2. **LLM routing: Haiku for text-only, Sonnet when screenshot present.** Sonnet's vision is needed; Haiku is faster and cheaper for the conversational majority of turns.
3. **Screenshot lifecycle: always-include-most-recent-within-60s.** Heuristic phrase detection is fragile. 60s window balances "fresh enough" against "user has finished talking."
4. **Screenshot consumed flag:** prevents re-attaching the same image across turns; avoids stale-context bugs.
5. **Interrupt: `asyncio.CancelledError` via task cancellation.** Cleaner propagation through async generator chain than `asyncio.Event`.
6. **Session store: in-memory dict, lives with the WS connection.** Hackathon scope; no persistence, no auth.
7. **Persona: Daisy as calm patient teacher.** Less grandmotherly than Rosa; warm but steady. Targets the same elderly/tech-novice audience without being saccharine.
8. **Deployment: Render at `api.daisyhelps.com`.** Render supports long-lived WS natively (Vercel does not). Custom subdomain leaves `daisyhelps.com` available for the future frontend.
9. **Wire format rename `rosa_text` → `daisy_text`.** Source prompt's literal wire type name was a bleed-through; renamed for clarity.
10. **Tests added beyond spec.** Spec was silent on testing. We add four unit-test files (VAD, LLM router, session, WS messages) per the "hackathon pace + tests" decision.
11. **`tests/` and `pyproject.toml` not in source spec.** Added so pytest can find tests and import paths behave. Tiny additions; flagged for transparency.

---

## 15. What this spec does not decide

Deferred to implementation (or future iterations):
- ElevenLabs specific voice IDs (you'll provide; Phase 0 just expects them in env)
- Exact Spanish translation of `DAISY_PROMPT_ES` (drafted in Phase 1, refined in Phase 3)
- Final wording of the "could you show me your screen" line in ES (drafted Phase 1, refined Phase 3)
- ONNX swap for Silero (only if Render memory pressure forces it)
- Any auth or rate-limiting (out of scope for v1)
