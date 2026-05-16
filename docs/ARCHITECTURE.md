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
