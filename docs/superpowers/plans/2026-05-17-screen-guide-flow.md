# Screen-guide flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the corner-daisy + screen-share mode the default working state once Daisy first looks at the screen — explicit hand-off on first proactive screenshot, silent peeks after.

**Architecture:** New `share_screen_remembered` boolean in `settings.json` is the single source of truth. First successful `screenshot_request` consent-Yes (while flag is false) triggers a `HandoffModal`; OK persists the flag, hides the big window, and pulses the corner daisy once. Subsequent `screenshot_request`s auto-grant in the renderer (no modal). A new bidirectional tray checkbox toggles the flag. Errors that fire while the flag is true (proxy for "big window may be hidden") are mirrored to the subtitle pill in a red variant for 5 seconds.

**Tech Stack:** Electron 28+ (main + preload + sandboxed renderer), React/Babel/CDN renderer, TypeScript main process, IPC via `ipcMain`/`ipcRenderer`. No test framework in `desktop/`; verification is manual via `npm run dev`.

**Spec:** `docs/superpowers/specs/2026-05-17-screen-guide-flow-design.md`

---

## Conventions for this plan

- All paths are relative to repo root unless absolute.
- All commits use the `desktop:` prefix per `CLAUDE.md`. One logical change per commit. Stage by explicit path — never `git add -A`.
- "Manual verification" replaces the pytest pattern from the writing-plans template, because the Electron renderer has no test runner. Each verification step lists the exact commands and the user-visible outcome to confirm.
- The dev launch is `cd desktop && npm run dev` from a PowerShell prompt. It builds (`tsc` both projects + copy `**/*.{html,css,jsx}` + `assets/**` into `dist/renderer/`) then launches Electron with `--enable-logging` so renderer console output goes to the terminal.
- The renderer connects to `wss://api.daisyhelps.com` (live backend). For test scenarios that need `share_screen_remembered` reset, delete `%APPDATA%/daisy-helps/settings.json` (location is `app.getPath('userData')`).

---

### Task 1: Add `share_screen_remembered` settings field + tray checkbox + sharing IPCs

**Files:**
- Modify: `desktop/src/main.ts`

**Context:** All in `main.ts`. Mirrors the existing `subtitles_enabled` plumbing exactly. The new helper `setShareScreenRemembered()` is the single mutation point — both the IPC handler and the tray click route through it.

- [ ] **Step 1.1:** Extend `AppSettings` interface and `DEFAULT_SETTINGS`. Replace the existing block:

```ts
interface AppSettings {
  subtitles_enabled: boolean;
}
const DEFAULT_SETTINGS: AppSettings = { subtitles_enabled: true };
```

with:

```ts
interface AppSettings {
  subtitles_enabled: boolean;
  share_screen_remembered: boolean;
}
const DEFAULT_SETTINGS: AppSettings = {
  subtitles_enabled: true,
  share_screen_remembered: false,
};
```

- [ ] **Step 1.2:** Extend `loadSettings()` to read the new field. Replace the `appSettings = { ... }` assignment inside the try block:

```ts
appSettings = {
  subtitles_enabled: typeof parsed.subtitles_enabled === 'boolean'
    ? parsed.subtitles_enabled
    : DEFAULT_SETTINGS.subtitles_enabled,
};
```

with:

```ts
appSettings = {
  subtitles_enabled: typeof parsed.subtitles_enabled === 'boolean'
    ? parsed.subtitles_enabled
    : DEFAULT_SETTINGS.subtitles_enabled,
  share_screen_remembered: typeof parsed.share_screen_remembered === 'boolean'
    ? parsed.share_screen_remembered
    : DEFAULT_SETTINGS.share_screen_remembered,
};
```

- [ ] **Step 1.3:** Add new helper immediately after the existing `setSubtitlesEnabled()` function:

```ts
function setShareScreenRemembered(enabled: boolean): void {
  if (appSettings.share_screen_remembered === enabled) return;
  appSettings.share_screen_remembered = enabled;
  saveSettings();
  // Broadcast to all renderers so tray + settings sheet + main app stay in sync.
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send('daisy:share-screen-remembered-changed', enabled);
  }
  rebuildTrayMenu();
}
```

- [ ] **Step 1.4:** Extend the tray menu. Replace the existing `rebuildTrayMenu()` body:

```ts
function rebuildTrayMenu(): void {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: 'Show Daisy', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { label: 'Hide Daisy', click: () => mainWindow?.hide() },
    { type: 'separator' },
    {
      label: 'Subtitles',
      type: 'checkbox',
      checked: appSettings.subtitles_enabled,
      click: (item) => setSubtitlesEnabled(item.checked),
    },
    { type: 'separator' },
    { label: 'Quit', click: () => { quittingForReal = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
}
```

with:

```ts
function rebuildTrayMenu(): void {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: 'Show Daisy', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { label: 'Hide Daisy', click: () => mainWindow?.hide() },
    { type: 'separator' },
    {
      label: 'Subtitles',
      type: 'checkbox',
      checked: appSettings.subtitles_enabled,
      click: (item) => setSubtitlesEnabled(item.checked),
    },
    {
      label: 'Sharing my screen',
      type: 'checkbox',
      checked: appSettings.share_screen_remembered,
      click: (item) => setShareScreenRemembered(item.checked),
    },
    { type: 'separator' },
    { label: 'Quit', click: () => { quittingForReal = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
}
```

- [ ] **Step 1.5:** Register IPC handlers. Add this block immediately after the existing `daisy:subtitle-enabled-set` handler (which is inside the `app.whenReady().then(() => {...})` block):

```ts
ipcMain.handle('daisy:share-screen-remembered-get', () => appSettings.share_screen_remembered);
ipcMain.on('daisy:share-screen-remembered-set', (_e, enabled: boolean) => {
  setShareScreenRemembered(!!enabled);
});
```

- [ ] **Step 1.6:** Verify TypeScript compiles.

Run: `cd desktop && npm run build`
Expected: clean exit code 0, no TS errors. Output ends with `dist/main.js`, `dist/preload.js`, and `dist/renderer/` populated.

- [ ] **Step 1.7:** Manual smoke.

