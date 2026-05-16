# Click Indicator — Design Spec

**Date:** 2026-05-16
**Owner:** Devin
**Source prompt:** Inline (this session)
**Status:** Draft — pending owner review
**Depends on:** Phase 2 (vision) — already live

---

## 1. Mission

When Daisy tells the user to "click the blue Join button," the backend should also emit a new WebSocket message carrying screen coordinates so the frontend can draw a visual indicator (pulsing ring, arrow, halo) at that exact spot on the user's screen. This dramatically improves comprehension for elderly and non-technical users who struggle to locate an element from a verbal description alone.

The indicator is **additive**, not a replacement: Daisy still narrates the step verbally. Daisy never takes the action — the product principle "guide, never do" is preserved.

---

## 2. Scope

**In scope:**
- Two new server→client WebSocket messages: `click_indicator`, `clear_indicator`.
- A second LLM call ("locator") per turn, fired only when a screenshot was consumed *and* Daisy's response contains a click intent.
- Click-intent regex (EN + ES).
- A separate `backend/pipeline/locator.py` module wrapping Claude's computer-use tool in "look but don't act" mode.
- PNG-dimension extraction from header bytes (no new dependency).
- System-prompt addition so Daisy mentions the highlight once per session.
- Docs updates: `docs/API.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`.
- Tests: protocol round-trip, click-intent detection, locator success/failure, lifecycle (`clear_indicator` at turn start).
- Readiness/phase bump: phase 5, name `click-indicator`; both new message types marked `live`.

**Out of scope (v1):**
- Bounding-box / region indicators (point only).
- Multiple indicators per turn ("click here, then here").
- Server-side N-second TTL auto-clear (lifecycle is utterance-only).
- UI-element pre-detection (OmniParser, OCR, Set-of-Mark).
- Image pre-resize before sending to the locator.
- Frontend overlay rendering (separate frontend repo).

---

## 3. Wire protocol

### `click_indicator` (server → client)

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
| `x`, `y` | int | Pixel coordinates in the screenshot's native space. |
| `ref_width`, `ref_height` | int | Dimensions of the screenshot the coordinates were computed against. Frontend scales `(x/ref_width, y/ref_height)` onto the user's actual screen. |
| `label` | string \| null | Short human-readable hint (≤80 chars) describing the element. Useful for debug logs and a future a11y caption. |
| `confidence` | number \| null | Reserved for forward compatibility. Always `null` in v1 — computer-use does not expose a numeric confidence. |

**Emission rules:**
- At most one per turn.
- Emitted after the corresponding `audio_end`, before `status:idle`.
- Best-effort: any failure in the locator (timeout, refusal, missing tool_use, out-of-bounds coords) drops silently — no error frame, no indicator message.

### `clear_indicator` (server → client)

```json
{ "type": "clear_indicator" }
```

**Emission rules:**
- Emitted at the very top of every new turn, **before** any other server frame, regardless of whether the new turn will produce its own indicator.
- This guarantees the lifecycle: *"indicator clears on next user utterance."*

### Readiness

Both message types are added to `READINESS["server_to_client"]` in `backend/readiness.py` and marked `STATUS_LIVE` once tests pass. The `phase` field bumps from `4` to `5`; `phase_name` becomes `click-indicator`.

---

## 4. Architecture

### Components added

| Component | File | Responsibility |
|---|---|---|
| Locator | `backend/pipeline/locator.py` | Wraps Claude's computer-use tool to return a single (x, y) click target for a given screenshot + guidance text. Includes PNG-dimension helper. Best-effort; returns `None` on any failure. |
| Click-intent detector | `backend/main.py` (inline regex) | Matches imperative verbs (click/tap/press/select/open/hit + Spanish equivalents) in Daisy's final response text. |
| Outgoing message helpers | `backend/messages.py` | `click_indicator_msg(...)`, `clear_indicator_msg()`. |

### Data flow (vision turn with click intent)

```
emit clear_indicator
[STT] → transcript
emit thinking
session.consume_screenshot() → image_bytes (local var)
emit speaking
stream LLM → daisy_text(partial) → stream_tts → audio_chunk(*)
emit daisy_text(partial=false) with full_text
emit audio_end
if image_bytes and click_intent(full_text):
    indicator_task = asyncio.create_task(
        locate_and_emit(websocket, image_bytes, full_text, language)
    )
    session.current_indicator_task = indicator_task
emit idle
```

### Sequencing rationale

The locator runs **sequentially after** the LLM stream completes (not in parallel with pass 1). Rationale:
- Click intent isn't known until Daisy's full text is assembled.
- Speculatively running the locator on every vision turn would burn one extra Claude call per turn when there is no click.
- Indicator latency-after-`audio_end` is acceptable: Daisy's audio is typically 5-15 seconds; the indicator lands while she's still speaking, which is sufficient for slow users who won't act until she stops.
- Voice latency is unaffected — the locator task is created *after* `audio_end`.

