# TODO — make the tool work end-to-end

**The goal:** a stranger visits `daisyhelps.com`, clicks "Download for Windows", runs the installer, launches Daisy, and has a voice conversation that lands on `api.daisyhelps.com`.

**What's already true** (don't redo):
- Backend is live at `https://api.daisyhelps.com` (Render `srv-d84gqc7avr4c73d3aspg`, auto-deploys from `main`).
- Landing site is live at `https://daisyhelps.com` (Render `srv-d84ip8naqgkc73am5cpg`, auto-deploys from `main`).
- Custom domains for the landing site (`daisyhelps.com`, `www.daisyhelps.com`) are added and verified.
- `/download` already 301-redirects to `https://github.com/HackedByData/daisyhelps/releases/latest/download/DaisyHelps-Setup.exe`.
- `desktop/electron-builder.yml` produces a stable filename `DaisyHelps-Setup.exe` (no version suffix), so the redirect target is correct.
- Release CI workflow (`.github/workflows/release.yml`) is wired to fire on `v*` tags.
- Desktop app's `WS_BASE` (`desktop/src/renderer/app.ts:4`) is hardcoded to `wss://api.daisyhelps.com`, so it talks to live backend with zero config.

**What's missing:** no GitHub Release exists yet → `daisyhelps.com/download` 301s to a 404.

---

## A. Test the app on your local machine RIGHT NOW (no release needed)

Two ways, pick whichever — both connect to the live `api.daisyhelps.com` backend.

### Option A1 — dev mode (fastest, ~30s to launch)

Runs the app from source. Best for iterating.

```powershell
cd desktop
npm start
```

Expected: Electron window opens within ~5s. Wait for "Ready" status pill (~1–10s — Render cold start the first time, then warm). Walk through `docs/DEMO.md`.

### Option A2 — build and install the real `.exe` (~3 min build + install)

Best for verifying what end users will experience (Start Menu shortcut, tray icon, SmartScreen warning, etc.). The current `desktop/release/DaisyHelps-Setup-0.1.0.exe` is **stale** (built before the renderer rewrite in commit `37974bd`) — rebuild before testing.

```powershell
cd desktop
npm run release
# → desktop/release/DaisyHelps-Setup.exe   (~80MB, takes 1–3 min)
```

Then run the installer:

```powershell
.\release\DaisyHelps-Setup.exe
```

- Windows SmartScreen: **"Windows protected your PC"** → click `More info` → `Run anyway` (this is the unsigned-installer warning we accept at v1; documented on the landing page).
- Installer prompts for install location → defaults are fine → click Install.
- Launches "Daisy Helps" from the Start Menu.
- Verify the demo flow in `docs/DEMO.md` (mic, voice reply, screen capture, interrupt, language toggle, tray-on-close).

### Verification checklist (works for both options)