1. Delete `%APPDATA%/daisy-helps/settings.json` if it exists.
2. Run `cd desktop && npm run dev`.
3. Right-click the tray daisy icon. Verify: a new "Sharing my screen" row appears between "Subtitles" and the separator above "Quit". It is **unchecked**.
4. Click it. Verify: the menu closes; reopening the menu shows it now **checked**.
5. Open `%APPDATA%/daisy-helps/settings.json` in a text editor. Verify: contains `"share_screen_remembered": true`.
6. Click the row again to uncheck. Verify settings.json now shows `false`.
7. Close the app from the tray (Quit), relaunch. Verify the persisted value carried over.

- [ ] **Step 1.8:** Commit.

```bash
git add desktop/src/main.ts
git commit -m "$(cat <<'EOF'
desktop: persist share_screen_remembered + tray toggle

New AppSettings field defaults to false. Tray menu gets a bidirectional
"Sharing my screen" checkbox that routes through setShareScreenRemembered(),
mirroring the existing subtitles_enabled plumbing. IPC handlers for get/set
broadcast changes to all renderers so cross-window state stays in sync.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Add `hide-main-window` + `overlay-attention-pulse` IPCs

**Files:**
- Modify: `desktop/src/main.ts`

**Context:** Two small main-process IPCs. `hide-main-window` is renderer→main (the HandoffModal OK button uses it). `overlay-attention-pulse` is main→overlay (fired by main right after hiding the main window). Both registered in the same `app.whenReady()` block as the others.

- [ ] **Step 2.1:** Add IPC handlers. Immediately after the share-screen handlers added in Task 1, append:

```ts
// HandoffModal OK button asks main to hide the big window. Distinct from
// the close-to-tray path because it bypasses the close intercept.
ipcMain.on('daisy:hide-main-window', () => {
  mainWindow?.hide();
  // Fire the overlay one-time attention pulse so the user notices where
  // Daisy went. The overlay renderer dedupes — see overlay.ts.
  overlayWindow?.webContents.send('daisy:overlay-attention-pulse');
});
```

- [ ] **Step 2.2:** Verify TS compiles.

Run: `cd desktop && npm run build`
Expected: exit code 0.

- [ ] **Step 2.3:** Manual smoke (deferred — full verification happens in Task 7 when the renderer wires the call). For now: confirm the build is clean.

- [ ] **Step 2.4:** Commit.

```bash
git add desktop/src/main.ts
git commit -m "$(cat <<'EOF'
desktop: hide-main-window IPC + overlay attention-pulse trigger

Renderer (HandoffModal OK) sends daisy:hide-main-window; main hides the
big window and sends daisy:overlay-attention-pulse to the overlay so it
can play the one-time onboarding pulse.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Extend preload bridge + DaisyAPI types

**Files:**
- Modify: `desktop/src/preload.ts`
- Modify: `desktop/src/renderer/types.ts`

**Context:** Preload exposes the new IPC channels to the renderer. Types in `types.ts` keep the renderer's `window.daisyAPI` typed.

- [ ] **Step 3.1:** Add to the `daisyAPI` object in `desktop/src/preload.ts`. Insert this block immediately after the existing `subtitleSetPassthrough` entry (right before the closing `});` of the `exposeInMainWorld` call):

```ts
  // Share-screen-remembered (get/set/changed)
  shareScreenRememberedGet: () => ipcRenderer.invoke('daisy:share-screen-remembered-get') as Promise<boolean>,
  shareScreenRememberedSet: (enabled: boolean) => ipcRenderer.send('daisy:share-screen-remembered-set', enabled),
  onShareScreenRememberedChanged: (cb: (enabled: boolean) => void) => {
    ipcRenderer.on('daisy:share-screen-remembered-changed', (_e, enabled) => cb(enabled));
  },

  // Hide main window (HandoffModal OK)
  hideMainWindow: () => ipcRenderer.send('daisy:hide-main-window'),

  // Overlay attention pulse (main → overlay)
  onOverlayAttentionPulse: (cb: () => void) => {
    ipcRenderer.on('daisy:overlay-attention-pulse', () => cb());
  },
```

- [ ] **Step 3.2:** Extend the `DaisyAPI` interface in `desktop/src/renderer/types.ts`. Insert these lines immediately after the existing `subtitleSetPassthrough(passthrough: boolean): void;` line:

```ts
  shareScreenRememberedGet(): Promise<boolean>;
  shareScreenRememberedSet(enabled: boolean): void;
  onShareScreenRememberedChanged(cb: (enabled: boolean) => void): void;
  hideMainWindow(): void;
  onOverlayAttentionPulse(cb: () => void): void;
```

- [ ] **Step 3.3:** Verify TS compiles.

Run: `cd desktop && npm run build`
Expected: exit code 0.

- [ ] **Step 3.4:** Manual smoke.

1. Run `cd desktop && npm run dev`.
2. Open the renderer DevTools (Ctrl+Shift+I in the main window).
3. In the console: type `await window.daisyAPI.shareScreenRememberedGet()`. Verify: returns `true` or `false` (matches the current `settings.json` value).
4. In the console: type `window.daisyAPI.shareScreenRememberedSet(true)`. Verify: tray menu's "Sharing my screen" row becomes checked when you re-open the menu, and `settings.json` updates.
5. In the console: type `window.daisyAPI.hideMainWindow()`. Verify: big window hides. Restore via tray → "Show Daisy".

- [ ] **Step 3.5:** Commit.

```bash
git add desktop/src/preload.ts desktop/src/renderer/types.ts
git commit -m "$(cat <<'EOF'
desktop: preload bridge + types for share-screen + hide-main-window

Exposes shareScreenRememberedGet/Set/Changed, hideMainWindow, and
onOverlayAttentionPulse on window.daisyAPI. DaisyAPI interface updated
to match.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Overlay attention pulse animation

**Files:**
- Modify: `desktop/src/renderer/overlay.css`
- Modify: `desktop/src/renderer/overlay.ts`

**Context:** A one-time CSS-driven pulse on the overlay daisy: scale 1.0 → 1.12 → 1.0 with a cream glow over 1.2s. Triggered by `onOverlayAttentionPulse`. Implementation needs to respect the existing dragging-freeze and state-animation rules (the pulse should layer on top of `breathe`/`listening`/etc. via a wrapper class, not by replacing them).

The cleanest approach: add the class to a *wrapper* (the body or a new dedicated overlay div) rather than the `.mark` itself, so it doesn't collide with the existing per-state animations. We'll add it to `body` and target `body.attention-pulse .mark` with the animation.

- [ ] **Step 4.1:** Add the pulse keyframes + class at the end of `desktop/src/renderer/overlay.css`:

```css
/* ── One-time attention pulse ──
   Fired once when the user is auto-minimized for the first time so they
   notice where Daisy went. Targets a body-level class so it composes with
   the per-state .mark animations (idle/listening/...) rather than
   replacing them. Cream-tinted box-shadow gives the "glow." */
