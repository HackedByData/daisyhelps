# Decisions

A decision log. One paragraph per choice: context, decision, rationale, alternatives.

## STT: Groq Whisper Large v3 Turbo
**Context:** End-of-utterance to first audio byte budget is 2.5s.
**Decision:** Use Groq Whisper Large v3 Turbo.
**Rationale:** Roughly 3–5× faster than OpenAI Whisper at comparable accuracy.
**Alternatives considered:** OpenAI Whisper (slower), local faster-whisper (heavier, no GPU on Render).
**How to swap:** Add a new `STTProvider` subclass and change one line in `pipeline/stt.py`.

## VAD: silero-vad PyPI package over torch.hub.load
**Context:** Spec said `torch.hub.load('snakers4/silero-vad', ...)`. That downloads the model on first call, slowing cold start on Render.
**Decision:** Use the `silero-vad` PyPI package, which bundles the model.
**Rationale:** Same underlying model, simpler imports, no first-call network dependency. Faster Render cold start.
**Alternatives considered:** torch.hub (spec default; slower cold start). ONNX runtime (lightest but more code; future optimization if torch footprint becomes a problem).

## Screenshot lifecycle: always-include-most-recent-within-60s
**Context:** Phase 2 needs a way to decide when to attach the screenshot to a Claude call.
**Decision:** Always attach the most recent screenshot if it's < 60s old; route to Sonnet when attached; mark consumed after attach.
**Rationale:** Heuristic phrase detection in Daisy's response is fragile. The 60s window balances "fresh enough that the screen state is likely still relevant" against "user has actually finished talking."
**Alternatives considered:** Heuristic on response text (fragile). Structured tag emitted by the LLM (more reliable but slows iteration). Multi-image conversation memory (out of scope; could be added later).

## Proactive screenshot_request emission
**Context:** When the user mentions visual cues but no fresh screenshot exists, the frontend has no hint that one would be useful.
**Decision:** Server emits a `screenshot_request` message when the user's text contains visual-cue words AND no fresh screenshot is pending.
**Rationale:** Low-cost UX hint; future frontend can render a "share screen?" prompt.
**Alternatives considered:** Letting the LLM produce a structured tag (more reliable, but couples prompt + protocol; defer to a later iteration).

## Deployment plan: Render `starter` plan over `free`
**Context:** Render free tier sleeps after inactivity and has tighter memory limits. Torch CPU is ~250MB; Silero adds a small model.
**Decision:** Use the `starter` plan ($7/mo) to avoid sleep cycles and memory pressure during demos.
**Rationale:** Hackathon demo reliability > $7. Free works most of the time but the cold-start delay after a sleep can push past the latency budget on the user's first interaction.
**Alternatives considered:** Free tier (cheap, occasional OOM/sleep). Higher plans (overkill).

## Custom domain: api.daisyhelps.com (not bare daisyhelps.com)
**Context:** daisyhelps.com is purchased; the bare domain might host the future frontend.
**Decision:** Backend lives at `api.daisyhelps.com`; bare `daisyhelps.com` left unconfigured for the future frontend.
**Rationale:** Clean separation. No migration cost if/when the frontend ships.
**Alternatives considered:** Bare domain for backend (forces frontend onto a subdomain later). Both on bare with path-routing (more deploy complexity).
