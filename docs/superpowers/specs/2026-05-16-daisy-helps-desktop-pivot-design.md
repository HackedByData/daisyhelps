# Daisy Helps — Desktop App Pivot — Design Spec

**Date:** 2026-05-16
**Owner:** Devin
**Source prompt:** "We will be making this a desktop downloadable app. Review the codebase and make any changes necessary to download this app locally onto a computer. We will use daisyhelps.com as a landing page to download the app. Change any required documentation to reflect this pivot."
**Status:** Approved for implementation
**Depends on:** Phase 5 backend (deployed at `api.daisyhelps.com`) — pending DNS/Render steps in `TODO.md`
**Supersedes (in part):** The "Production frontend (backend is ready; contract is `docs/API.md`)" row in `CLAUDE.md`'s deferred-features table. The frontend is no longer deferred; it is the focus of this pivot.

---

## 1. Mission

Ship Daisy Helps as a downloadable Windows desktop application that elderly and tech-novice users can install from `daisyhelps.com` in two clicks. The desktop app replaces the browser-based test harness as the production client; the existing FastAPI backend at `api.daisyhelps.com` is unchanged.

Going native unlocks the single biggest UX gap in the current architecture: **the user no longer needs to know what a screenshot is**. A "Show Daisy my screen" button captures the screen via OS APIs and ships it over the existing `screenshot` message — turning a multi-step task only a competent computer user can perform into a single button press.

The product principle stands: Daisy guides by voice, never acts. The desktop app does not script clicks, type into other applications, or take any action on the user's behalf. It only listens, sees on request, and speaks.

---

## 2. Scope

**In scope:**
- New `desktop/` directory: an Electron + TypeScript application that ports `test_harness/test_page.html` into a production UI, adds native screen capture, native mic permission handling, and auto-update.
- New `landing/` directory: a static single-page site for `daisyhelps.com` with a "Download for Windows" CTA pointing to the latest GitHub Releases installer.
- Electron-builder configuration producing a signed-on-best-effort `DaisyHelps-Setup-x.y.z.exe` (NSIS installer) for Windows x64.
- `electron-updater` wired to GitHub Releases for silent background update checks with user-prompted install on quit.
- Native `desktopCapturer` integration so the existing `screenshot` WebSocket message is now sourced from the OS, not a file picker.
- System tray icon so Daisy stays one click away while the user works in another app.
- Render Static Site config (`render.yaml` blueprint extended) to host `daisyhelps.com` from `landing/`.
- A versioned CI workflow (`.github/workflows/release.yml`) that builds the Windows installer on `v*` tags and attaches it to a GitHub Release.
- Documentation overhaul: `README.md`, `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/RUNBOOK.md`, `docs/DEMO.md`, `docs/DECISIONS.md`, `TODO.md` — all updated to reflect that the production client is a desktop app and the backend is one of two deployables.

**Out of scope (v1):**
- macOS and Linux installers. The architecture supports adding them later (electron-builder is cross-target); the cert/notarization work is what's deferred.
- Code-signing certificate purchase. Initial Windows installer ships unsigned; users will see a SmartScreen "Unknown publisher" warning. Documented in the landing page and `RUNBOOK.md`. Adding an EV cert later is a one-line `electron-builder.yml` change plus the cert file.
- Backend changes. The FastAPI server, wire protocol (`docs/API.md`), and Render deploy are unchanged. The desktop client is a drop-in replacement for the browser test harness, speaking the same WebSocket.
- Migrating the existing `test_page.html`. It is kept verbatim as the backend debug harness at `/test`.
- Bundling Python or any AI model into the installer. The app is a thin client; all heavy lifting stays on `api.daisyhelps.com`.
- Authentication / per-user accounts. Anyone with the installer can connect, identical to today.
- A "Bring Your Own Keys" mode. Decided against during brainstorming: server-side keys keep the install zero-config for the elderly target audience.

---

## 3. Architecture

### 3.1 Two-deployable layout