body.attention-pulse .mark {
  animation: attention-pulse 1.2s ease-in-out 1;
}
@keyframes attention-pulse {
  0%   { transform: scale(1.00); filter: drop-shadow(0 0 0 rgba(251, 247, 238, 0)); }
  35%  { transform: scale(1.12); filter: drop-shadow(0 0 12px rgba(251, 247, 238, 0.85)); }
  70%  { transform: scale(1.04); filter: drop-shadow(0 0 6px rgba(251, 247, 238, 0.45)); }
  100% { transform: scale(1.00); filter: drop-shadow(0 0 0 rgba(251, 247, 238, 0)); }
}
@media (prefers-reduced-motion: reduce) {
  body.attention-pulse .mark { animation: none !important; }
}
```

- [ ] **Step 4.2:** Wire the IPC in `desktop/src/renderer/overlay.ts`. Append after the existing `closeBtn?.addEventListener('click', ...)` block (the last existing block):

```ts
// One-time attention pulse — fired by main when the user is first
// auto-minimized. Adding the class to <body> lets the keyframes layer
// over whichever per-state .mark animation is currently running. The
// pulse animation has iteration-count 1, so on `animationend` we strip
// the class so future minimizes (after toggling sharing off/on) don't
// re-fire it.
window.daisyAPI?.onOverlayAttentionPulse?.(() => {
  document.body.classList.add('attention-pulse');
});
document.addEventListener('animationend', (e) => {
  if (e.animationName === 'attention-pulse') {
    document.body.classList.remove('attention-pulse');
  }
});
```

- [ ] **Step 4.3:** Verify TS compiles + assets are copied.

Run: `cd desktop && npm run build`
Expected: exit code 0; `dist/renderer/overlay.css` and `dist/renderer/overlay.js` updated.

- [ ] **Step 4.4:** Manual smoke.

1. Run `cd desktop && npm run dev`.
2. Click through Welcome → Start talking → consent yes (mic) → conversation screen. The overlay daisy appears in the top-right.
3. Open the **overlay's** DevTools: in the main process, the overlay window is separate — to inspect, temporarily add `overlayWindow.webContents.openDevTools({ mode: 'detach' })` after `overlayWindow.loadFile(...)` in `createOverlay()`. (Revert before commit.) Alternatively, fire the pulse from the main renderer DevTools:
4. In the **main renderer** DevTools console: `window.daisyAPI.hideMainWindow()`. The main window hides AND the overlay daisy should pulse once (scale up + cream glow + scale back, over 1.2s).
5. Restore via tray → "Show Daisy". Fire it again — confirm pulse plays each time it's triggered (the class strip on `animationend` makes it re-fireable).
6. Verify the overlay daisy's normal idle "breathe" animation resumes cleanly afterward.

- [ ] **Step 4.5:** Commit.

```bash
git add desktop/src/renderer/overlay.css desktop/src/renderer/overlay.ts
git commit -m "$(cat <<'EOF'
desktop: overlay one-time attention pulse on auto-minimize

CSS keyframes scale 1.00 → 1.12 → 1.00 with a cream drop-shadow glow
over 1.2s. Triggered by daisy:overlay-attention-pulse from main right
after the big window hides. Body-level class so it composes with the
per-state .mark animations; stripped on animationend.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: HandoffModal component (EN/ES)

**Files:**
- Modify: `desktop/src/renderer/screens.jsx`

**Context:** New component in `screens.jsx` next to `ScreenshotConsent`. Re-uses the existing `.modal-scrim` / `.modal` / `.modal__actions` styles. Single primary CTA — no decline path. Includes a small inline SVG illustration showing a window-rectangle → corner-daisy.

- [ ] **Step 5.1:** Add EN copy keys. In `desktop/src/renderer/screens.jsx`, inside the `COPY.en` object, append these entries immediately before the closing `}` of the `en:` block (after the existing `sampleSpeaking` line):

```jsx
    handoffTitle: 'I’m moving to the corner.',
    handoffBody: 'I’ll watch from up here so I can see your screen and help you with what you’re doing. Click me anytime, or just talk. To bring this big window back, click the little daisy near your clock (bottom-right) and choose “Show Daisy.”',
    handoffBtn: 'Got it',
```

- [ ] **Step 5.2:** Add ES copy keys. Inside `COPY.es`, immediately before the closing `}` of the `es:` block:

```jsx
    handoffTitle: 'Me muevo a la esquina.',
    handoffBody: 'Te voy a acompañar desde aquí arriba para ver tu pantalla y ayudarte con lo que estás haciendo. Haz clic en mí cuando me necesites, o háblame. Para volver a abrir esta ventana grande, haz clic en la florecita junto al reloj (abajo a la derecha) y elige “Mostrar Daisy.”',
    handoffBtn: 'Entendido',
```

- [ ] **Step 5.3:** Add the `HandoffModal` component. In `desktop/src/renderer/screens.jsx`, insert this function immediately after the existing `ScreenshotConsent` function (right before the `// ─── Settings sheet` section comment):

