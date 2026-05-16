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
