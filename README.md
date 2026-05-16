# Daisy Helps — Backend

Voice AI companion backend that helps tech-novice users (especially the elderly) through computer tasks one step at a time. Daisy listens by voice, sees the screen on demand via screenshots, and guides the user — she never takes actions for them.

**This repo is the backend.** A separate frontend (built later with a Claude design agent) will connect via WebSocket.

## Quick start

```bash
python -m venv .venv
# PowerShell:  .venv\Scripts\Activate.ps1
# Bash:        source .venv/Scripts/activate
pip install -r requirements.txt
cp .env.example .env   # then fill in real keys
uvicorn backend.main:app --reload --port 8000
```

Open `http://localhost:8000/test` for the debug harness.

## Docs

- [API contract](docs/API.md) — the WebSocket protocol the frontend reads
- [Architecture](docs/ARCHITECTURE.md)
- [Runbook](docs/RUNBOOK.md) — local dev, env vars, deployment
- [Decisions](docs/DECISIONS.md)
- [Demo script](docs/DEMO.md)