```
                    ┌─────────────────────────────┐
                    │   daisyhelps.com (landing)  │
                    │   Render Static Site        │
                    │   landing/index.html        │
                    └────────────┬────────────────┘
                                 │ "Download for Windows" link
                                 ▼
                    ┌─────────────────────────────┐
                    │  GitHub Releases            │
                    │  DaisyHelps-Setup-x.y.z.exe │
                    └────────────┬────────────────┘
                                 │ install
                                 ▼
  User's Windows PC
  ┌────────────────────────────────────────────────────────────┐
  │  Daisy Helps.exe (Electron)                                │
  │  ┌──────────────────────┐    ┌──────────────────────────┐  │
  │  │ main process (Node)  │    │ renderer (Chromium)      │  │
  │  │ - tray icon          │    │ - HTML UI (ported from   │  │
  │  │ - desktopCapturer    │◀──▶│   test_page.html)        │  │
  │  │ - electron-updater   │    │ - mic capture            │  │
  │  │ - permissions        │    │ - audio playback         │  │
  │  └──────────────────────┘    │ - WebSocket client       │  │
  │                              └──────────┬───────────────┘  │
  └─────────────────────────────────────────┼──────────────────┘
                                            │ wss://
                                            ▼
                    ┌─────────────────────────────┐
                    │  api.daisyhelps.com         │
                    │  Render Web Service         │
                    │  FastAPI + WebSocket        │
                    │  (UNCHANGED)                │
                    └─────────────────────────────┘
```

Two `render.yaml` services (one extended, one new):
1. `daisy-helps-backend` — existing Python service at `api.daisyhelps.com`.
2. `daisy-helps-landing` — new static site at `daisyhelps.com` + `www.daisyhelps.com`, building from `landing/`.

GitHub Releases is the third pseudo-deployable, owned by a release CI workflow rather than Render.

### 3.2 Electron process model

Two processes per running app, communicating over IPC:

**Main process (`desktop/src/main.ts`)** — Node.js context, full OS access. Responsibilities:
- Create the `BrowserWindow` at launch
- Register a tray icon and a "Show / Hide / Quit" context menu
- Handle `desktopCapturer.getSources({ types: ['screen'] })` requests from the renderer over IPC. On multi-monitor systems, present a chooser; on single-monitor, return the only source.
- Initialize `electron-updater`: check for updates 30s after launch, then every 6 hours. On `update-downloaded`, set a flag so the app installs on quit.
- Grant microphone permission to the renderer's `session` once at install (`session.setPermissionRequestHandler`), so the user never sees the browser-style permission prompt.

**Renderer process (`desktop/src/renderer/`)** — Chromium context, sandboxed. Responsibilities:
- Render the UI (the ported `test_page.html`)
- Open `WebSocket(wss://api.daisyhelps.com/ws/{uuid})`
- Capture mic at 16 kHz mono PCM, encode base64, send as `audio_chunk` (identical to current browser flow)
- Play back received `audio_chunk` PCM at 24 kHz (identical to current browser flow)
- When the user clicks "Show Daisy my screen", call `window.daisyAPI.captureScreen()` (a preload-exposed function). Receive a PNG buffer, base64-encode, send as `screenshot` (identical wire format to current browser flow).
- Render `daisy_text` partial frames as live captions
- Render `status` changes (`idle`/`listening`/`thinking`/`speaking`) as a visible state pill
- Render `click_indicator` / `clear_indicator` as a screen-overlay halo (separate spec — already approved)

**Preload script (`desktop/src/preload.ts`)** — bridges the two via `contextBridge.exposeInMainWorld('daisyAPI', { captureScreen, ... })`. Renderer cannot access Node directly; only the explicit allow-listed API.

### 3.3 Screen capture flow (the headline UX change)

```
User clicks "Show Daisy my screen"
  ↓
renderer: window.daisyAPI.captureScreen()
  ↓ IPC
main: desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1920, height: 1080 } })
  ↓
main: (if multi-monitor) show a chooser window with thumbnails
  ↓
main: thumbnail → toPNG() → Buffer → return over IPC
  ↓
renderer: base64-encode → ws.send({ type: 'screenshot', data: '...' })
  ↓
backend (unchanged): validate PNG magic, store in session, attach to next LLM call
```

No backend changes. The `screenshot` message Pydantic model is identical. The 60s freshness window, vision routing, and `screenshot_request` flow all keep working.

The same button is auto-pressed by the renderer when a `screenshot_request` message arrives from the server, so the existing proactive-screenshot UX upgrades automatically.

### 3.4 Auto-update flow

`electron-updater` polls a GitHub Releases feed (`latest.yml`) published by the CI workflow. When a newer version is found:
1. Background download (no user friction during use)
2. On `update-downloaded`, the menu shows a non-modal "Update ready — restart Daisy to install" badge
3. On normal quit (tray → Quit, or Cmd-Q equivalent), installer runs and relaunches
4. If the user doesn't quit for a week, a gentle in-app banner appears

