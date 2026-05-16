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

The service deploys to Render automatically on every push to `main` via the `render.yaml` blueprint.

### One-time setup
1. Sign in to https://dashboard.render.com.
2. New → Blueprint, point at this repo. Render picks up `render.yaml`.
3. In the service settings → Environment, set the five secret env vars (`ANTHROPIC_API_KEY`, `GROQ_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID_EN`, `ELEVENLABS_VOICE_ID_ES`). `LOG_LEVEL` comes from `render.yaml`.
4. Custom Domain → add `api.daisyhelps.com`. Render gives a CNAME target.
5. At your registrar (where daisyhelps.com lives), add a CNAME `api` → that target.
6. Wait ~5 minutes for DNS + TLS cert.

### Verify a deploy
```bash
curl https://api.daisyhelps.com/healthz
# → {"status":"ok"}

python -m test_harness.test_client --url wss://api.daisyhelps.com --text "hello"
# → see audio_chunk messages and an output.pcm file
```

### Cold start
First request after idle has a ~10–30s warmup (torch + Silero loading). Hit `/healthz` or `/test` once before any demo.

## Troubleshooting

- **Server fails to start with `GROQ_API_KEY not set`** — populate `.env`.
- **VAD test fails on sine wave** — Silero may not classify a pure sine as speech. Replace with a recorded clip from `test_harness/fixtures/hello.wav` if needed.
- **No audio playing back** — check browser console for autoplay-block; click anywhere on the page first to satisfy the user-gesture requirement, then connect.
- **First request slow (~10–30s)** — Silero model + torch loading on first VAD call. Warm up by hitting `/test` and clicking Connect before the demo.
