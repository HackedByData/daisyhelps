# TODO — make the tool work end-to-end

**The goal:** a stranger visits `daisyhelps.com`, downloads the installer, runs it, and has a real voice conversation with Daisy that lands on `api.daisyhelps.com`.

**Last updated:** 2026-05-17 (Phase 6 — desktop app real-backend wiring complete on `main`)

---

## Live production state

| URL | Backed by | State |
|---|---|---|
| `https://api.daisyhelps.com` | Render web service `srv-d84gqc7avr4c73d3aspg` | ✅ live, auto-deploys from `main` |
| `https://daisyhelps.com` | Render static site `srv-d84ip8naqgkc73am5cpg` | ✅ live, auto-deploys from `main` |
| `https://daisyhelps.com/download` | 301 → GitHub Releases latest `DaisyHelps-Setup.exe` | ✅ chain resolves; the served binary is **stale** — see below |
| GitHub Release `v0.1.0` | CI built from commit `884b215` | ⚠️ shipped, but built before the React renderer wire-up and the mic buffer fix — installer launches but mic crashes immediately and the React UI hadn't been wired to the real backend yet |

---

## What's left for a working public install

### 1. Cut `v0.1.1`

`main` now has the React renderer wired to the real backend (mic capture, audio playback, screenshot consent, interrupt, language toggle, click-target hint, draggable overlay, 5s silence cutoff, returning-state animation, stuck-thinking watchdog) and the `createScriptProcessor` buffer-size bug is fixed.

```powershell
# Bump desktop/package.json from "0.1.0" to "0.1.1"
git add desktop/package.json
git commit -m "desktop: bump to 0.1.1"
git tag v0.1.1
git push origin main v0.1.1
```

CI rebuilds and publishes; `daisyhelps.com/download` automatically points at the new asset (it's the `/latest/download/` redirect).

### 2. Resolve the ElevenLabs free-tier 401

The TTS step still returns `401 detected_unusual_activity` because the ElevenLabs account is on the free tier and Render's shared egress IPs trip the abuse heuristic. The pipeline runs all the way to `daisy_text` (captions show) and then fails on TTS — no audio plays. Options in order of effort:

1. **Subscribe to ElevenLabs Starter ($5/mo).** Their error body literally tells you to do this. Same API key, no code change. ← recommended
2. Add a fallback TTS provider (OpenAI `tts-1`, Groq, etc.) in `backend/pipeline/tts.py` behind the existing `STTProvider`-style interface.

Until either lands, every turn fails at audio playback. The React layer surfaces this as a friendly error banner and resets to idle (added in this session) instead of leaving the UI stuck.

### 3. Complete the screen-wide pointer overlay (partial scaffold landed)

Main-process plumbing for `click_indicator` is wired (`createIndicator()` BrowserWindow, IPC handlers, preload bridge, `DaisyAPI` interface). The indicator renderer (`indicator.{html,css,ts}`) and the `main.jsx` call site are still TODO. Full spec + handoff prompt for another agent: `docs/POINTER-OVERLAY-PROMPT.md`. Until that's done, the click-indicator backend message renders only as the yellow caption banner ("👉 Click on Mail, then tell me what happened").

### 4. Bump `backend/readiness.py` to phase 6

After v0.1.1 ships and the audio path works, edit `backend/readiness.py`:

```python
PHASE = 6
PHASE_NAME = "desktop-launch"
```

Commit + push — backend auto-deploys.

### 5. End-to-end stranger test

On a fresh Windows profile (or a friend's machine):

- [ ] Open `https://daisyhelps.com` in a fresh browser
- [ ] Click "Install Daisy" → downloads `DaisyHelps-Setup.exe`
- [ ] SmartScreen → "More info" → "Run anyway" → installer completes
- [ ] Launch from Start Menu → connects to backend within 10s
- [ ] Click "Start talking" on welcome → mic consent modal → Yes → conversation screen
- [ ] Click the corner daisy → screenshot fires → mic opens → speak → after 5s silence Daisy responds → audio plays
- [ ] Drag the corner daisy → moves cleanly without growing/jittering
- [ ] Run through the Zoom-with-doctor demo (`docs/DEMO.md`) successfully

---

## Test the current `main` on your local machine right now (no release needed)

```powershell
cd desktop
npm install       # only first time
npm run dev       # builds + launches Electron with renderer console logging
```

Mic works, captions work, click-overlay drag works. Audio playback won't work until ElevenLabs is sorted.

---

## Carry-forward — deferred items (non-blocking)

- **Pointer overlay renderer** — see "What's left" #3 and `docs/POINTER-OVERLAY-PROMPT.md`.
- **Persona / prompt iteration** — run the demo through the installed app 5+ times; tighten `backend/prompts.py` for jargon, multi-step responses, and "I don't know" handling.
- **AudioWorklet migration** — replace `ScriptProcessorNode` (deprecated) in `desktop/src/renderer/main.jsx`.
- **ONNX Silero VAD** — replace torch dep with onnxruntime in `backend/pipeline/vad.py`; cuts ~250MB from deploy.
- **`datetime.utcnow()` → `datetime.now(timezone.utc)`** in `backend/session.py`.
- **TTS retry / fallback** in `backend/main.py:_run_turn` — currently single attempt; transient errors emit `turn_failed`.
- **Auth / rate limiting** — anyone with the WS URL can connect; middleware before `websocket.accept()`.
- **Session persistence** — `SessionStore` abstraction; swap to Redis-backed impl.
- **Designer pass on icons** — `desktop/build/icon.ico` and `desktop/build/tray-icon.png` are placeholders.
- **macOS / Linux installers** — Windows-only at v1 per `docs/DECISIONS.md`.
- **EV code-signing cert** for the Windows installer (~$300/yr).
- **`desktop-ci.yml` runs only on `pull_request`** — direct pushes to `main` bypass it. Add `push: branches: [main]` to catch regressions from non-PR pushes (Niya's renderer rewrite slipped a TypeScript error through to a release tag because of this).

---

## Where to look for what

| For | Read |
|---|---|
| Local dev / build / release | `docs/RUNBOOK.md` |
| Demo script (Zoom-with-doctor) | `docs/DEMO.md` |
| WebSocket protocol contract | `docs/API.md` |
| System architecture | `docs/ARCHITECTURE.md` |
| Why decisions were made | `docs/DECISIONS.md` |
| Pointer-overlay implementation handoff | `docs/POINTER-OVERLAY-PROMPT.md` |
| Desktop renderer (React/JSX, real backend hook) | `desktop/src/renderer/main.jsx` |
| Desktop native bridge | `desktop/src/main.ts`, `desktop/src/preload.ts` |
| Production infra (service IDs, zones) | memory note `reference_daisy_deploy_infra.md` |
| Feature readiness flags | `backend/readiness.py` (or `GET /api/status`) |
| Daisy's voice (system prompt) | `backend/prompts.py` |