Versioning: semver in `desktop/package.json`. Backend phase number (`backend/readiness.py`) and desktop version are independent — they each get their own changelog. Wire-protocol compatibility is the contract that holds them in sync; if either side breaks it, that's a P0 bug.

### 3.5 Distribution flow

Release tagging: `git tag v0.1.0 && git push --tags` triggers `.github/workflows/release.yml`, which:
1. Spins up `windows-latest`
2. Installs Node deps in `desktop/`
3. Runs `npm run build` (compiles TS, bundles renderer)
4. Runs `npm run release` (electron-builder → `.exe`)
5. Uploads the `.exe` and `latest.yml` to the GitHub Release for the tag

Once the release is published, `daisyhelps.com` always points to `…/releases/latest/download/DaisyHelps-Setup.exe`. The landing page itself is static and doesn't need to know specific version numbers.

---

## 4. Components

### 4.1 `desktop/` — Electron app

| File | Responsibility |
|---|---|
| `desktop/package.json` | Electron + electron-builder + electron-updater + typescript deps |
| `desktop/tsconfig.json` | TS config for main + preload |
| `desktop/electron-builder.yml` | Windows NSIS target, app id `com.daisyhelps.app`, icon, GH Releases publish config |
| `desktop/src/main.ts` | Main process: window, tray, IPC handlers, updater |
| `desktop/src/preload.ts` | `contextBridge` exposing `captureScreen()` and (future) `setMicGain()` |
| `desktop/src/renderer/index.html` | Production UI (port of `test_page.html` minus debug controls) |
| `desktop/src/renderer/app.ts` | WebSocket client, mic capture, audio playback, status/caption rendering |
| `desktop/src/renderer/styles.css` | Daisy visual identity — large fonts, high contrast, simple |
| `desktop/build/icon.ico` | Windows app icon (256×256 multi-resolution) |
| `desktop/build/installer-banner.bmp` | NSIS installer side banner |

### 4.2 `landing/` — daisyhelps.com static site

| File | Responsibility |
|---|---|
| `landing/index.html` | Hero, "Download for Windows" CTA, brief value prop, SmartScreen warning explainer ("If Windows says 'Unknown publisher,' click 'More info' → 'Run anyway' — we're working on signing"), screenshot/video of Daisy in action |
| `landing/assets/` | Logo, screenshots, OG/Twitter card images |
| `landing/styles.css` | Same design tokens as the app for visual continuity |
| `landing/_redirects` | `/download → github releases latest .exe` (Render static site supports redirects) |
| `landing/robots.txt`, `landing/sitemap.xml` | SEO basics |

### 4.3 `.github/workflows/`

| File | Responsibility |
|---|---|
| `release.yml` | On `v*` tag: build Windows installer, attach to GH Release |
| `desktop-ci.yml` | On PR: `npm run lint && npm run build` in `desktop/` to catch breakage early |

### 4.4 Unchanged

`backend/`, `tests/`, `test_harness/`, `render.yaml` (extended, not rewritten), all of `docs/` (contents updated, structure stable).

---

## 5. Wire protocol

**No new messages, no field changes.** The desktop app is a new client for the existing protocol documented in `docs/API.md`. The contract surfaces touched:

- `screenshot` (client→server) — now sourced from `desktopCapturer` instead of a file input, but the wire payload is identical (base64 PNG)
- `screenshot_request` (server→client) — desktop client auto-triggers `captureScreen()` on receipt, eliminating one round-trip step the browser test harness required the user to do manually
- All other messages (`config`, `audio_chunk`, `user_text`, `language_change`, `interrupt`, `end_session`, `status`, `transcript`, `daisy_text`, `audio_chunk`, `audio_end`, `error`, `click_indicator`, `clear_indicator`) — identical handling in renderer

---

## 6. Doc updates required by this pivot

Listed in order of how much they change:

