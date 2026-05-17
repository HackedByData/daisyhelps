# Prompt: Build a screen-wide pointer overlay for Daisy's click indicator

This is a self-contained briefing for a coding agent (or future contributor) who'll implement the click-indicator visualization end-to-end. Pass the **entire body** of this doc to the agent as their task; everything they need to start is here.

---

## Context

**Daisy Helps** is a voice AI companion for tech-novice users built as an Electron desktop app for Windows. The user talks to Daisy; Daisy listens, optionally looks at the screen via screenshots, and walks them through tasks. When Daisy wants the user to click something specific on their screen, the backend already computes the screen coordinates of that target and emits a `click_indicator` WebSocket message. The desktop app currently swallows that message into a yellow caption banner ("👉 Click on Mail, then tell me what happened.") — your job is to make it visible **on the actual screen** instead, as a daisy-shaped selector icon hovering over the target.

Repository: `C:\Users\devin\DaisyHelps\daisyhelps`. Work in the `desktop/` subdirectory.

## Status

**Partial scaffold landed.** As of the most recent commit on `main`:

- ✅ `desktop/src/main.ts` has `createIndicator()` + `indicatorWindow` BrowserWindow created on app ready, plus IPC handlers for `daisy:show-indicator` (with coordinate translation from `ref_width × ref_height` to physical screen pixels) and `daisy:clear-indicator` (with auto-clear timer).
- ✅ `desktop/src/preload.ts` exposes `showIndicator`, `clearIndicator`, `onShowIndicator` on `window.daisyAPI`.
- ✅ `desktop/src/renderer/types.ts` `DaisyAPI` interface updated.
- ❌ **No renderer for the indicator window yet** — `desktop/src/renderer/indicator.{html,css,ts}` don't exist. The BrowserWindow is created but loads nothing. Calls to `showIndicator` go through, the window briefly shows, but there's no content.
- ❌ **`desktop/src/renderer/main.jsx` still uses the OLD stub** — the `case 'click_indicator'` branch sets `clickHint` (yellow banner in conversation), not `window.daisyAPI.showIndicator(...)`.

**What's left to do** = §3 (indicator renderer files) and §4 (wire `main.jsx`) below. §1 (main.ts) and §2 (preload.ts) are reference; double-check them against the live files but don't re-implement.

## What's already in place

- **Backend** (live at `wss://api.daisyhelps.com`) sends `click_indicator` messages per `docs/API.md`:

  ```json
  {
    "type": "click_indicator",
    "x": 412, "y": 880,
    "ref_width": 1920, "ref_height": 1080,
    "label": "Mail icon",
    "confidence": 0.93
  }
  ```

  And `{ "type": "clear_indicator" }` to remove it.
  - `x, y` are pixel coordinates in the screenshot's coordinate space (`ref_width × ref_height`). The screenshot is the user's primary display captured at native resolution by `desktopCapturer` (see `desktop/src/main.ts` `ipcMain.handle('daisy:captureScreen', ...)`), so in practice `ref_width × ref_height` equals the primary display size — but **do the translation properly**, don't assume equality:

    ```
    physicalX = x * (screen.width  / ref_width)
    physicalY = y * (screen.height / ref_height)
    ```

- **Desktop app** is Electron + TypeScript main process + a React/Babel/CDN renderer (the `.jsx` files are loaded via `<script type="text/babel">`, transpiled in-browser). There's already a precedent for a small transparent always-on-top window: see `desktop/src/main.ts` `createOverlay()` and `desktop/src/renderer/overlay.{html,css,ts}` — that's the corner daisy. **Model your new indicator window on that pattern**, but full-screen and click-through.

- **Current stub** that you should replace. In `desktop/src/renderer/main.jsx`, search for `case 'click_indicator'` and `case 'clear_indicator'` inside `useDaisyBackend`. Right now they set/clear a `clickHint` React state that renders a banner via `ConversationScreen`'s `clickHint` prop (`desktop/src/renderer/screens.jsx`). Replace the state mutation with an IPC call to your new indicator window (`window.daisyAPI.showIndicator({ x, y, refW, refH, label })` / `clearIndicator()`). You can leave the banner as a fallback or remove it — your call.

- **Build commands** (run from `desktop/`):

  ```
  npm run build         # tsc both projects + copyfiles JSX/CSS/PNG to dist/
  npm start             # build then launch Electron
  npm run dev           # build then launch with --enable-logging (use this; it surfaces renderer console messages in the terminal)
  ```

  The `build:renderer` script copies `**/*.{html,css,jsx}` and `assets/**` into `dist/renderer/`. Any new files in `src/renderer/` will be picked up automatically.

## What to build

### 1. New `indicatorWindow` in `desktop/src/main.ts`

A new `BrowserWindow` created on app ready alongside `createOverlay()`:

- Size: full primary display work area
- Position: (0, 0) on the primary display
- `frame: false`, `transparent: true`, `alwaysOnTop: true`, `skipTaskbar: true`, `focusable: false`, `resizable: false`, `show: false`
- `webPreferences`: contextIsolation true, nodeIntegration false, sandbox true, preload as usual
- After load: `indicatorWindow.setIgnoreMouseEvents(true)` so user clicks pass through to the actual app underneath
- Loads `dist/renderer/indicator.html`

Add IPC handlers in `main.ts`:

