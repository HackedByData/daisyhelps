# Runbook

This document covers desktop, landing, backend, and release operations.

---

## Desktop app — development

```powershell
cd desktop
npm install   # one-time
npm start     # launches Electron pointing at wss://api.daisyhelps.com
```

To point at a local backend, edit `WS_BASE` in `desktop/src/renderer/app.ts` to `ws://localhost:8000` and re-run `npm start`.

Run tests:
```powershell
cd desktop
npm test      # vitest run
```

## Desktop app — building a Windows installer locally

```powershell
cd desktop
npm run release
# → desktop/release/DaisyHelps-Setup.exe (~80MB)
# → desktop/release/latest.yml  (auto-update feed; references the version)
```

The first install on a fresh machine triggers Windows SmartScreen "Unknown publisher" — click "More info" → "Run anyway". This is expected until we ship a signed installer (deferred — see `CLAUDE.md`).

## Cutting a public desktop release

1. Bump the version in `desktop/package.json` (e.g., `"version": "0.1.1"`).
2. Commit: `git add desktop/package.json && git commit -m "desktop: bump to 0.1.1"`.
3. Tag: `git tag v0.1.1 && git push origin v0.1.1`.
4. CI (`.github/workflows/release.yml`) builds the installer on `windows-latest`, creates a GitHub Release, and uploads `DaisyHelps-Setup.exe` and `latest.yml`. The filename is stable across releases (version lives in `latest.yml` metadata), so `https://github.com/HackedByData/daisyhelps/releases/latest/download/DaisyHelps-Setup.exe` always resolves.
5. Within 6 hours, running v0.1.0 installs receive the update via electron-updater and show the "Update ready" badge.

## Landing page — local preview

```powershell
cd landing
python -m http.server 8080
# Open http://localhost:8080/
```

Note: the `/download` redirect only works through a host that reads `_redirects` (Render Static, Netlify) — not through plain `python -m http.server`. Local preview confirms layout; download flow is tested in production.

## Landing page — deployment

Production deploy is automatic via the Render Blueprint in `render.yaml`. Pushing changes to `landing/` on the main branch triggers a Render rebuild within ~1 minute.

To set up the service for the first time:
1. In the Render dashboard, sync the Blueprint from GitHub. The `daisyhelps-landing` service is created automatically.
2. In the service → Settings → Custom Domains, add `daisyhelps.com` and `www.daisyhelps.com`. Render returns CNAME/ALIAS targets.
3. At the registrar, add the records. Wait ~5 min for DNS + TLS.

---

## Backend ops

### Local dev

```bash
python -m venv .venv
# PowerShell:  .venv\Scripts\Activate.ps1
# Bash:        source .venv/Scripts/activate
pip install -r requirements.txt
cp .env.example .env
# Fill in real keys in .env
uvicorn backend.main:app --reload --port 8000
```

Open `http://localhost:8000/test`.

### Env vars

| Name | Required | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | Claude (Haiku for text turns, Sonnet for screenshot turns) |
| `GROQ_API_KEY` | yes | Groq Whisper Large v3 Turbo |
| `ELEVENLABS_API_KEY` | yes | TTS |
| `ELEVENLABS_VOICE_ID_EN` | yes | English voice ID |
| `ELEVENLABS_VOICE_ID_ES` | yes | Spanish voice ID |
| `LOG_LEVEL` | no | DEBUG / INFO / WARNING / ERROR (default INFO) |

### Tests

```bash
pytest -q
```

All four test files (VAD, LLM router, session, WS messages) must pass. Total runtime < 5s.

### Deployment

The service deploys to Render automatically on every push to `main` via the `render.yaml` blueprint.

#### One-time setup
1. Sign in to https://dashboard.render.com.
2. New → Blueprint, point at this repo. Render picks up `render.yaml`.
3. In the service settings → Environment, set the five secret env vars (`ANTHROPIC_API_KEY`, `GROQ_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID_EN`, `ELEVENLABS_VOICE_ID_ES`). `LOG_LEVEL` comes from `render.yaml`.
4. Custom Domain → add `api.daisyhelps.com`. Render gives a CNAME target.
5. At your registrar (where daisyhelps.com lives), add a CNAME `api` → that target.
6. Wait ~5 minutes for DNS + TLS cert.

#### Verify a deploy
```bash
curl https://api.daisyhelps.com/healthz
# → {"status":"ok"}

python -m test_harness.test_client --url wss://api.daisyhelps.com --text "hello"
# → see audio_chunk messages and an output.pcm file
```

#### Cold start
First request after idle has a ~10–30s warmup (torch + Silero loading). Hit `/healthz` or `/test` once before any demo.

### Troubleshooting

- **Server fails to start with `GROQ_API_KEY not set`** — populate `.env`.
- **VAD test fails on sine wave** — Silero may not classify a pure sine as speech. Replace with a recorded clip from `test_harness/fixtures/hello.wav` if needed.
- **No audio playing back** — check browser console for autoplay-block; click anywhere on the page first to satisfy the user-gesture requirement, then connect.
- **First request slow (~10–30s)** — Silero model + torch loading on first VAD call. Warm up by hitting `/test` and clicking Connect before the demo.
