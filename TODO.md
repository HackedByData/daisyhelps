# TODO

State of the Daisy Helps backend repo and what's left before the demo.

**Last updated:** 2026-05-17 (after Render deploy + custom domain live)

---

## Status at a glance

| Area | State |
|---|---|
| Phase 0 — Scaffold | ✅ Complete + smoke verified |
| Phase 1 — Voice loop (VAD/STT/LLM/TTS) | ✅ Wired + automated end-to-end smoke (Anthropic + ElevenLabs) PASS |
| Phase 2 — Vision (screenshot → Sonnet) | ✅ Wired + smoke PASS (Sonnet correctly described a 128×128 PNG) |
| Phase 3 — Multi-turn + interrupts | ✅ Wired + smoke PASS (Turn 2 quoted Turn 1 → history preserved) |
| Phase 4 — Language toggle + text fallback | ✅ Smoke PASS (EN→ES→EN voice flip per-turn) |
| Phase 5 — click-indicator + clear_indicator wire messages | ✅ Code complete; `phase_name: "click-indicator"` |
| **Render deploy** | ✅ Live at https://daisyhelps-backend.onrender.com (starter plan, oregon) |
| **DNS for api.daisyhelps.com** | ✅ Cloudflare CNAME → daisyhelps-backend.onrender.com, TLS issued |
| Browser audio verification (mic, real screenshot, interrupt by ear) | ⏳ Pending — manual |
| Persona / prompt iteration (plan Task 26) | ⏳ Pending — needs voice demos to judge |
| Desktop Electron client | 🔄 In progress on `main` (separate concern from backend deploy) |

`backend/readiness.py` reports `phase: 5, phase_name: "click-indicator"`. Deployment is orthogonal to the phase axis — both `https://daisyhelps-backend.onrender.com/healthz` and `https://api.daisyhelps.com/healthz` return `{"status":"ok"}`.

**Tests:** 29 unit tests pass (`pytest -q`). Coverage: VAD, LLM router, session, WS messages.

## Deploy reference

- Render service ID: `srv-d84gqc7avr4c73d3aspg`
- Render dashboard: https://dashboard.render.com/web/srv-d84gqc7avr4c73d3aspg
- Cloudflare zone: `daisyhelps.com` (zone id `7e0f7382aea0bfa0e538c6165fd3bd02`)
- CNAME: `api` → `daisyhelps-backend.onrender.com`, proxied=false, TTL 300
- Region: oregon · Plan: starter ($7/mo) · Python 3.11 (via `PYTHON_VERSION` env var)
- Auto-deploy: enabled on `main` branch commits

---

## Remaining tasks

### Final end-to-end voice smoke (plan Task 36, ~10 min, **manual**)

Now that the backend is deployed, run the demo by voice end-to-end:

1. Open `https://api.daisyhelps.com/test` in a browser (warm `/healthz` first — cold first-WS load is ~10s for Silero).
2. Run the Zoom-with-doctor flow from `docs/DEMO.md`. Should complete in under 5 minutes.
3. Validate the 13 done-criteria from spec section 13.

This is the only step that needs human ears (Daisy's voice cadence, interrupt latency by ear, prompt-iteration judgment).

---

## Manual browser checks worth running (locally, anytime)

The automated smokes proved every message-passing path works against real Anthropic + ElevenLabs APIs. Real audio I/O and human-perceived behavior have NOT been verified. Open `http://localhost:8000/test` (after `uvicorn backend.main:app --reload --port 8000`):

- **EN voice loop** — mic → "hello Daisy" → hear an English reply
- **ES voice loop** — language toggle → mic → "hola Daisy" → hear Spanish reply in the Spanish voice
- **Mid-session language toggle by voice** — start EN, switch to ES mid-conversation, confirm next reply uses the ES voice (automated smoke proved this for `language_change` followed by `user_text`; this confirms via the mic path)
- **Real-screenshot vision** — drop an email-inbox PNG (with a Zoom invite) at `test_harness/fixtures/email_screen.png`, send via the file picker, ask "find the Zoom link in my email" — Daisy should reference what she actually sees
- **Interrupt by ear** — during a long Daisy reply, click Interrupt; audio should stop within ~200ms. (Automated smoke proved the message contract at 0.003s in-process.)
- **Full Zoom-with-doctor demo end-to-end** per `docs/DEMO.md` — target under 5 min, screenshots at the right moments, one step per Daisy reply

### Persona / prompt iteration (plan Task 26)

The Phase 3 plan calls for running the Zoom-with-doctor demo 5+ times and tightening `backend/prompts.py` based on observed failures. **Failure patterns to watch for:**
- Daisy lists multiple steps in one reply → tighten "ONE step at a time" in the prompt
- Daisy uses jargon / goes too fast → emphasize "slowly and simple words"
- Daisy doesn't recover gracefully when screenshot is unexpected → strengthen the recovery clause
- Daisy doesn't ask for a screenshot when she should → tweak the visual-cue guidance

Don't over-tune. Stop when 3 consecutive runs go smoothly. Each tweak is a separate commit (`phase-3: prompt iteration N: <note>`).

---

## Repo housekeeping

- **`NavigEase_Requirements_Document.docx`** at the repo root was pushed by a teammate (Niya Paul, ngpaul@uci.edu) and is for a different project. It's preserved in history. Decide whether to keep, move, or `git rm` in a follow-up commit.
- **Untracked files** (intentionally not committed):
  - `.env` — gitignored, has real secrets (now also includes `RENDER_API_KEY` + `CLOUDFLARE_API_TOKEN` for deploy ops)
  - `rosa-claude-code-prompt.md` — the original source prompt the rebrand came from
  - `elevenlabs-voice-prompt.md` — working notes from setting voice IDs

---

## Known gotchas (for future work)

- `datetime.utcnow()` in `backend/session.py` emits a `DeprecationWarning` on Python 3.12+. Migrate to `datetime.now(timezone.utc)` when convenient.
- `torch.jit.load` (used internally by `silero-vad`) emits a `DeprecationWarning` on Python 3.14+. Will likely break in a future torch release. Spec already notes ONNX export as a fallback. Render uses Python 3.11 where this doesn't fire.
- Anthropic vision API rejects 1×1 PNGs with HTTP 400 "Could not process image". Use ≥128×128 for any minimal test fixtures.
- `base64.standard_b64decode` does NOT accept `validate=True` — only `b64decode` does. Already fixed in `backend/main.py` screenshot branch.
- The browser test page uses `ScriptProcessorNode` (deprecated in Web Audio API) for mic capture. Works in all current browsers. `AudioWorklet` is the modern replacement when worth the refactor.
- First `/ws/` connect loads Silero VAD into memory (~10s cold). Warm up by hitting `/test` once before any demo.

---

## Where to look for what

| For | Read |
|---|---|
| WebSocket protocol contract | `docs/API.md` |
| System architecture (components, data flow) | `docs/ARCHITECTURE.md` |
| Local dev + env vars + deployment + troubleshooting | `docs/RUNBOOK.md` |
| Why decisions were made | `docs/DECISIONS.md` |
| The demo script | `docs/DEMO.md` |
| Feature readiness flags (live source of truth) | `backend/readiness.py` (or `GET /api/status`) |
| Daisy's voice (system prompt) | `backend/prompts.py` |
| Original design spec | `docs/superpowers/specs/2026-05-16-daisy-helps-backend-design.md` |
| Original implementation plan | `docs/superpowers/plans/2026-05-16-daisy-helps-backend.md` |