```jsx
// ─────────────────────────────────────────────────────────────
// Hand-off modal — shown right after the user grants the first
// screenshot. The OK button hides the big window and persists the
// share_screen_remembered flag (App owns those side effects).
// ─────────────────────────────────────────────────────────────
function HandoffModal({ lang, onConfirm }) {
  const t = COPY[lang];
  const ref = React.useRef(null);
  React.useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div className="modal-scrim" role="dialog" aria-modal="true" aria-labelledby="handoff-title">
      <div className="modal">
        <h2 id="handoff-title">{t.handoffTitle}</h2>
        {/* Inline SVG: window-rectangle → arrow → daisy in top-right corner.
            Conveys the spatial change without relying on text alone. */}
        <div style={{ display: 'flex', justifyContent: 'center', margin: '8px 0 12px' }}>
          <svg width="220" height="100" viewBox="0 0 220 100" aria-hidden="true">
            {/* Big window */}
            <rect x="10" y="20" width="100" height="64" rx="6"
                  fill="#FBF7EE" stroke="#2D8659" strokeWidth="2" />
            <line x1="10" y1="32" x2="110" y2="32" stroke="#2D8659" strokeWidth="2" />
            {/* Arrow */}
            <path d="M 120 50 L 165 22" stroke="#ED8B33" strokeWidth="2.5" fill="none" strokeLinecap="round" />
            <path d="M 158 18 L 165 22 L 161 29" stroke="#ED8B33" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            {/* Corner daisy (simplified) */}
            <circle cx="180" cy="22" r="6" fill="#F4C24A" />
            <circle cx="180" cy="14" r="4" fill="#FBF7EE" stroke="#ED8B33" strokeWidth="1.5" />
            <circle cx="188" cy="22" r="4" fill="#FBF7EE" stroke="#ED8B33" strokeWidth="1.5" />
            <circle cx="180" cy="30" r="4" fill="#FBF7EE" stroke="#ED8B33" strokeWidth="1.5" />
            <circle cx="172" cy="22" r="4" fill="#FBF7EE" stroke="#ED8B33" strokeWidth="1.5" />
          </svg>
        </div>
        <div className="modal__reason">
          <span>{t.handoffBody}</span>
        </div>
        <div className="modal__actions">
          <button ref={ref} className="btn btn--primary btn--xl" onClick={onConfirm} style={{ flex: 1 }}>
            {t.handoffBtn}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5.4:** Verify the build still copies `screens.jsx`.

Run: `cd desktop && npm run build`
Expected: exit code 0; `dist/renderer/screens.jsx` updated.

- [ ] **Step 5.5:** Manual smoke (preview-only — App wiring lands in Task 7).

1. Run `cd desktop && npm run dev`.
2. In the main renderer DevTools console, temporarily render the modal:

```js
const root = document.createElement('div');
root.id = '__handoff-preview';
document.body.appendChild(root);
ReactDOM.createRoot(root).render(
  React.createElement(HandoffModal, { lang: 'en', onConfirm: () => alert('OK clicked') })
);
```

3. Verify: the modal appears with the SVG illustration, English copy, and a single "Got it" button focused by default. Click it → alert fires.
4. Replace `lang: 'en'` with `lang: 'es'` and re-render → confirm Spanish copy.
5. Clean up: `document.getElementById('__handoff-preview').remove()`.

- [ ] **Step 5.6:** Commit.

```bash
git add desktop/src/renderer/screens.jsx
git commit -m "$(cat <<'EOF'
desktop: HandoffModal component (EN/ES) for first auto-minimize

Single-CTA modal explaining the spatial change to the corner-daisy
mode. Inline SVG shows window → arrow → corner daisy. Re-uses the
existing .modal-scrim / .modal styles; auto-focuses the OK button.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: useDaisyBackend state additions + screenshot_request auto-grant

**Files:**
- Modify: `desktop/src/renderer/main.jsx`

**Context:** The `useDaisyBackend` hook in `main.jsx` gains three new return values: `shareScreenRemembered`, `handoffNeeded`, `dismissHandoff`. The `respondConsent` Yes-path sets `handoffNeeded = true` when the flag is false at consent time. The `screenshot_request` handler auto-grants (silent capture + send) when the flag is true.

The hook is large; insertions go in specific spots called out below.

- [ ] **Step 6.1:** Add state + ref. Find the existing `const [subtitlesEnabled, setSubtitlesEnabled] = useState(true);` line and the matching `subtitlesEnabledRef` setup. Immediately after that block (right before the `// Ref so we can read latest values inside the audio_end handler closure.` comment), add:

```jsx
  const [shareScreenRemembered, setShareScreenRemembered] = useState(false);
  const shareScreenRememberedRef = useRef(false);
  useEffect(() => { shareScreenRememberedRef.current = shareScreenRemembered; }, [shareScreenRemembered]);
  // Hook-owned. Becomes true when a screenshot was just sent successfully
  // AND share_screen_remembered was false at that moment. App reads this
  // and renders HandoffModal when true.
  const [handoffNeeded, setHandoffNeeded] = useState(false);
```

- [ ] **Step 6.2:** Add the `dismissHandoff` callback. Find the existing `const clearError = useCallback(() => setErrorMsg(null), []);` line. Immediately before that line, add:

```jsx
  const dismissHandoff = useCallback(() => setHandoffNeeded(false), []);
```

- [ ] **Step 6.3:** Add the share-screen subscription effect. Find the existing `// Subtitle setting — load initial value from main and listen for changes` effect block. Immediately after that effect's closing `}, []);`, add:

```jsx
  // Share-screen-remembered — load initial value + cross-window sync.
  useEffect(() => {
    let mounted = true;
    void window.daisyAPI?.shareScreenRememberedGet?.().then((v) => {
      if (mounted) setShareScreenRemembered(!!v);
    });
    window.daisyAPI?.onShareScreenRememberedChanged?.((v) => {
      if (mounted) setShareScreenRemembered(!!v);
    });
    return () => { mounted = false; };
  }, []);
```

- [ ] **Step 6.4:** Modify the `screenshot_request` case to auto-grant when remembered. Find the existing case (around line 233):

```jsx
          case 'screenshot_request':
            setConsentReason(msg.reason ?? '');
            break;
```

Replace it with:

```jsx
          case 'screenshot_request':
            if (shareScreenRememberedRef.current) {
              // Auto-grant — capture and send without opening the consent modal.
              // The user already bought into screen sharing; subsequent peeks
              // are silent.
              void (async () => {
                if (!window.daisyAPI?.captureScreen) return;
                const result = await window.daisyAPI.captureScreen();
                if ('error' in result) {
                  console.error('screen capture failed', result.error);
                  setErrorMsg('Could not capture your screen.');
                } else {
                  send({ type: 'screenshot', data: result.pngBase64 });
                }
              })();
            } else {
              setConsentReason(msg.reason ?? '');
            }
            break;
```

