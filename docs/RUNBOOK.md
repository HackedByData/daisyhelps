# Runbook

## Local dev
```bash
python -m venv .venv
# PowerShell:  .venv\Scripts\Activate.ps1
# Bash:        source .venv/Scripts/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn backend.main:app --reload --port 8000
```

## Env vars
| Name | Required | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | Claude (Haiku + Sonnet) |
| `GROQ_API_KEY` | yes | Groq Whisper Large v3 Turbo |
| `ELEVENLABS_API_KEY` | yes | TTS |
| `ELEVENLABS_VOICE_ID_EN` | yes | English voice |
| `ELEVENLABS_VOICE_ID_ES` | yes | Spanish voice |
| `LOG_LEVEL` | no | DEBUG / INFO / WARNING / ERROR (default INFO) |

## Tests
```bash
pytest -q
```

## Deployment
(Phase 5 fills in.)

## Troubleshooting
(Filled in as we hit issues.)
