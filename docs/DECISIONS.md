# Decisions

A decision log. One paragraph per choice: context, decision, rationale, alternatives.

## STT: Groq Whisper Large v3 Turbo
**Context:** End-of-utterance to first audio byte budget is 2.5s.
**Decision:** Use Groq Whisper Large v3 Turbo.
**Rationale:** Roughly 3–5× faster than OpenAI Whisper at comparable accuracy.
**Alternatives considered:** OpenAI Whisper (slower), local faster-whisper (heavier, no GPU on Render).
**How to swap:** Add a new `STTProvider` subclass and change one line in `pipeline/stt.py`.

(Later phases append more entries.)