### Cancellation

`session.current_indicator_task` mirrors `session.current_turn_task`. `_cancel_turn` cancels both. The `clear_indicator` emitted at the top of each new turn covers the case where a late indicator arrives after the user has already moved on.

### Screenshot lifecycle (unchanged)

- 60s TTL on the single pending screenshot.
- Consumed-on-attach: same screenshot is never sent to two consecutive LLM calls.
- The locator reads `image_bytes` from `_run_turn`'s local scope; it does *not* re-read `session.pending_screenshot`. No lifecycle change.

---

## 5. Locator internals

### Public surface

```python
@dataclass
class ClickTarget:
    x: int
    y: int
    ref_width: int
    ref_height: int
    label: str | None

async def locate_click_target(
    image_bytes: bytes,
    guidance_text: str,
    language: Literal["en", "es"],
) -> ClickTarget | None
```

### Claude call shape

- **Model:** `claude-sonnet-4-6`.
- **Tool:** `computer_20250124` with `display_width_px` / `display_height_px` set to the screenshot's native dimensions (extracted from the PNG IHDR chunk).
- **Beta header:** `anthropic-beta: computer-use-2025-01-24` if the pinned `anthropic` SDK requires it (verified at implementation time).
- **`max_tokens`:** 256 (we only want a tool call).
- **System prompt:** `"You are a screen-region locator. Given a screenshot and a guidance message about what the user should do next, identify the single UI element they should click. Emit exactly one computer tool call with action='left_click' and coordinate=[x,y]. Do not explain. If you cannot identify the target with high confidence, do nothing."`
- **User message:** image block + text = `f'Daisy told the user: "{guidance_text}". Where on the screen should the user click?'`

### PNG dimensions (no new dependency)

```python
def png_dimensions(png: bytes) -> tuple[int, int]:
    if len(png) < 24 or png[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not a PNG")
    width = int.from_bytes(png[16:20], "big")
    height = int.from_bytes(png[20:24], "big")
    return width, height
```

PNG IHDR is always the first chunk; bytes 16-23 contain the two big-endian uint32s.

### Response handling

Walk response `content` blocks in order:
- First `tool_use` with `name == "computer"` and `input.action == "left_click"`:
  - Pull `input.coordinate` → `[x, y]` (cast to int).
  - If `0 <= x < ref_width` and `0 <= y < ref_height`: return `ClickTarget(x, y, ref_width, ref_height, label)`.
  - Otherwise: return `None`.
- `label` is derived from any preceding `text` block, trimmed to ≤80 chars. `None` if absent.
- No tool call, refusal, exception, network error, or out-of-bounds: log and return `None`.

### Accuracy caveat

Anthropic's computer-use accuracy degrades on screenshots wider than ~1280px. v1 ships with native-size and no resize. If 4K screens demonstrate poor accuracy in practice, v2 introduces a downscale step (Pillow or equivalent).

---

## 6. Trigger logic

In `backend/main.py`:

```python
_CLICK_INTENT_RE = re.compile(
    r"\b(click|tap|press|select|choose|open|hit"
    r"|haz\s+clic|presiona|toca|selecciona|abre|elige|pulsa)\b",
    re.IGNORECASE,
)
```

