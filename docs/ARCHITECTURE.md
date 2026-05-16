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