| Doc | Change |
|---|---|
| `README.md` | Restructure: top section becomes "Daisy Helps — desktop app + cloud backend". Add download CTA, add desktop dev quick-start alongside backend quick-start. Keep backend Live link. |
| `CLAUDE.md` | Add `desktop/` and `landing/` to the source-of-truth table and the working conventions. Remove or replace the "Production frontend" deferred-features row. Add the desktop-specific gotchas section (electron-builder Windows quirks, etc.). Phase progression table gains a Phase 6. |
| `TODO.md` | Replace the "Render deploy + DNS + final smoke" Phase 5 punch list (which mostly carries forward but is no longer the end state) with a Phase 6 punch list: desktop scaffold, port UI, native screen capture, installer build, landing page, CI workflow, first GitHub Release, daisyhelps.com DNS. |
| `docs/ARCHITECTURE.md` | Add a "Clients" section above "Components" explaining the two clients (Electron app — production; test harness — debug). Diagram updated to show the Electron client layer. |
| `docs/RUNBOOK.md` | New top-level sections: "Desktop dev" (run from source), "Building installers", "Cutting a release", "Landing-page deploy". Existing backend sections unchanged but moved under a "Backend ops" heading for clarity. |
| `docs/DEMO.md` | Demo flow starts from "double-click Daisy Helps on the desktop" instead of "open browser to /test". |
| `docs/DECISIONS.md` | Append: "Electron over Tauri" (mic/screen-capture maturity + team skills), "Server-side keys" (zero-config UX for elderly), "Windows-only at v1" (target audience + signing cost), "GitHub Releases for installer hosting" (free, electron-updater native support), "Render Static Site for landing page" (same dashboard as backend). |
| `docs/API.md` | One-line addition near the top: "Two clients speak this protocol: the production Electron app (`desktop/`) and the browser test harness (`test_harness/test_page.html`)." Otherwise unchanged. |

The original two specs (`2026-05-16-daisy-helps-backend-design.md`, `2026-05-16-click-indicator-design.md`) are historical and not edited. This spec adds a layer on top of both; it doesn't invalidate either.

---

## 7. Decisions

### Electron over Tauri or PyWebView
**Context:** Need a desktop wrapper for the existing HTML/JS test page, with native mic + screen capture.
**Decision:** Electron with TypeScript.
**Rationale:** Mature `desktopCapturer` API matches our exact need (one-line screen-to-PNG). `electron-updater` against GitHub Releases gives us auto-update for free. Bundled Chromium means identical rendering between dev and prod. The team is JS-fluent already — no Rust ramp.
**Alternatives considered:** Tauri (~10× smaller installer but mic/screen plugins less mature, plus Rust learning curve). PyWebView (would let us reuse Python skills but loses the auto-update story and is overkill given keys stay server-side).
**How to swap:** Tauri port would be a separate `desktop-tauri/` project — the renderer HTML/JS would mostly carry over; only the IPC and updater layers rewrite.

### Server-side API keys, no BYOK
**Context:** Elderly target users will not have Anthropic / Groq / ElevenLabs accounts.
**Decision:** Keys stay in the Render backend's env vars. Desktop app is a thin client connecting via WebSocket.
**Rationale:** Zero-config install is critical for the demographic. Server-side keys also keep usage observable in one place for cost monitoring.
**Alternatives considered:** BYOK with first-launch setup wizard (kills the demographic). Hybrid auth-proxy with short-lived tokens (engineering complexity not justified at this scale).
**Cost implication:** API spend scales with installs; not free. Acceptable for early-stage; revisit at >1000 active users.

### Windows-only at v1; macOS / Linux deferred
**Context:** Target users are predominantly on Windows. Mac requires Apple Developer Program ($99/yr) + signing + notarization to be installable.
**Decision:** Ship Windows installer first. Mac/Linux are architecture-ready (electron-builder cross-target) but not budgeted in v1.
**Rationale:** Smallest scope that reaches the target audience. Mac/Linux can be added without rearchitecting.
**Alternatives considered:** Day-one Mac (real audience, but signing setup eats most of a sprint). Day-one Linux (easy build, near-zero target audience).

### GitHub Releases for installer hosting; daisyhelps.com only hosts the landing page
**Context:** Need a stable URL the landing page links to, and an auto-update feed.
**Decision:** GitHub Releases hosts the `.exe` and `latest.yml`. `daisyhelps.com/download` redirects to the latest release asset.
**Rationale:** Free, durable, electron-updater natively understands the GH Releases format. Decouples the release artifact from the marketing site.
**Alternatives considered:** S3/CloudFront (more setup, costs money). Hosting on Render Static (works but loses electron-updater integration). Hosting on api.daisyhelps.com (couples release with backend deploys).

### Monorepo, not split repos
**Context:** Backend + desktop + landing could each be their own repo.
**Decision:** Single repo with `backend/`, `desktop/`, `landing/`, `docs/`, `tests/`, `test_harness/`.
**Rationale:** Wire protocol (`docs/API.md`) is the contract that ties backend and desktop together; co-locating means a protocol change is one PR, not a coordinated release across three repos. Small team, single CI runner, one history to read.
**Alternatives considered:** Three repos (cleaner separation but 3× the CI + dependency-update overhead).

