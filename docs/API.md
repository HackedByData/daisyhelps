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

### `click_indicator`
Pixel coordinates the frontend should highlight on the user's screen. At most one per turn, emitted after `audio_end`. The locator runs only when a screenshot was attached to the current turn AND Daisy's response asked the user to click something. Failures are silent (no message emitted, no `error` frame).

**Coordinate space:** `(x, y)` are pixels in the screenshot's native space. The screenshot came from the desktop frontend (via OS screen capture); the indicator overlay should be drawn at the same pixel position on the same display surface. Scale via `(x/ref_width, y/ref_height)` if the overlay surface differs in size from the screenshot (e.g., DPI-scaled rendering or multi-monitor virtual desktops).

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
| `ref_width`, `ref_height` | int | Dimensions of the screenshot. Scale via `(x/ref_width, y/ref_height)` to map onto the user's actual screen if the overlay surface differs in size. |
| `label` | string \| null | Short hint describing the target element (≤80 chars). Useful for debug logs and a future accessibility caption. |
| `confidence` | number \| null | Reserved for forward compatibility; always `null` in v1. |

**Live from:** Phase 5.

### `clear_indicator`
Sent as the first frame of every new turn (before `transcript`), regardless of whether the new turn will emit its own `click_indicator`. Guarantees the lifecycle "indicator clears on next user utterance." The server does not emit a time-based `clear_indicator` — the desktop frontend may choose to fade the indicator after a duration of its own choosing.

```json
{"type": "clear_indicator"}
```

**Live from:** Phase 5.

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

After the LLM turn finishes (`audio_end` sent), if a screenshot was consumed this turn AND Daisy's response text contains a click intent ("click", "tap", "press", "open", and Spanish equivalents), the backend makes a second Claude call against the same screenshot using the computer-use tool in "look but don't act" mode. The resulting `(x, y)` is sent as a `click_indicator` message. The locator is best-effort: any failure (timeout, refusal, missing tool_use, out-of-bounds coords) drops silently — no indicator, no `error` frame.

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

## Desktop client notes

The production frontend is a downloaded Electron desktop app. A few items worth highlighting for that integration:

- **Screenshot capture:** the `screenshot` message carries a base64-encoded PNG of the user's screen (or active display, on multi-monitor systems). The desktop app sources it via `desktopCapturer.getSources({ types: ['screen'] })` and a hidden offscreen render — the user is not asked to pick a file. Width and height are whatever the OS reports (usually physical pixels on Windows, see DPI scaling note below).
- **Coordinate space:** `click_indicator.(x, y)` are pixels in the screenshot's native space. If the desktop app captures at physical-pixel resolution (default on Windows for `desktopCapturer`) and renders the overlay on the same surface, no scaling is needed. If it renders the overlay in a logical/CSS-pixel coordinate space (Electron `BrowserWindow` default), it must divide by `window.devicePixelRatio` (or equivalently, scale `(x/ref_width, y/ref_height)` against the logical screen dimensions).
- **Multi-monitor:** the screenshot's coordinate origin is `(0, 0)` of whatever the capture covered. If the capture was a single monitor, the overlay must be positioned on that monitor in the same coordinate origin. If a virtual desktop was captured, the overlay must account for monitor offsets from `screen.getDisplayNearestPoint(...)` or similar.
- **WebSocket origin:** the CORS allowlist above governs HTTP responses. The Electron WebSocket client typically connects with an `Origin: file://` or a custom protocol; FastAPI does not enforce CORS on WS handshake by default, so this works without backend changes. If a future tightening adds WS origin checking, add the Electron protocol to the allowlist.
- **No browser-only assumptions:** any reference in this doc to "the frontend" means the Electron app; legacy references to a browser-based test harness (`/test`) refer to the backend's debug page, not the production client.