- [ ] **Step 6.5:** Modify `respondConsent` to set `handoffNeeded` after a successful first capture. Find the existing function (around line 486):

```jsx
  const respondConsent = useCallback(async (yes) => {
    setConsentReason(null);
    if (yes && window.daisyAPI?.captureScreen) {
      const result = await window.daisyAPI.captureScreen();
      if ('error' in result) {
        console.error('screen capture failed', result.error);
        setErrorMsg('Could not capture your screen.');
      } else {
        send({ type: 'screenshot', data: result.pngBase64 });
      }
    }
  }, [send]);
```

Replace it with:

```jsx
  const respondConsent = useCallback(async (yes) => {
    setConsentReason(null);
    if (yes && window.daisyAPI?.captureScreen) {
      const result = await window.daisyAPI.captureScreen();
      if ('error' in result) {
        console.error('screen capture failed', result.error);
        setErrorMsg('Could not capture your screen.');
      } else {
        send({ type: 'screenshot', data: result.pngBase64 });
        // First-ever successful screenshot triggers the hand-off ceremony.
        // App reads handoffNeeded and renders HandoffModal; OK there
        // persists the flag and hides the big window.
        if (!shareScreenRememberedRef.current) {
          setHandoffNeeded(true);
        }
      }
    }
  }, [send]);
```

- [ ] **Step 6.6:** Extend the hook's return object. Find the existing return at the end of `useDaisyBackend`:

```jsx
  return {
    state, markState, userText, daisyText, daisyStreaming,
    consentReason, micDenied, errorMsg, clickHint,
    startTalking, stopTalking, stopDaisy,
    respondConsent, changeLanguage, endSession, sendUserText, clearError,
    sendScreenshot, primeMicPermission,
    subtitlesEnabled,
  };
```

Replace it with:

```jsx
  return {
    state, markState, userText, daisyText, daisyStreaming,
    consentReason, micDenied, errorMsg, clickHint,
    startTalking, stopTalking, stopDaisy,
    respondConsent, changeLanguage, endSession, sendUserText, clearError,
    sendScreenshot, primeMicPermission,
    subtitlesEnabled,
    shareScreenRemembered, handoffNeeded, dismissHandoff,
  };
```

- [ ] **Step 6.7:** Verify build.

Run: `cd desktop && npm run build`
Expected: exit code 0.

- [ ] **Step 6.8:** Manual smoke (hook-level; full UX in Task 7).

1. Run `cd desktop && npm run dev`. Delete `settings.json` first to ensure flag is false.
2. Open the main renderer DevTools console.
3. Navigate to conversation screen via the normal flow.
4. Test auto-grant: in DevTools, set the flag remotely — `await window.daisyAPI.shareScreenRememberedSet(true)`. Then trigger Daisy to ask for the screen (the easiest way is just to wait for her to organically request via the demo flow, OR fake a `screenshot_request` message by injecting into the WS — skip if too involved). Verify in the terminal log that `screen capture` is happening without a consent modal appearing.
5. Test handoff trigger: with `settings.json` flag false, trigger a real `screenshot_request` → consent modal appears → click Yes → in DevTools, inspect React state on the App component (use React DevTools) to confirm `handoffNeeded` is `true`. The HandoffModal isn't rendered yet (that's Task 7).

If step 4/5 verification is too hard to construct manually, defer full coverage to Task 7 + Task 10 (end-to-end smoke). The build passing is the minimum bar.

- [ ] **Step 6.9:** Commit.

```bash
git add desktop/src/renderer/main.jsx
git commit -m "$(cat <<'EOF'
desktop: useDaisyBackend — share-screen state + handoff trigger + auto-grant

New hook state shareScreenRemembered (mirrored from main via IPC) and
handoffNeeded (true after first successful screenshot while flag is
false). screenshot_request auto-grants when the flag is true: silent
captureScreen + send, no consent modal. respondConsent Yes-path sets
handoffNeeded so App can render HandoffModal.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: App-level handoff wiring

**Files:**
- Modify: `desktop/src/renderer/main.jsx`

**Context:** Render the `HandoffModal` when `daisy.handoffNeeded` is true. The OK handler calls `daisy.dismissHandoff()`, persists the flag via `shareScreenRememberedSet(true)`, and calls `hideMainWindow()` — the main process then fires the overlay pulse.

`HandoffModal` is defined in `screens.jsx`; in this renderer style (Babel/CDN, all components are globals after their `<script>` tag loads), it's available by name with no import.

- [ ] **Step 7.1:** Add the handler in the `App` function. Find the existing `const onConsentNo = () => { void daisy.respondConsent(false); };` line (around line 638). Immediately after it, add:

```jsx
  const onHandoffConfirmed = () => {
    daisy.dismissHandoff();                              // hook clears handoffNeeded
    window.daisyAPI?.shareScreenRememberedSet?.(true);   // main persists + broadcasts
    window.daisyAPI?.hideMainWindow?.();                 // main hides big window + fires overlay pulse
  };
```

- [ ] **Step 7.2:** Render the modal. Find the existing block that renders `ScreenshotConsent`:

```jsx
      {consentVisible && screen === 'conversation' && (
        <ScreenshotConsent
          lang={lang}
          reason={consentReasonText}
          onYes={onConsentYes}
          onNo={onConsentNo}
        />
      )}
```

Immediately after that closing `)}`, add:

```jsx
      {daisy.handoffNeeded && screen === 'conversation' && (
        <HandoffModal lang={lang} onConfirm={onHandoffConfirmed} />
      )}
