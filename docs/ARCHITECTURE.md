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
| Locator | `backend/pipeline/locator.py` | Best-effort computer-use call to identify the click target; returns `ClickTarget(x, y, ref_width, ref_height, label)` or `None` |

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

## Vision flow

The session holds at most one pending screenshot: `(bytes, datetime)`. TTL is 60 seconds.

1. Client sends `screenshot` whenever it has one. Server validates the PNG magic bytes, decodes base64, stores `(bytes, datetime.utcnow())`.
2. On the next LLM call:
   - If the pending screenshot is fresh, attach it as an `image` content block on the current user message AND route to `claude-sonnet-4-6`. Mark consumed (clear from session).
   - Otherwise, if the user's text mentions visual cues, emit `screenshot_request`; route to Haiku.
3. The screenshot is never re-attached after it's consumed.

3. After `audio_end`, if `image_bytes` was used this turn AND Daisy's response matched the click-intent regex, the server schedules a `locate_click_target(image_bytes, full_response, language)` call (Claude Sonnet + `computer_20250124` tool). On a valid `left_click` tool_use, the server emits `click_indicator`. The call is best-effort and degrades silently. The indicator is cleared on the *next* turn via `clear_indicator` emitted as the first frame of `_run_turn`. The frontend (a desktop Electron client) draws the highlight on the same physical screen the user shared via `desktopCapturer`; coordinates are in screenshot-native pixel space.