### Code signing deferred
**Context:** Unsigned Windows installers trigger a SmartScreen "Unknown publisher" warning.
**Decision:** Ship unsigned at v1; the landing page documents the warning and how to click through.
**Rationale:** EV code-signing certs are ~$300/yr and require corporate ID verification. Not justified before product-market fit. The warning is annoying but doesn't block install.
**How to swap:** Buy EV cert, add four lines to `electron-builder.yml`, set two CI secrets, retag a release. ~1 hour.

---

## 8. Implementation phases (preview — full plan written in next step)

Detailed plan goes to `docs/superpowers/plans/2026-05-16-daisy-helps-desktop.md` via the writing-plans skill. High-level phases:

1. **Scaffold `desktop/`** — `npm init`, TS config, Electron hello-world window loading a placeholder page, tray icon, basic IPC.
2. **Port the UI** — copy `test_page.html` logic into `renderer/`, strip debug controls, restyle for elderly users (large fonts, high contrast, single big "Show Daisy my screen" button).
3. **Native screen capture** — `desktopCapturer` → IPC → renderer → existing `screenshot` WebSocket message. Multi-monitor chooser. Auto-trigger on `screenshot_request`.
4. **Auto-update wiring** — `electron-updater` against GitHub Releases. Test against a fake release on a fork.
5. **Build pipeline** — `electron-builder.yml`, manual `npm run release` produces a working `.exe`. Install it on a fresh Windows VM, smoke the full Zoom-with-doctor demo.
6. **`.github/workflows/release.yml`** — CI builds + uploads on `v*` tag.
7. **Landing page** — `landing/index.html` with download CTA, value prop, screenshot. `_redirects` for `/download`.
8. **Render Static Site** — extend `render.yaml` to add the landing service. Configure `daisyhelps.com` + `www.daisyhelps.com` DNS.
9. **Documentation overhaul** — all docs listed in §6.
10. **Cut v0.1.0 release** — first public installer + first daisyhelps.com deploy. End-to-end test: visit landing → download → install → run demo.

---

## 9. Done criteria

- [ ] `daisyhelps.com` resolves to the landing page with a visible "Download for Windows" button
- [ ] Clicking the button downloads `DaisyHelps-Setup-x.y.z.exe` from GitHub Releases
- [ ] On a fresh Windows 10/11 machine with no Python or other deps, double-clicking the installer completes install
- [ ] Launching the app shows Daisy's window and connects to `wss://api.daisyhelps.com/ws/{uuid}` without configuration
- [ ] Microphone permission is granted at install; no in-app permission prompt
- [ ] Clicking "Show Daisy my screen" sends a real PNG of the user's screen; Daisy's next reply references what she actually sees
- [ ] Cutting a `v0.1.1` tag triggers a CI build, attaches `.exe` + `latest.yml` to a new GitHub Release, and a running v0.1.0 install offers the update within 6 hours
- [ ] All five docs listed in §6 are updated and committed
- [ ] `pytest -q` still passes (29 tests; backend untouched)
- [ ] The Zoom-with-doctor demo from `docs/DEMO.md` runs end-to-end on the installed desktop app in under 5 minutes

---

## 10. Settled questions

1. **Landing page copy + visual identity** — **Utilitarian v1.** Clean, high-contrast, large-type hero with a single "Download for Windows" CTA, a 30-second value prop, a short list of what Daisy does ("listens to your voice", "sees your screen when you ask", "guides one step at a time"), a small SmartScreen-warning explainer, and a footer with a contact email. Real design pass deferred until there's an external marketing push.
2. **Tray-icon-only mode** — **Window-by-default with minimize-to-tray.** App launches a normal window. Closing the window minimizes to the system tray (right-click → Quit fully exits). This matches what elderly users expect from Windows apps while keeping Daisy reachable from the tray when they're working in another app. No global hotkey at v1 (would need a tutorial; elderly users aren't keyboard-shortcut natives).
3. **Telemetry / crash reporting** — **None at v1.** No Sentry, no analytics. Revisit if installs grow and we need crash visibility. Keeps the privacy story trivially explainable on the landing page ("we don't track anything").
4. **Installer / app name** — **`DaisyHelps`** (no space). Used for the binary, the Add/Remove Programs entry, the app id (`com.daisyhelps.app`), and the Start Menu shortcut. The verbal/marketing name "Daisy Helps" (with the space) is preserved in window title, landing-page copy, and Daisy's spoken self-references.
