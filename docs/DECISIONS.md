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

## Click indicator: Claude computer-use tool in look-but-don't-act mode
**Context:** Elderly and tech-novice users struggle to locate UI elements from a verbal description alone. Daisy says "click the blue Join button" and the user can't find it on a crowded page. With the production client being a downloaded Electron desktop app, we have the OS-level capability to draw an overlay highlight anywhere on the user's actual screen — and the OS-level capability to script the click itself. We deliberately do only the former.
**Decision:** After the voice response finishes, make a second `claude-sonnet-4-6` call against the same screenshot with the `computer_20250124` tool enabled. Read the `(x, y)` from the emitted `left_click` tool_use block, send it to the frontend as `click_indicator`. The desktop client renders a transparent overlay at that pixel and never invokes the click. Daisy's "guide, never do" principle is preserved by deliberate choice, not by technical constraint.
**Rationale:** Computer-use is first-party, requires zero new dependencies, and per Anthropic's own guidance is dramatically more reliable for pixel coordinates than raw-JSON prompting. The locator runs after `audio_end` so voice latency is unaffected. The indicator is best-effort and degrades silently on any failure. Coordinates are returned in screenshot-native pixel space so the desktop client can position the overlay regardless of DPI scaling or multi-monitor offset.
**Alternatives considered:** Set-of-Mark prompting with OmniParser or OCR (very accurate but adds a UI-element detector dependency and a pre-processing pass per screenshot). Raw JSON prompting ("return `{x, y}`") — unreliable for pixel coords. Multiple-indicator sequences — defers to v2; conflicts with the "one step at a time" prompt rule. Bounding-box indicators — defers to v2; computer-use returns a point, region would need a follow-up call. Actually executing the click — rejected as a violation of the product principle, even though the desktop client makes it technically trivial.
**How to swap:** Replace the body of `backend/pipeline/locator.locate_click_target` with any other targeting backend that returns a `ClickTarget`. Wire format and trigger conditions are unchanged.

## Desktop framework: Electron over Tauri / PyWebView
**Context:** Need a desktop wrapper for the existing HTML/JS UI with native mic + screen capture.
**Decision:** Electron with TypeScript.
**Rationale:** Mature `desktopCapturer` API matches our exact need (one-line screen-to-PNG). `electron-updater` against GitHub Releases gives auto-update for free. Bundled Chromium = identical rendering between dev and prod. Team is JS-fluent.
**Alternatives considered:** Tauri (~10× smaller installer but mic/screen plugins less mature, plus Rust learning curve). PyWebView (would let us reuse Python skills but loses auto-update story and is overkill given keys stay server-side).

## API keys: server-side, no BYOK
**Context:** Elderly target users won't have Anthropic / Groq / ElevenLabs accounts.
**Decision:** Keys stay in Render backend env vars; desktop app is a thin client.
**Rationale:** Zero-config install is critical for the demographic. Server-side keys also keep usage observable in one place for cost monitoring.
**Alternatives considered:** BYOK with first-launch wizard (kills the demographic). Hybrid auth-proxy with short-lived tokens (engineering complexity not justified at this scale).
**Cost implication:** API spend scales with installs. Acceptable for early stage; revisit at >1000 active users.

## Windows-only at v1; macOS / Linux deferred
**Context:** Target users predominantly on Windows. macOS requires Apple Developer Program ($99/yr) + signing + notarization.
**Decision:** Ship Windows installer first. Architecture is cross-target-ready in `desktop/electron-builder.yml`.
**Rationale:** Smallest scope that reaches the target audience. Mac/Linux additions are config-only later.
**Alternatives considered:** Day-one Mac (real audience but signing setup eats a sprint). Day-one Linux (easy build, near-zero target audience).

## Installer hosting: GitHub Releases (not S3, not Render)
**Context:** Need a stable URL and an auto-update feed.
**Decision:** GitHub Releases hosts `.exe` and `latest.yml`. `daisyhelps.com/download` redirects to the latest release asset.
**Rationale:** Free, durable, electron-updater natively reads the GH Releases format. Decouples release artifact from marketing site.
**Alternatives considered:** S3/CloudFront (more setup, costs money). Render Static (works but loses electron-updater integration). api.daisyhelps.com (couples releases to backend deploys).

## Code signing deferred at v1
**Context:** Unsigned Windows installers trigger SmartScreen "Unknown publisher" warning.
**Decision:** Ship unsigned at v1; landing page documents the warning.
**Rationale:** EV code-signing certs are ~$300/yr and require corporate ID verification. Not justified before product-market fit. Warning is annoying but doesn't block install.
**How to swap:** Buy EV cert, add four lines to `desktop/electron-builder.yml`, set two CI secrets (`WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`), retag a release.
