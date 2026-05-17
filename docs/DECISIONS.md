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

## Renderer: React/Babel/CDN, not bundled TS
**Context:** The Phase 6 design-handoff prototype (Claude Design export) was a React/JSX app that loaded React + Babel from `unpkg`. The first Phase 6 implementation (commit `37974bd`) ported it to vanilla TypeScript to get a smaller, ESM-friendly build. The vanilla port made the production wire client straightforward but lost the design's visual fidelity — and the user wanted "look exactly like the prototype." Commit `eb3ffa3` reverted to React/JSX/Babel.
**Decision:** Renderer is JSX loaded via `<script type="text/babel">` and transpiled in-browser. Main process loads pages via a custom `app://` protocol (`main.ts` `protocol.handle('app', ...)` → `net.fetch(pathToFileURL(...))`) because Babel's runtime XHR is blocked by `file://` in sandboxed contexts. CSP allows `'unsafe-eval'` for Babel and `'unsafe-inline'` for the inline scripts Babel injects after transpilation. `connect-src 'self'` lets Babel fetch the `.jsx` modules.
**Rationale:** Design fidelity beats build sophistication for a v1 elder-facing app. The Babel-in-browser cost is one-time at page load (~200ms) and the production target — Windows desktop on consumer hardware — has the CPU budget for it. The `app://` protocol + CSP combo is the minimum set that makes the loader actually work; both gotchas are subtle and would be easy to break.
**Alternatives considered:** Webpack/Vite + bundled JSX (proper build pipeline; cleaner but threw away the design prototype's code structure verbatim and added build complexity). Stay vanilla TS and reimplement the design (lossy). esbuild-based JSX transform inline (no Babel dep but inline-script CSP issues remain).
**How to swap:** If perf becomes a problem, run Babel on `npm run build` instead of at page load; output pre-transpiled `.js` files; relax CSP to drop `'unsafe-eval'`. Loader code in `main.ts` and CSP in `index.html` are the two touchpoints.

## Real backend wired via `useDaisyBackend` React hook
**Context:** The design prototype shipped with `useSimulatedDaisy` — a local timer that faked `listening → thinking → speaking → idle` transitions and word-by-word caption streaming. Real audio capture, real audio playback, real screenshot consent, and real WS messages all had to be grafted on without disturbing the prototype's component tree.
**Decision:** A single React hook `useDaisyBackend()` in `desktop/src/renderer/main.jsx` owns: WS connect + reconnect, mic capture (ScriptProcessorNode → PCM16 → base64), audio playback (AudioBufferSourceNode queue with gapless scheduling against a tracked `playbackTime`), screenshot via `window.daisyAPI.captureScreen()` IPC, interrupt, language change, end-session, plus React state setters for everything the UI reads. The hook returns one object that the `App` component spreads into existing prototype components (`ConversationScreen`, `ActionBar`, `ScreenshotConsent`). The simulated hook was deleted in the same change.
**Rationale:** Keeps the visual layer (the prototype's JSX) entirely untouched. All wire logic lives in one place that's straightforward to test and replace if the protocol changes. Mirrors the old `app.ts` line-for-line so we know it's behaviorally equivalent.
**Alternatives considered:** Multiple smaller hooks (one per concern) — more idiomatic but the lifecycles are heavily coupled (mic feeds audio_chunk messages that drive transcript state that drives the button label that changes the action handler), so the seams felt artificial. Keep vanilla TS renderer (rejected — see decision above).

## Conversation UX: mic consent modal, 5s silence cutoff, click-target hint, returning-state transition
**Context:** The OS-level mic permission dialog never appears in Electron because `main.ts` `setPermissionRequestHandler` auto-grants `media`. The backend's VAD silence threshold is ~500ms which feels rushed for elderly users who pause while thinking. After a backend turn completes there's no signal back to the user that it's their turn again — they have to click the daisy. When the LLM suggests "click the Mail icon" we have a `click_indicator` from the locator but no visible way to show it.
**Decision:**
1. **In-app mic consent modal** on the welcome "Start talking" button. Renders the same modal-scrim styling as `ScreenshotConsent`, asks "May I use your microphone?" in plain English, on accept calls `getUserMedia` then immediately stops the stream to prime the permission grant.
2. **Client-side 5s silence cutoff** in `startTalking`. Each `onaudioprocess` callback computes the buffer's RMS; if it's above `SILENCE_THRESHOLD = 0.012` we refresh `lastSpeechAt`. A 500ms `setInterval` watchdog calls `stopMicCapture()` once 5s has elapsed without speech. Overrides the backend's VAD for end-of-utterance detection on this client.
3. **Auto-listen after Daisy ends with a question.** On `audio_end`, if `daisyText` ends with `?` or `¿` and no `clickHint` is pending, schedule `startTalking()` 500ms later — Daisy and the user fall into natural turn-taking without clicking.
4. **Click-target hint banner** when backend emits `click_indicator`: a yellow banner appears at the top of the conversation with the label ("👉 Click on Mail icon, then tell me what happened"). Suppresses auto-listen so the user can actually go perform the click. (Full screen-wide pointer overlay is a follow-up — spec lives in `docs/POINTER-OVERLAY-PROMPT.md`.)
5. **Returning-state animation transition** between thinking and speaking. The hook tracks `markState` separately from logical `state`; on `thinking → anything-non-thinking`, `markState` becomes `'returning'` for 1200ms. CSS rule on `[data-state="returning"] .mark__petal` clears the orbit animation and sets explicit `transform: translate(0,0) rotate(0)`; the existing `transition: transform 1.2s cubic-bezier(.4,0,.2,1)` smoothly floats each petal back to rest before the speaking chorus begins. The overlay window mirrors `markState` (not `state`) so both daisies stay visually in sync.
6. **Optimistic state changes.** `startTalking` immediately `setState('listening')` so the UI animates before the first audio chunk reaches the backend; `stopTalking` immediately `setState('thinking')`. Backend `status` messages override these on arrival. **Stuck-thinking watchdog**: if state stays in `thinking` for 25s the hook forces back to `idle` with a friendly error — defense in depth against backend hangs or `turn_failed` not arriving.
**Rationale:** Each item is a small UX delta with one root cause; bundling them in one decision because they share the elder-facing-app design philosophy: never make the user wait, never let them get stuck, always show them what's happening, never lie about the state of the system.
**Alternatives considered:** Skip the consent modal and rely on the silent Electron grant (works mechanically but felt like an omission to a non-tech user who asked "did I give it permission?"). Server-side silence cutoff (would require new backend protocol; client-side is self-contained). Full pointer overlay now (a separate transparent always-on-top window with click-through is ~150 LOC across new files and is queued, not skipped).

## Code signing deferred at v1
**Context:** Unsigned Windows installers trigger SmartScreen "Unknown publisher" warning.
**Decision:** Ship unsigned at v1; landing page documents the warning.
**Rationale:** EV code-signing certs are ~$300/yr and require corporate ID verification. Not justified before product-market fit. Warning is annoying but doesn't block install.
**How to swap:** Buy EV cert, add four lines to `desktop/electron-builder.yml`, set two CI secrets (`WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`), retag a release.
