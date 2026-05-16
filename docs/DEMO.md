# Demo: Zoom with the doctor

The hardcoded demo task. End-to-end runtime: ~3–5 minutes.

## Setup
- Open `http://localhost:8000/test` (or the deployed `https://api.daisyhelps.com/test`).
- Grant microphone permission.
- Have a screenshot of an email inbox containing a Zoom invite ready (e.g., `test_harness/fixtures/email_screen.png`).

## Script

| User says / does | Daisy says (approximate) |
|---|---|
| Start mic, "I have a Zoom call with my doctor and I can't get in." | "Of course — could you show me what's on your screen for a moment?" |
| Send screenshot of email inbox. | "I can see your inbox. Could you scroll down until you see an email from your doctor?" |
| (Acknowledges) "OK I see it." | "Wonderful. Click on that email to open it." |
| "Done." | "Inside the email, look for a blue link that says 'Join Zoom Meeting.' Could you click it?" |
| "OK." (or new screenshot of Zoom join page) | "Perfect. Now you'll see a window asking if you want to use audio. Click 'Join with Computer Audio.'" |
| "OK done." | "Now find the microphone icon at the bottom left. If there's a line through it, click it once to turn it on." |
| "OK." | "And next to it, click the camera icon to turn on your camera. … You did wonderfully. Your doctor can see and hear you now." |

## Failure modes

- **Screenshot doesn't reach the LLM:** check the test page log — did `>> screenshot ...` appear, and did the next response use Sonnet? (Look at server logs: `LLM call model=claude-sonnet-4-6`.)
- **Daisy lists multiple steps:** prompt issue, not protocol. Iterate the prompt in `backend/prompts.py`.
- **Audio cuts out mid-response:** check for `audio_end` followed by no `status idle` — this can happen if the WS drops. Reconnect.
- **Spanish session sounds wrong / mixes languages:** verify `ELEVENLABS_VOICE_ID_ES` is a Spanish voice and `language_change` was sent before audio.
- **Slow first response:** Silero VAD + torch loading on cold start. Hit the page once before the demo to warm up.

## Spanish variant

Same flow with "Tengo una cita con el doctor por Zoom y no puedo entrar" as the opener. Daisy responds in Spanish with the Spanish voice. The fixture screenshot can stay the same — Daisy reads English text fine and replies in Spanish.