```

- [ ] **Step 7.3:** Verify build.

Run: `cd desktop && npm run build`
Expected: exit code 0.

- [ ] **Step 7.4:** Manual smoke (end-to-end Path 1).

1. Delete `%APPDATA%/daisy-helps/settings.json`. Run `cd desktop && npm run dev`.
2. Click through Welcome → Start talking → accept mic consent → conversation screen. Overlay daisy appears top-right.
3. Have a conversation that prompts Daisy to ask to see the screen. (Example: "Daisy, can you help me find a button on my screen?") Wait for `ScreenshotConsent` modal.
4. Click "Show Daisy my screen". Verify:
   - The consent modal closes.
   - A new modal appears titled "I'm moving to the corner." with the SVG illustration and a single "Got it" button.
   - Daisy is presumably already responding (audio streaming) — the modal and the audio play in parallel.
5. Click "Got it". Verify:
   - The big window hides.
   - The overlay daisy in the top-right plays a one-time scale-up + cream glow pulse.
   - `settings.json` now contains `"share_screen_remembered": true`.
   - Tray menu's "Sharing my screen" row is now checked.
6. Restore the big window via tray → "Show Daisy". Verify: the conversation history is intact in the main window.
7. Trigger another `screenshot_request` from Daisy. Verify: **no** consent modal, **no** hand-off modal, screen is captured silently and Daisy responds.
8. Toggle "Sharing my screen" off in tray. Trigger another `screenshot_request`. Verify: consent modal returns; clicking Yes shows the hand-off modal again (because the flag was false at consent time), pulse fires again on confirm.

- [ ] **Step 7.5:** Path 2 regression check.

1. Delete `settings.json`. Relaunch.
2. Click through to conversation screen.
3. Click the **overlay daisy** in the corner. Verify: screenshot fires, mic starts listening, **no** HandoffModal appears, big window stays open, `settings.json` still shows `share_screen_remembered: false`.

- [ ] **Step 7.6:** Commit.

```bash
git add desktop/src/renderer/main.jsx
git commit -m "$(cat <<'EOF'
desktop: render HandoffModal + wire OK to hide + persist + pulse

App renders HandoffModal when daisy.handoffNeeded is true. The OK
handler clears the hook flag, persists share_screen_remembered=true via
IPC, and asks main to hide the big window — main fires the overlay
attention pulse in response. Completes the Path 1 auto-minimize flow.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Subtitle pill error variant — IPC + renderer + types

**Files:**
- Modify: `desktop/src/main.ts`
- Modify: `desktop/src/preload.ts`
- Modify: `desktop/src/renderer/types.ts`
- Modify: `desktop/src/renderer/subtitle.css`
- Modify: `desktop/src/renderer/subtitle.ts`

**Context:** A new `daisy:subtitle-error-show` IPC pushes red-styled error text to the pill. Auto-clears after 5 seconds (handled in subtitle renderer, not main). Honors the existing `subtitles_enabled` gate (an error pill is still a subtitle).

- [ ] **Step 8.1:** Add IPC handler in `desktop/src/main.ts`. Immediately after the existing `daisy:subtitle-clear` handler (which sets a 280ms hide timer), append:

```ts
ipcMain.on('daisy:subtitle-error-show', (_e, text: string) => {
  if (!subtitleWindow) return;
  if (!appSettings.subtitles_enabled) return;  // honor the user's toggle
  if (!subtitleWindow.isVisible()) subtitleWindow.showInactive();
  subtitleWindow.webContents.send('daisy:subtitle-error-show', text);
});
```

- [ ] **Step 8.2:** Add to preload in `desktop/src/preload.ts`. Immediately after the existing `subtitleClear` line in the `daisyAPI` object:

```ts
  subtitleErrorShow: (text: string) => ipcRenderer.send('daisy:subtitle-error-show', text),
  onShowSubtitleError: (cb: (text: string) => void) => {
    ipcRenderer.on('daisy:subtitle-error-show', (_e, text) => cb(text));
  },
```

- [ ] **Step 8.3:** Extend `DaisyAPI` in `desktop/src/renderer/types.ts`. Immediately after the existing `subtitleClear(): void;` line:

```ts
  subtitleErrorShow(text: string): void;
  onShowSubtitleError(cb: (text: string) => void): void;
```

- [ ] **Step 8.4:** Add red-variant CSS in `desktop/src/renderer/subtitle.css`. Append after the existing `#pill.pill--fading { opacity: 0; }` line:

```css
/* Error variant — red-tinted background + small red dot on the left.
   Distinguishes a transient error from Daisy's normal speech caption. */
#pill.pill--error {
  background: rgba(180, 62, 42, 0.92);  /* matches --alert in styles.css */
}
.pill__dot {
  flex: 0 0 auto;
  width: 8px; height: 8px;
  border-radius: 50%;
  background: #FBF7EE;
  margin-right: 10px;
  display: none;
}
#pill.pill--error .pill__dot {
  display: inline-block;
}
```

- [ ] **Step 8.5:** Update the pill markup. In `desktop/src/renderer/subtitle.html`, find:

```html
    <div class="pill__clip">
      <span class="pill__text"></span>
    </div>
```

Replace with:

```html
    <div class="pill__clip">
      <span class="pill__dot"></span>
      <span class="pill__text"></span>
    </div>
```

- [ ] **Step 8.6:** Wire the error-show handler in `desktop/src/renderer/subtitle.ts`. Append after the existing `window.daisyAPI?.onClearSubtitle?.(() => fadeOut());` line:

```ts
// Error variant — same pill, red tint, auto-clears after 5 seconds.
// Replaces any current subtitle content (Daisy speech) for the duration.
let errorAutoClearTimer: number | null = null;
window.daisyAPI?.onShowSubtitleError?.((errText: string) => {
  if (errorAutoClearTimer !== null) {
    window.clearTimeout(errorAutoClearTimer);
    errorAutoClearTimer = null;
  }
  pill.classList.add('pill--error');
  render(errText);
  errorAutoClearTimer = window.setTimeout(() => {
    pill.classList.remove('pill--error');
    fadeOut();
    errorAutoClearTimer = null;
  }, 5000);
});
```

Then, to ensure the error class is stripped when a normal subtitle replaces an error, modify the existing `render()` function. Find:

```ts
function render(content: string): void {
  if (hideTimer !== null) {
    window.clearTimeout(hideTimer);
    hideTimer = null;
  }
  text.textContent = content;
  pill.hidden = false;
  pill.classList.remove('pill--fading');
```

