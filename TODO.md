# TODO

State of the Daisy Helps backend repo and what's left before the demo.

**Last updated:** 2026-05-16 (after Phase 5 code-side completion)

---

## Status at a glance

| Area | State |
|---|---|
| Phase 0 — Scaffold | ✅ Complete + smoke verified |
| Phase 1 — Voice loop (VAD/STT/LLM/TTS) | ✅ Wired + automated end-to-end smoke (Anthropic + ElevenLabs) PASS |
| Phase 2 — Vision (screenshot → Sonnet) | ✅ Wired + smoke PASS (Sonnet correctly described a 128×128 PNG) |
| Phase 3 — Multi-turn + interrupts | ✅ Wired + smoke PASS (Turn 2 quoted Turn 1 → history preserved) |
| Phase 4 — Language toggle + text fallback | ✅ Smoke PASS (EN→ES→EN voice flip per-turn) |
| Phase 5 — `render.yaml`, `test_client.py`, all docs | ✅ Code/docs complete |
| **Render deploy** | ⏳ Pending — needs your dashboard access |
| **DNS for api.daisyhelps.com** | ⏳ Pending — needs your registrar access |
| **Final smoke + phase-5 flag bump** | ⏳ Pending — runs after deploy |
| Browser audio verification (mic, real screenshot, interrupt by ear) | ⏳ Pending — manual |
| Persona / prompt iteration (plan Task 26) | ⏳ Pending — needs voice demos to judge |

`backend/readiness.py` currently reports `phase: 4, phase_name: "language-text-verified"`. It will bump to `phase: 5, phase_name: "deployed"` after the final smoke.

**Tests:** 29 unit tests pass (`pytest -q`). Coverage: VAD, LLM router, session, WS messages.

---

## Remaining tasks

### 1. Deploy to Render (plan Task 32, ~10 min)

1. Sign in at https://dashboard.render.com.
2. **New → Blueprint**, point at the GitHub repo. Render reads `render.yaml` automatically (Python 3.11, `pip install -r requirements.txt`, `uvicorn ... --host 0.0.0.0 --port $PORT`, healthcheck `/healthz`, plan: starter).
3. In **Service → Environment**, set the 5 secrets (they live in `.env` locally; `render.yaml` declares them with `sync: false`):
   - `ANTHROPIC_API_KEY`
   - `GROQ_API_KEY`
   - `ELEVENLABS_API_KEY`
   - `ELEVENLABS_VOICE_ID_EN`
   - `ELEVENLABS_VOICE_ID_ES`

   `LOG_LEVEL=INFO` comes from `render.yaml` already.
4. Watch the build (torch wheel download ~30s, Silero bundles its model).
5. Verify the Render-supplied URL:
   ```bash
   curl https://<service>.onrender.com/healthz
   # → {"status":"ok"}
   ```

### 2. Configure `api.daisyhelps.com` DNS (plan Task 33, ~5 min + propagation)

1. Render service → **Settings → Custom Domains** → add `api.daisyhelps.com`. Render gives you a CNAME target.
2. At the daisyhelps.com registrar, add DNS:
   - Type: `CNAME`
   - Name: `api`
   - Value: (the Render-supplied target)
   - TTL: 300
3. Wait ~5 min for DNS + TLS cert issuance.
4. Verify:
   ```bash
   curl https://api.daisyhelps.com/healthz
   # → {"status":"ok"}
   ```

### 3. Final end-to-end smoke + phase-5 flag bump (plan Task 36, ~10 min)

After deploy + DNS:

1. Open `https://api.daisyhelps.com/test` in a browser.
2. Run the Zoom-with-doctor flow from `docs/DEMO.md`. Should complete in under 5 minutes.
3. Validate the 13 done-criteria from spec section 13.
4. Bump `backend/readiness.py`:
   ```python
   "phase": 5,
   "phase_name": "deployed",
   ```
5. ```bash
   git add backend/readiness.py
   git commit -m "phase-5: deployed + verified + docs finalized"
   git push
   ```

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
  - `.env` — gitignored, has real secrets
  - `rosa-claude-code-prompt.md` — the original source prompt the rebrand came from
  - `elevenlabs-voice-prompt.md` — appears to be your working notes from setting voice IDs
- **Stray `XAI_API_KEY`** in `.env` — not used by this app, harmless, can delete

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
