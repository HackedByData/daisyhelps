# Runbook

## Local dev

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

## Env vars

| Name | Required | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | Claude (Haiku for text turns, Sonnet for screenshot turns) |
| `GROQ_API_KEY` | yes | Groq Whisper Large v3 Turbo |
| `ELEVENLABS_API_KEY` | yes | TTS |
| `ELEVENLABS_VOICE_ID_EN` | yes | English voice ID |
| `ELEVENLABS_VOICE_ID_ES` | yes | Spanish voice ID |
| `LOG_LEVEL` | no | DEBUG / INFO / WARNING / ERROR (default INFO) |

## Tests

```bash
pytest -q
```

All four test files (VAD, LLM router, session, WS messages) must pass. Total runtime < 5s.

## Deployment
(Filled in at Phase 5.)

## Troubleshooting

- **Server fails to start with `GROQ_API_KEY not set`** — populate `.env`.
- **VAD test fails on sine wave** — Silero may not classify a pure sine as speech. Replace with a recorded clip from `test_harness/fixtures/hello.wav` if needed.
- **No audio playing back** — check browser console for autoplay-block; click anywhere on the page first to satisfy the user-gesture requirement, then connect.
- **First request slow (~10–30s)** — Silero model + torch loading on first VAD call. Warm up by hitting `/test` and clicking Connect before the demo.