Replace with (only the body — keep the function signature and the rAF measurement block):

```ts
function render(content: string): void {
  if (hideTimer !== null) {
    window.clearTimeout(hideTimer);
    hideTimer = null;
  }
  text.textContent = content;
  pill.hidden = false;
  pill.classList.remove('pill--fading');
  // Don't strip pill--error here — the error handler manages that itself
  // via the auto-clear timer. We do strip it inside fadeOut(), see below.
```

(Keep the rest of `render()` unchanged.)

Find `fadeOut()`:

```ts
function fadeOut(): void {
  pill.classList.add('pill--fading');
  if (hideTimer !== null) window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    pill.hidden = true;
    pill.classList.remove('pill--fading');
    text.textContent = '';
    text.style.transform = 'none';
    hideTimer = null;
  }, 260);
}
```

Replace the body inside the setTimeout callback to also strip the error class:

```ts
function fadeOut(): void {
  pill.classList.add('pill--fading');
  if (hideTimer !== null) window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    pill.hidden = true;
    pill.classList.remove('pill--fading');
    pill.classList.remove('pill--error');
    text.textContent = '';
    text.style.transform = 'none';
    hideTimer = null;
  }, 260);
}
```

- [ ] **Step 8.7:** Verify build.

Run: `cd desktop && npm run build`
Expected: exit code 0.

- [ ] **Step 8.8:** Manual smoke.

1. Run `cd desktop && npm run dev`.
2. Click through to conversation screen so the subtitle pill exists. (The subtitle window is created at app start but only shows when content is pushed.)
3. Open the main renderer DevTools. Run: `window.daisyAPI.subtitleErrorShow('Could not capture your screen.')`. Verify:
   - The pill appears below the corner daisy with the error text.
   - Background is red-tinted (not the default near-black).
   - A small cream-colored dot appears at the left edge of the pill.
   - After 5 seconds the pill fades out.
4. Run `window.daisyAPI.subtitleErrorShow('First error')` then within 2 seconds run `window.daisyAPI.subtitleErrorShow('Second error')`. Verify: the text updates to "Second error", the auto-clear timer resets so it doesn't disappear prematurely.
5. Run `window.daisyAPI.subtitleErrorShow('Error')`, then before the 5s elapses run `window.daisyAPI.subtitleShow('Normal daisy speech')`. Verify: text updates to "Normal daisy speech" — the error class remains active until the auto-clear fires OR a fadeOut runs. (Acceptable: the visual handoff back to a normal subtitle happens when the error timer elapses or when the user explicitly clears.)
6. With `subtitles_enabled = false` (toggle off in tray), run `window.daisyAPI.subtitleErrorShow('Error')`. Verify: no pill appears (gate honored).

- [ ] **Step 8.9:** Commit.

```bash
git add desktop/src/main.ts desktop/src/preload.ts desktop/src/renderer/types.ts desktop/src/renderer/subtitle.css desktop/src/renderer/subtitle.ts desktop/src/renderer/subtitle.html
git commit -m "$(cat <<'EOF'
desktop: subtitle pill error variant (red tint + auto-clear after 5s)

New daisy:subtitle-error-show IPC pushes red-styled error text to the
pill so users can see errors even when the big window is hidden. Auto-
clears after 5 seconds. Honors the subtitles_enabled gate. CSS adds a
.pill--error class with a small cream dot on the left.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Mirror errors to the subtitle pill when sharing is remembered

**Files:**
- Modify: `desktop/src/renderer/main.jsx`

**Context:** When `setErrorMsg` is called and `shareScreenRememberedRef.current === true`, also push the error text to the subtitle pill via `subtitleErrorShow`. We don't gate on actual window visibility — the flag is a good-enough proxy ("user is in screen-share mode, probably minimized"). When the big window happens to be visible (user opened from tray), they'll see the error in both places, which is harmless.

Implementation: rather than wrap every `setErrorMsg` call site, add an effect that watches `errorMsg` and fires the pill IPC.

- [ ] **Step 9.1:** Add the effect inside `useDaisyBackend`. Find the existing `// Stuck-thinking watchdog` effect block (around line 151). Immediately after it (before the WS connect effect), insert:

```jsx
  // Mirror errors to the subtitle pill when in screen-share mode so the
  // user sees them even if the big window is hidden. The pill auto-clears
  // after 5s on its own; we don't need to clear it from here.
  useEffect(() => {
    if (!errorMsg) return;
    if (!shareScreenRememberedRef.current) return;
    window.daisyAPI?.subtitleErrorShow?.(errorMsg);
  }, [errorMsg]);
```

- [ ] **Step 9.2:** Verify build.

Run: `cd desktop && npm run build`
Expected: exit code 0.

- [ ] **Step 9.3:** Manual smoke.

1. Ensure `settings.json` has `share_screen_remembered: true` (toggle in tray if needed).
2. Run `cd desktop && npm run dev`. Click through to conversation screen.
3. Hide the big window via tray → "Hide Daisy".
4. Force an error: in DevTools (the main renderer DevTools still work on the hidden window — open via tray show, open DevTools, hide again, OR just keep window visible and observe), trigger a backend error. Easiest: send a malformed message to the WS via `wsRef.current.send('not-json')`. Wait for the resulting error.
5. Verify: the subtitle pill appears with red styling + the error message, auto-clears after 5 seconds.
6. Toggle `share_screen_remembered` off in tray. Force another error. Verify: pill does NOT show the error (because the flag gates it).

- [ ] **Step 9.4:** Commit.