```ts
ipcMain.on('daisy:show-indicator', (_e, args) => {
  // Translate from screenshot pixel space to physical screen pixels
  const primary = screen.getPrimaryDisplay();
  const { width: sw, height: sh } = primary.size;
  const physX = Math.round(args.x * (sw / args.refW));
  const physY = Math.round(args.y * (sh / args.refH));
  indicatorWindow?.webContents.send('daisy:show-indicator', { x: physX, y: physY, label: args.label });
  indicatorWindow?.show();
  // Auto-clear after 8 seconds so it doesn't linger if backend never sends clear_indicator
  if (indicatorClearTimer) clearTimeout(indicatorClearTimer);
  indicatorClearTimer = setTimeout(() => indicatorWindow?.hide(), 8000);
});
ipcMain.on('daisy:clear-indicator', () => {
  if (indicatorClearTimer) clearTimeout(indicatorClearTimer);
  indicatorWindow?.hide();
});
```

### 2. Preload bridge in `desktop/src/preload.ts`

Add to the `daisyAPI` object exposed via `contextBridge`:

```ts
showIndicator: (args: { x: number; y: number; refW: number; refH: number; label?: string }) =>
  ipcRenderer.send('daisy:show-indicator', args),
clearIndicator: () => ipcRenderer.send('daisy:clear-indicator'),
onShowIndicator: (cb: (args: { x: number; y: number; label?: string }) => void) =>
  ipcRenderer.on('daisy:show-indicator', (_e, args) => cb(args)),
```

Update the `DaisyAPI` interface in `desktop/src/renderer/types.ts` to match.

### 3. New renderer: `desktop/src/renderer/indicator.{html,css,ts}`

- `indicator.html`: minimal — strict CSP (no external scripts/styles), a single `<div id="pointer">` containing an `<img>` of the daisy selector + optional `<span>` for the label
- `indicator.css`: full-screen transparent body. Position the `#pointer` absolutely. Animate a soft pulse (e.g., 2 concentric rings expanding outward) to draw the eye. Use the design tokens from `desktop/src/renderer/styles.css` (`--daisy-orange: #ED8B33`, `--daisy-yellow: #F4C24A`, `--cream-0: #FBF7EE`, font `Atkinson Hyperlegible` if available locally — otherwise system-ui is fine since there's no network)
- `indicator.ts`: listens on `window.daisyAPI.onShowIndicator(({x, y, label}) => ...)`. Centers the `#pointer` element at `(x, y)` via `transform: translate(-50%, -50%); left: ${x}px; top: ${y}px`. Updates the label text.

Use the daisy selector image at `desktop/src/renderer/assets/daisy_logo__1_-removebg-preview.png` (or extract a smaller cropped variant if it's too big — diameter ~80px feels right).

### 4. Wire it in `desktop/src/renderer/main.jsx`

Inside `useDaisyBackend`, replace:

```js
case 'click_indicator':
  setClickHint(msg.label || 'this');
  break;
case 'clear_indicator':
  setClickHint(null);
  break;
```

with:

```js
case 'click_indicator':
  window.daisyAPI?.showIndicator?.({
    x: msg.x, y: msg.y,
    refW: msg.ref_width, refH: msg.ref_height,
    label: msg.label || undefined,
  });
  setClickHint(msg.label || 'this');  // keep banner as a secondary cue
  break;
case 'clear_indicator':
  window.daisyAPI?.clearIndicator?.();
  setClickHint(null);
  break;
```

## Gotchas

- **Click-through is essential.** If `setIgnoreMouseEvents(true)` isn't set, the user can't click their actual target underneath the indicator.
- **Window must be on the same display the screenshot came from.** For v1 assume primary display. Multi-monitor support is a follow-up.
- **Transparent windows on Windows have rendering quirks** — see how `overlay.css` locks `html, body` to fixed pixel sizes (`72px × 72px max-width/max-height`) to prevent Aero Snap from growing the window. Do the same for the indicator: lock `html, body` to the screen size and set `resizable: false` on the BrowserWindow.
- **CSP** on the new indicator HTML should be strict (`default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline';`) — no external scripts needed.
- **Don't break the existing overlay window** in `desktop/src/renderer/overlay.{html,css,ts}` — it's the corner daisy and it works.

## How to test

The backend only emits `click_indicator` when Claude decides to suggest a click action — hard to trigger reliably during dev. Add a temporary dev shortcut in `main.jsx` while you're working:

```js
// DEV-ONLY: Ctrl+Shift+I fires a fake indicator at center-screen.
useEffect(() => {
  function onKey(e) {
    if (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'i')) {
      window.daisyAPI?.showIndicator?.({ x: 800, y: 500, refW: 1600, refH: 900, label: 'Mail icon' });
    }
  }
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}, []);
```

Remove the shortcut before you commit.

Acceptance criteria:

- [ ] Pressing Ctrl+Shift+I (with the dev shortcut) shows a daisy pointer at the indicated screen location on top of any application
- [ ] Clicking through the pointer area actually clicks the underlying app (not the indicator window)
- [ ] The pointer auto-disappears 8 seconds after appearing
- [ ] If the backend emits `clear_indicator`, the pointer disappears immediately
- [ ] The label appears as a small text bubble next to the pointer when provided
- [ ] The existing corner overlay (small daisy in top-right) and main conversation window still work — no regression
- [ ] No CSP violations or JS errors in the renderer console (`npm run dev` shows them in the terminal)

## Commit conventions

Per `CLAUDE.md`: prefix commits with `desktop:` and stage by explicit path (never `git add -A` — the repo root has `.env` and other intentionally-untracked files). One logical change per commit. Don't update version in `package.json` unless explicitly asked.