- [ ] Status pill flips from "Connecting…" → "Ready" within 10s
- [ ] Mic permission prompt appears on first speak; reply audio plays
- [ ] "Show Daisy my screen" → native picker → screenshot reaches backend (Daisy says something specific to what's on-screen)
- [ ] Interrupting Daisy mid-speech cuts off audio within ~200ms
- [ ] Language toggle flips voice EN ↔ ES on the next reply
- [ ] (A2 only) Closing the window leaves a tray icon; clicking re-opens

If any step fails, check the Electron devtools console (View → Toggle Developer Tools in the window menu, if enabled — otherwise `npm run dev` instead of `npm start` enables logging).

---

## B. Make the download button work for the public (cut v0.1.0)

After local testing passes, this is the one-command public launch.

### B1 — Tag and push

```powershell
git tag v0.1.0
git push origin v0.1.0
```

This fires `.github/workflows/release.yml` on `windows-latest`. The workflow:
1. Runs `npm run build && electron-builder --win --publish always`
2. Creates a GitHub Release `v0.1.0`
3. Uploads `DaisyHelps-Setup.exe` + `latest.yml` (auto-update feed)

Watch progress: https://github.com/HackedByData/daisyhelps/actions

### B2 — Verify the public download path end-to-end (~6 min after tag)

```powershell
# Should return HTTP 302 with a location header pointing at the actual release asset URL
curl -sI https://daisyhelps.com/download

# Follow the redirect and download a real binary (should be ~80MB)
curl -sL -o test-install.exe https://daisyhelps.com/download
Get-Item test-install.exe | Select-Object Length
```

Or in a browser: open https://daisyhelps.com → click "Download for Windows — Free" → installer downloads.

### B3 — Bump backend readiness to phase 6

After v0.1.0 is live, edit `backend/readiness.py`:

```python
PHASE = 6
PHASE_NAME = "desktop-launch"
```

Commit + push — auto-deploys to `api.daisyhelps.com`. Verify:

```powershell
curl https://api.daisyhelps.com/api/status
# → "phase":6, "phase_name":"desktop-launch"
```

### B4 — End-to-end stranger-test

On a fresh Windows profile (or a friend's machine — ideally someone non-technical):

- [ ] Open `https://daisyhelps.com` in a fresh browser
- [ ] Click "Download for Windows — Free"
- [ ] Installer downloads as `DaisyHelps-Setup.exe`
- [ ] Double-click → SmartScreen → "More info" → "Run anyway"
- [ ] Installer completes; "Daisy Helps" appears in Start Menu
- [ ] Launch → connects to backend within 10s
- [ ] Run through the Zoom-with-doctor demo successfully

If all six check, **the tool works end-to-end for the public**.

---

## C. Known caveats users will hit

| Issue | Mitigation in place | Fix-it-later |
|---|---|---|
| SmartScreen "Unknown publisher" warning | Landing page tells them to click "More info" → "Run anyway" | EV code-signing cert (~$300/yr); slot in `desktop/electron-builder.yml` `win.signtoolOptions` |
| First WS connect cold-starts Silero VAD (~10s) | Test page or `/healthz` warms the backend; landing page link to status | Replace silero-vad pip package with ONNX (`onnxruntime`); cuts ~250MB from deploy |
| Mic permission denied → no error visible | Captions surface the error (see `desktop/src/renderer/app.ts` mic-error path) | Already shipped |
| Windows-only | Documented on landing page | macOS needs Apple Dev cert + notarization; Linux needs `target: AppImage` in `electron-builder.yml` + CI matrix expansion |

---

## D. Deferred (non-blocking — pick up later)

- **Persona / prompt iteration** — run the demo through the installed app 5+ times; tighten `backend/prompts.py` for "lists multiple steps", jargon, recovery.
- **AudioWorklet migration** in `desktop/src/renderer/app.ts` (currently uses deprecated `ScriptProcessorNode`).
- **ONNX Silero VAD** — replace torch dep with onnxruntime in `backend/pipeline/vad.py`.
- **Migrate `datetime.utcnow()` → `datetime.now(timezone.utc)`** in `backend/session.py`.
- **Retry on transient TTS / LLM errors** in `backend/main.py:_run_turn` — currently emits `turn_failed` once and stops.
- **Auth / rate limiting** — anyone with the WS URL can connect.
- **Session persistence** — `SessionStore` is the abstraction; swap to Redis-backed impl.
- **Designer pass on icons** — `desktop/build/icon.ico` and `desktop/build/tray-icon.png` are flat placeholders.
- **macOS / Linux installers** — see Caveats table above.

Full deferred-features inventory lives in `CLAUDE.md`.

---

## Where to look for what

| For | Read |
|---|---|
| Local dev / build / release recipes | `docs/RUNBOOK.md` |
| Demo script (the Zoom-with-doctor flow) | `docs/DEMO.md` |
| WebSocket protocol contract | `docs/API.md` |
| System architecture | `docs/ARCHITECTURE.md` |
| Why decisions were made | `docs/DECISIONS.md` |
| Feature readiness flags | `backend/readiness.py` (or `GET /api/status`) |
| Daisy's voice (system prompt) | `backend/prompts.py` |
| Desktop client behavior | `desktop/src/renderer/app.ts` |
| Desktop native bridge | `desktop/src/main.ts`, `desktop/src/preload.ts` |
| Production infra (service IDs, zones) | memory note `reference_daisy_deploy_infra.md` |
