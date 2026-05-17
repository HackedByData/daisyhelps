# Demo: Zoom with the doctor

The hardcoded demo task. End-to-end runtime: ~3–5 minutes.

## Setup (before the demo)

1. Download Daisy Helps from `https://daisyhelps.com/download`. The installer is `DaisyHelps-Setup.exe`. Click through any SmartScreen warning ("More info" → "Run anyway").
2. Launch from Start Menu → "Daisy Helps".
3. Confirm the window opens and the status pill reads "Ready" within ~2s (Render cold-start warming).
4. Optional warm-up: in another tab, visit `https://api.daisyhelps.com/healthz` — should return `{"status":"ok"}` instantly.

## Demo flow — "Help me join a Zoom call with my doctor"

| User says / does | Daisy says (approximate) |
|---|---|
| Start mic, "I have a Zoom call with my doctor and I can't get in." | "Of course — could you show me what's on your screen for a moment?" |
| Click "Show Daisy my screen" showing the email inbox. | "I can see your inbox. Could you scroll down until you see an email from your doctor?" |
| (Acknowledges) "OK I see it." | "Wonderful. Click on that email to open it." |
| "Done." | "Inside the email, look for a blue link that says 'Join Zoom Meeting.' Could you click it?" |
| "OK." (click "Show Daisy my screen" on the Zoom join page) | "Perfect. Now you'll see a window asking if you want to use audio. Click 'Join with Computer Audio.'" |
| "OK done." | "Now find the microphone icon at the bottom left. If there's a line through it, click it once to turn it on." |
| "OK." | "And next to it, click the camera icon to turn on your camera. … You did wonderfully. Your doctor can see and hear you now." |

## Failure modes

- **Screenshot doesn't reach the LLM:** check Daisy's captions / dev console log — did `>> screenshot ...` appear, and did the next response use Sonnet? (Look at server logs: `LLM call model=claude-sonnet-4-6`.)
- **Daisy lists multiple steps:** prompt issue, not protocol. Iterate the prompt in `backend/prompts.py`.
- **Audio cuts out mid-response:** check for `audio_end` followed by no `status idle` — this can happen if the WS drops. Reconnect.
- **Spanish session sounds wrong / mixes languages:** verify `ELEVENLABS_VOICE_ID_ES` is a Spanish voice and `language_change` was sent before audio.
- **Slow first response:** Silero VAD + torch loading on cold start. Open Daisy and let it sit for ~10s before the demo (cold-start warming).

## Spanish variant

Same flow with "Tengo una cita con el doctor por Zoom y no puedo entrar" as the opener. Daisy responds in Spanish with the Spanish voice. The fixture screenshot can stay the same — Daisy reads English text fine and replies in Spanish.
