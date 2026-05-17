# Daisy Helps

A friendly voice companion that walks tech-novice users (especially the elderly) through computer tasks, one step at a time. Daisy listens by voice, sees the screen when asked, and **guides — she never clicks for you**.

**Download:** https://daisyhelps.com
**Backend status:** https://api.daisyhelps.com/healthz

This repo contains two deployables and one library of docs:

| Where | What |
|---|---|
| [`desktop/`](desktop/) | The Electron Windows app users download |
| [`landing/`](landing/) | The static landing page at daisyhelps.com |
| [`backend/`](backend/) | The FastAPI WebSocket server at api.daisyhelps.com |
| [`docs/`](docs/) | API contract, architecture, runbook, decisions, demo |

## Quick start

### Run the desktop app from source

```bash
cd desktop
npm install
npm start
```

The app connects to `wss://api.daisyhelps.com` by default. To point at a local backend, change `WS_BASE` in `desktop/src/renderer/app.ts`.

### Run the backend locally

```bash
python -m venv .venv
# PowerShell:  .venv\Scripts\Activate.ps1
# Bash:        source .venv/Scripts/activate
pip install -r requirements.txt
cp .env.example .env   # then fill in real keys
uvicorn backend.main:app --reload --port 8000
```

Open `http://localhost:8000/test` for the backend debug harness (used for backend development without the desktop app).

### Build a Windows installer

```bash
cd desktop
npm run release   # produces desktop/release/DaisyHelps-Setup-x.y.z.exe
```

For a public release that auto-updates installed users, push a `v*` git tag — see `docs/RUNBOOK.md`.

## Docs

- [API contract](docs/API.md) — the WebSocket protocol both clients (desktop app + debug harness) speak
- [Architecture](docs/ARCHITECTURE.md)
- [Runbook](docs/RUNBOOK.md) — local dev, env vars, building installers, releases, deployment
- [Decisions](docs/DECISIONS.md)
- [Demo script](docs/DEMO.md)
- [Desktop pivot spec](docs/superpowers/specs/2026-05-16-daisy-helps-desktop-pivot-design.md)