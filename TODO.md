# TODO

State of the Daisy Helps repo. Phase 6 — the desktop + landing pivot — is in progress; backend Phase 5 (deployed) is complete.

**Last updated:** 2026-05-16 (Phase 6 in progress)

---

## Status at a glance

| Area | State |
|---|---|
| Phase 0 — Scaffold | ✅ |
| Phase 1 — Voice loop | ✅ |
| Phase 2 — Vision | ✅ |
| Phase 3 — Multi-turn + interrupts | ✅ |
| Phase 4 — Language toggle + text fallback | ✅ |
| Phase 5 — Backend deploy + click-indicator | ✅ |
| **Phase 6 — Desktop app + landing page** | 🚧 in progress |

`backend/readiness.py` will bump to `phase: 6, phase_name: "desktop-launch"` after the first public release (v0.1.0).

**Tests:** `pytest -q` — 29 unit tests on the backend. `cd desktop && npm test` — vitest on the audio utilities.

---

## Phase 6 punch list

Following the plan at `docs/superpowers/plans/2026-05-16-daisy-helps-desktop.md`:

### Code

- [ ] Task 1: Scaffold `desktop/` Electron + TypeScript project
- [ ] Task 2: Wire-message TypeScript types
- [ ] Task 3: Renderer UI shell (HTML + CSS)
- [ ] Task 4: PCM encode/decode utilities (TDD)
- [ ] Task 5: Renderer app — WebSocket + mic + audio playback + UI wiring
- [ ] Task 6: Native screen capture via `desktopCapturer`
- [ ] Task 7: System tray + minimize-to-tray
- [ ] Task 8: Auto-update wiring (electron-updater)
- [ ] Task 9: Build pipeline (electron-builder Windows NSIS)
- [ ] Task 10: GitHub Actions release workflow on `v*` tags
- [ ] Task 11: GitHub Actions PR CI for `desktop/`
- [ ] Task 12: Landing page (`landing/index.html` + assets)
- [ ] Task 13: Render Static Site + daisyhelps.com DNS

### Docs

- [ ] Task 14: `README.md`
- [ ] Task 15: `CLAUDE.md`
- [ ] Task 16: `TODO.md` (this file)
- [ ] Task 17: `docs/ARCHITECTURE.md`
- [ ] Task 18: `docs/RUNBOOK.md`
- [ ] Task 19: `docs/DEMO.md`
- [ ] Task 20: `docs/DECISIONS.md`
- [ ] Task 21: `docs/API.md`

### Release

- [ ] Task 22: Cut v0.1.0, verify daisyhelps.com download works end-to-end, bump `readiness.py` to phase 6

---

## User-action items (require dashboard / registrar access)

1. **GitHub Releases** — make sure the repo is configured so the `GITHUB_TOKEN` in CI has write access (default for `pull_request` → `push` workflows from the repo itself).
2. **Render dashboard** — after `render.yaml` is updated (Task 13), re-sync the Blueprint to create the `daisyhelps-landing` static service. Add `daisyhelps.com` and `www.daisyhelps.com` as custom domains.
3. **DNS** — at the daisyhelps.com registrar, add the Render-supplied ALIAS/CNAME records.
4. **Designer pass on icons** — `desktop/build/icon.ico` and `desktop/build/tray-icon.png` are flat-color placeholders. Replace with branded versions before any marketing push.

---

## Backwards-compatible deferred items (carry forward from Phase 5)

- **Persona / prompt iteration** — run the demo through the installed desktop app 5+ times; tighten `backend/prompts.py`.
- **AudioWorklet migration** in `desktop/src/renderer/app.ts` (currently uses deprecated `ScriptProcessorNode`, same as the test harness).
- **Migrate `datetime.utcnow()` → `datetime.now(timezone.utc)`** in `backend/session.py`.
- **macOS / Linux installers** — see `CLAUDE.md` deferred-features table.
- **EV code-signing cert** for the Windows installer — see `CLAUDE.md`.

---

## Where to look for what

| For | Read |
|---|---|
| Desktop pivot design | `docs/superpowers/specs/2026-05-16-daisy-helps-desktop-pivot-design.md` |
| Desktop implementation plan | `docs/superpowers/plans/2026-05-16-daisy-helps-desktop.md` |
| WebSocket protocol contract | `docs/API.md` |
| System architecture | `docs/ARCHITECTURE.md` |
| Local dev + env vars + deploy | `docs/RUNBOOK.md` |
| Why decisions were made | `docs/DECISIONS.md` |
| The demo script | `docs/DEMO.md` |
| Feature readiness flags | `backend/readiness.py` (or `GET /api/status`) |
| Daisy's voice (system prompt) | `backend/prompts.py` |
