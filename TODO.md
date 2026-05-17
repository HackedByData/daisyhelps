# TODO

State of the Daisy Helps repo. **Phase 6 (desktop + landing) is code-complete and both services are live in production. Only the first public release remains.**

**Last updated:** 2026-05-17

---

## Status at a glance

| Area | State |
|---|---|
| Phase 0 — Scaffold | ✅ |
| Phase 1 — Voice loop | ✅ |
| Phase 2 — Vision | ✅ |
| Phase 3 — Multi-turn + interrupts | ✅ |
| Phase 4 — Language toggle + text fallback | ✅ |
| Phase 5 — Backend deploy + click-indicator | ✅ live at `api.daisyhelps.com` |
| Phase 6 — Desktop app + landing page | ✅ code complete; landing live at `daisyhelps.com` |
| Public release (v0.1.0) | ⏳ pending — see "What's left" below |

`backend/readiness.py` is still on `phase: 5, phase_name: "click-indicator"`. It bumps to `phase: 6, phase_name: "desktop-launch"` after v0.1.0 is cut.

**Tests:** `pytest -q` — 29 unit tests on the backend (all green). `cd desktop && npm test` — vitest on the audio utilities.

---

## Live production state (as of 2026-05-17)

| URL | What it serves | Backed by |
|---|---|---|
| `https://api.daisyhelps.com` | FastAPI + WebSocket backend (`/ws/{session_id}`, `/healthz`, `/api/status`, `/test`) | Render web service `srv-d84gqc7avr4c73d3aspg` (commit `37974bd`) |
| `https://daisyhelps.com` | Apex → 301 → `www.daisyhelps.com` (Render-managed redirect) | Render static site `srv-d84ip8naqgkc73am5cpg` |
| `https://www.daisyhelps.com` | Landing page (`landing/index.html`) | same static site |
| `https://daisyhelps.com/download` | 301 → `…/releases/latest/download/DaisyHelps-Setup.exe` | static-site route `rdr-d84ismgjo89c73atlb70` |

Both services auto-deploy on push to `main`. Custom domains for the static site (`daisyhelps.com`, `www.daisyhelps.com`) are added and **verified** in Render. Cloudflare zone `daisyhelps.com` holds the DNS records.

Security headers (`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`) are applied to the static site via the Render API (`hdr-d84isofavr4c73d4juo0`, `hdr-d84isod7vvec73fadmhg`).

**Caveat:** `daisyhelps.com/download` currently 404s **at the destination** because no GitHub Release exists yet. The redirect resolves correctly; the file it points at doesn't exist until v0.1.0 ships.

---

## What's left (Phase 6 → public launch)

### 1. Cut v0.1.0 — the one thing standing between us and a working `/download`

```powershell
# from repo root
git tag v0.1.0
git push origin v0.1.0
```

This fires `.github/workflows/release.yml` on `windows-latest`, which:
- builds the NSIS installer (`DaisyHelps-Setup.exe`, no version suffix — fixed in `afb24d0`)
- creates a GitHub Release `v0.1.0`
- uploads `DaisyHelps-Setup.exe` + `latest.yml` (electron-updater feed)

After ~5 minutes CI finishes, `https://daisyhelps.com/download` will serve a real installer.

### 2. Bump `backend/readiness.py` to phase 6

After v0.1.0 ships, edit `backend/readiness.py`:

```python
PHASE = 6
PHASE_NAME = "desktop-launch"
```

Commit, push — auto-deploys to `api.daisyhelps.com`.

### 3. Manual smoke of the installed app

Run through `docs/DEMO.md` end-to-end on a fresh Windows profile:
- download from `daisyhelps.com/download` → install → SmartScreen click-through → launch
- "Help me join a Zoom call with my doctor"
- "Show Daisy my screen" → native picker → screenshot reaches backend
- voice reply plays; interrupting mid-speech cancels TTS
- language toggle flips voice EN ↔ ES
- close → tray icon remains → re-open from tray

---

## Carry-forward — deferred items (non-blocking)

- **Persona / prompt iteration** — run the demo through the installed desktop app 5+ times; tighten `backend/prompts.py` for "lists multiple steps", jargon, recovery.
- **AudioWorklet migration** in `desktop/src/renderer/app.ts` (currently uses deprecated `ScriptProcessorNode`, same as the test harness).
- **ONNX Silero VAD** — replace `silero-vad` + torch with `onnxruntime` to cut ~250MB from the backend deploy footprint.
- **Migrate `datetime.utcnow()` → `datetime.now(timezone.utc)`** in `backend/session.py` (two call sites).
- **EV code-signing cert** for the Windows installer (~$300/yr) — skips SmartScreen entirely. Slot in `desktop/electron-builder.yml` `win.signtoolOptions`.
- **macOS / Linux installers** — electron-builder config exists for Windows; macOS needs Apple Dev cert + notarization, Linux just needs `target: AppImage` + a CI matrix expansion.
- **Designer pass on icons** — `desktop/build/icon.ico` and `desktop/build/tray-icon.png` are flat-color placeholders.
- **Retry on TTS / LLM transient errors** in `backend/main.py:_run_turn` — currently emits `turn_failed` once and stops.
- **Auth / rate limiting** — anyone with the WS URL can connect; middleware before `websocket.accept()`.
- **Session persistence** — `SessionStore` is the abstraction; swap to Redis-backed impl.

Full deferred-features inventory lives in `CLAUDE.md`.

---

## Where to look for what

| For | Read |
|---|---|
| Desktop pivot design | `docs/superpowers/specs/2026-05-16-daisy-helps-desktop-pivot-design.md` |
| Desktop implementation plan | `docs/superpowers/plans/2026-05-16-daisy-helps-desktop.md` |
| WebSocket protocol contract | `docs/API.md` |
| System architecture | `docs/ARCHITECTURE.md` |
| Local dev + env vars + deploy | `docs/RUNBOOK.md` |
| Why decisions were made | `docs/DECISIONS.md` |
| The demo script | `docs/DEMO.md` |
| Feature readiness flags | `backend/readiness.py` (or `GET /api/status`) |
| Daisy's voice (system prompt) | `backend/prompts.py` |
| Phase 6 session retro | `PHASE-6-COMPLETION-2026-05-16.md` |
| Desktop pivot handoff notes | `HANDOFF-desktop-pivot.md` |