```bash
git add desktop/src/renderer/main.jsx
git commit -m "$(cat <<'EOF'
desktop: mirror errors to subtitle pill while sharing is remembered

When an error fires and share_screen_remembered is true, also push the
text to the subtitle pill in its red error variant. The flag is a proxy
for "user may have minimized the big window" — when the window happens
to be visible, the error shows in both places, which is harmless. The
pill self-clears after 5s.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: End-to-end manual smoke + spec test plan

**Files:** none modified — this is a verification pass.

**Context:** Run through the spec's test plan (`docs/superpowers/specs/2026-05-17-screen-guide-flow-design.md` § Testing) end-to-end and confirm each scenario passes. Surface anything that doesn't behave as designed.

- [ ] **Step 10.1:** Test scenario 1 — Fresh-install Path 1.

1. Delete `%APPDATA%/daisy-helps/settings.json`.
2. Run `cd desktop && npm run dev`.
3. Trigger `screenshot_request` from Daisy via conversation.
4. Click Yes on ScreenshotConsent.
5. Confirm HandoffModal appears with English copy + SVG.
6. Click "Got it".
7. Confirm: big window hides; overlay daisy pulses once; `settings.json` shows `share_screen_remembered: true`; tray "Sharing my screen" row checked.

- [ ] **Step 10.2:** Test scenario 2 — Fresh-install Path 2.

1. Wipe `settings.json`. Relaunch.
2. Reach conversation screen.
3. Click the overlay daisy.
4. Confirm: screenshot fires, mic starts, NO HandoffModal, big window stays open, flag still false.

- [ ] **Step 10.3:** Test scenario 3 — Subsequent screenshot, flag true.

1. Ensure flag is true (e.g., complete scenario 1 above).
2. Trigger another `screenshot_request`.
3. Confirm: no modals; screenshot captured silently; Daisy proceeds.

- [ ] **Step 10.4:** Test scenario 4 — Revoke from tray.

1. Flag is true. Toggle "Sharing my screen" off via tray.
2. Trigger another `screenshot_request`.
3. Confirm: ScreenshotConsent modal returns. On Yes, HandoffModal appears (flag was false at consent time). On "Got it", pulse fires again.

- [ ] **Step 10.5:** Test scenario 5 — Capture error after consent-yes (big window visible).

1. Temporarily edit `desktop/src/main.ts` `daisy:captureScreen` handler to return `{ error: 'forced' }` unconditionally. Rebuild.
2. Wipe `settings.json`. Relaunch.
3. Trigger `screenshot_request`; click Yes.
4. Confirm: error banner shows in the conversation screen; HandoffModal does NOT appear; `settings.json` still has flag false.
5. Revert the `main.ts` edit, rebuild.

- [ ] **Step 10.6:** Test scenario 5a — Capture error while flag true + big window hidden.

1. Re-apply the forced-error edit and rebuild.
2. Toggle flag true via tray (or complete scenario 1 first).
3. Hide big window via tray.
4. Trigger `screenshot_request`. Confirm: subtitle pill shows red error styling for 5 seconds, then fades. Flag remains true.
5. Revert the edit, rebuild.

- [ ] **Step 10.7:** Test scenario 6 — Decline consent.

1. Wipe settings.json. Relaunch.
2. Trigger `screenshot_request`. Click "Not right now".
3. Confirm: no screenshot, no modal, no minimize. Flag still false.

- [ ] **Step 10.8:** Test scenario 7 — Bring back via tray.

1. Big window hidden (after scenario 1). Click tray daisy.
2. Confirm: big window reappears with the conversation thread intact. Overlay daisy still present.

- [ ] **Step 10.9:** Test scenario 8 — i18n.

1. Set language to Spanish via the TopBar `Es` toggle.
2. Wipe settings.json. Relaunch.
3. Repeat scenario 1. Confirm HandoffModal renders Spanish copy ("Me muevo a la esquina." / "Entendido").
4. Tray menu label remains "Sharing my screen" (we did not internationalize tray text — confirm this is acceptable; if not, file a follow-up).

- [ ] **Step 10.10:** Test scenario 9 — Regression sweep.

1. Toggle subtitles off via tray — confirm subtitle pill disappears.
2. Drag the overlay daisy to a new position — confirm subtitle pill follows.
3. Have a long conversation without ever taking a screenshot — confirm everything works as today (no extra modals, no broken state).
4. If running on multi-monitor: trigger a screenshot, confirm the screen-picker still appears and screenshot capture works.

- [ ] **Step 10.11:** Document the outcome.

If every scenario passes, add a brief note to `TODO.md` under "Pending work — what's left for a working public install" or wherever it fits, indicating screen-guide flow is shipped. If anything failed, file the failure as a follow-up commit or task before moving on.

- [ ] **Step 10.12:** Commit (only if Step 10.11 made file changes — otherwise skip).

```bash
# Only run if TODO.md or other docs were updated.
git add TODO.md
git commit -m "$(cat <<'EOF'
desktop: screen-guide flow shipped (TODO.md note)

Marks the screen-guide flow (auto-minimize + persistent screen sharing)
complete after manual smoke per the spec's test plan.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Spec coverage check

Mapping each spec section to a task that implements it:

| Spec section | Implemented in |
|---|---|
| Persistence (`AppSettings` field, defaults, loadSettings branch) | Task 1 |
| Flow — Path 1 (consent-yes → screenshot → HandoffModal → minimize) | Tasks 6, 7 |
| Flow — Path 2 (overlay click does NOT trigger handoff) | Task 7 (verified in Step 7.5; no code change because overlay click already bypasses respondConsent) |
| Subsequent silent screenshots when flag true | Task 6, Step 6.4 |
| Revocation via tray | Task 1 (tray row) + Task 7 (re-prompt verified) |
| HandoffModal copy + SVG + EN/ES | Task 5 |
| Corner-daisy attention pulse | Tasks 2 (trigger) + 4 (animation) |
| Tray menu "Sharing my screen" row | Task 1 |
| IPC table (5 new channels) | Tasks 1, 2 (main side); Task 3 (preload + types); Task 8 (subtitle error IPC) |
| Renderer wiring in `useDaisyBackend` (state, refs, dismissHandoff, respondConsent change, screenshot_request branch) | Task 6 |
| App-level `onHandoffConfirmed` + modal render | Task 7 |
| Edge case — capture fail after consent-yes | Tasks 6 + 10 (Step 10.5) |
| Edge case — user says no | Task 10 (Step 10.7) |
| Edge case — toggle off then back on (no screenshot) | Task 1 covers the toggling; Task 6 covers no screenshot fires; verified in Step 10.4 conceptually |
| Edge case — multi-monitor | Existing `captureScreen` handles it; Step 10.10 spot-checks |
| Edge case — error pill when big window hidden | Tasks 8 + 9 |
| Manual test plan (9 scenarios) | Task 10 |

No gaps identified.