Kept separate from the existing `_VISUAL_HINT_WORDS` (that list is for *user* turns triggering screenshot requests; this regex is for *Daisy's* response text).

**Trigger** (in `_run_turn`, after `audio_end_msg`):

```python
if image_bytes is not None and _CLICK_INTENT_RE.search(full):
    session.current_indicator_task = asyncio.create_task(
        _emit_indicator(websocket, image_bytes, full, session.language)
    )
```

`_emit_indicator` calls `locate_click_target`; on a non-`None` result, sends `click_indicator_msg(...)`. All exceptions are caught and logged at `WARNING`.

**`clear_indicator`** is sent as the first action of `_run_turn`, before STT/transcript, inside a try/except that swallows send errors.

---

## 7. System-prompt addition

Append one paragraph to both prompts in `backend/prompts.py`.

**English:**
> When you ask the user to click or tap something, a circle will appear on their screen pointing to the right spot. The first time it's relevant in our conversation, mention this gently — for example: "You'll see a little circle appear right where you should click." After that, you don't need to mention it again.

**Spanish:**
> Cuando le pidas al usuario que haga clic o toque algo, aparecerá un círculo en su pantalla señalando el lugar correcto. La primera vez que sea relevante en nuestra conversación, menciónalo con suavidad — por ejemplo: "Verá aparecer un pequeño círculo justo donde debe hacer clic." Después, no necesitas mencionarlo de nuevo.

---

## 8. Documentation updates

### `docs/API.md`

- Add `click_indicator` and `clear_indicator` rows to the server→client message section with full JSON schemas, the per-message emission rules from §3, and the scaling formula `(x/ref_width, y/ref_height)`.
- Update the example `/api/status` payload to include both new keys under `server_to_client`.
- Add one paragraph under the existing **Vision flow** section describing the post-`audio_end` locator branch.

### `docs/ARCHITECTURE.md`

- Add a `Locator` row to the components table.
- Extend the **Vision flow** section with the new branch:
  ```
  ... audio_end →
  if image_bytes && click_intent(text):
     locate_click_target → click_indicator
  ```

### `docs/DECISIONS.md`

New entry: **"Click indicator via Claude computer-use tool in look-but-don't-act mode."**

- **Context:** Elderly and tech-novice users struggle to locate UI elements from a verbal description alone.
- **Decision:** Make a second Claude Sonnet call with the computer-use tool enabled, extract the (x, y) from the emitted `left_click` tool_use block, send it to the frontend as `click_indicator`. Never actually execute the click.
- **Rationale:** Computer-use is first-party, requires zero new dependencies, and is dramatically more reliable for pixel coordinates than raw-JSON prompting per Anthropic's own guidance. Look-but-don't-act preserves Daisy's "guide, never do" principle.
- **Alternatives considered:**
  - Set-of-Mark prompting with OmniParser or OCR (very accurate but adds a UI-element detector dependency and a pre-processing pass per screenshot).
  - Raw JSON prompting ("return `{x, y}`") — unreliable for pixel coords.
  - Multiple-indicator sequence — defers to v2; conflicts with the "one step at a time" prompt rule.
  - Bounding-box indicator — defers to v2; computer-use returns a point, region would need a follow-up call.
- **How to swap:** Replace the body of `locate_click_target` with any other targeting backend that returns a `ClickTarget`. Wire format is unchanged.

---

## 9. Testing

New file: `tests/test_indicator.py` (or extend existing test modules if the project pattern places them differently).

| Test | Asserts |
|---|---|
| `test_click_indicator_msg_serialization` | `click_indicator_msg(100, 200, 1920, 1080, label="Join", confidence=None)` matches the documented JSON schema. `clear_indicator_msg()` likewise. `None` confidence survives JSON serialization. |
| `test_png_dimensions_extracts_size` | Synthetic minimal PNG header → expected (w, h). Bad magic → raises. |
| `test_indicator_fires_when_screenshot_and_click_intent` | Monkeypatch `locate_click_target` → fake `ClickTarget`; monkeypatch `stream_response` → yields "click the Join button"; assert WS frame log contains `click_indicator` with the right schema after `audio_end`. |
| `test_no_indicator_when_no_screenshot` | Response contains "click" but no fresh screenshot — no `click_indicator` emitted. |
| `test_no_indicator_when_no_click_intent` | Screenshot present, response is "I see you have your email open" — no `click_indicator` emitted. |
| `test_clear_indicator_emitted_at_turn_start` | Run two turns; assert the second turn emits `clear_indicator` before `transcript`. |
| `test_locator_failure_degrades_silently` | `locate_click_target` raises — turn completes normally; no `click_indicator`, no `error` frame. |
| `test_locator_out_of_bounds_drops` | Locator returns `(x, y)` outside `(ref_width, ref_height)` — no `click_indicator`. |
| `test_click_intent_regex_es` | "haz clic", "presiona", "abre" each match; ambiguous text like "se cerró" does not. |

WS frames captured via the same mock-WebSocket pattern used by existing tests (verified at implementation time).

---

## 10. Acceptance criteria

- All new tests in §9 pass.
- `GET /api/status` shows `click_indicator: live`, `clear_indicator: live`, `phase: 5`, `phase_name: "click-indicator"`.
- End-to-end happy path via the test harness: sending a screenshot + "where do I click to open my email?" results in (a) Daisy's normal voice/text reply, (b) a `click_indicator` message in the WS frame log with coordinates inside the screenshot bounds, (c) the next user utterance produces a `clear_indicator` at the top of the new turn.
- `docs/API.md` alone is sufficient for a frontend agent to render the overlay (no need to read backend code).
- `docs/DECISIONS.md` records the rationale and swap path.

---

## 11. Non-goals (explicit do-nots)

- Do **not** execute the click. The computer-use tool is invoked for targeting only; the resulting tool_use is read for coordinates and discarded.
- Do **not** add a UI-element detector dependency (OmniParser, OCR) in v1.
- Do **not** change the existing screenshot lifecycle (60s TTL, single pending, consumed-on-attach).
- Do **not** block voice response on the locator call. The locator runs after `audio_end`.
- Do **not** emit more than one `click_indicator` per turn.
- Do **not** add a server-side N-second auto-clear timer. Lifecycle is utterance-only.

---

## 12. Future work (v2+)

- Bounding-box indicator (region instead of point) via a follow-up Claude call.
- Multi-indicator sequences for multi-step instructions.
- Pre-resize large screenshots (>1280px wide) for better computer-use accuracy.
- Numeric confidence (set-of-mark with overlap scoring, or a verifier pass).
- Optional server-side TTL if frontend telemetry shows stale indicators are a real problem.
