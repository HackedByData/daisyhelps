# Overlay Subtitles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pill-shaped subtitle banner that appears below the corner Daisy overlay, displays her speech one line at a time (word-by-word streaming, sliding-window ticker), and disappears 4 seconds after she stops. Toggleable on/off via tray menu and main-window Settings; default on.

**Architecture:** A new dedicated transparent BrowserWindow (`subtitleWindow`) at 320×44, click-through, alwaysOnTop, position-locked to the overlay. Fixed-size window with internal CSS overflow + JS `translateX` for the ticker (avoids re-triggering the overlay's Aero-Snap hardening). Settings persist to `userData/settings.json` (no new dependency); state syncs across tray + main window via main-process broadcast.

**Tech Stack:** Electron 32 (existing), TypeScript (renderer + main), React via Babel-CDN (existing pattern in `main.jsx`), no new npm deps.

**Spec:** `docs/superpowers/specs/2026-05-17-overlay-subtitles-design.md`

**Project testing convention:** The desktop app has no automated tests (vitest is installed but unused for renderer code; existing pattern is manual smoke). This plan uses incremental build-and-verify steps with a final manual smoke checklist, matching the convention.

---

## File map

**Create:**
- `desktop/src/renderer/subtitle.html` — pill markup, CSP, script tag
- `desktop/src/renderer/subtitle.css` — pill styling (transparent body, rounded background, transition)
- `desktop/src/renderer/subtitle.ts` — IPC subscriber + sliding-window text translation

**Modify:**
- `desktop/src/main.ts` — `createSubtitle()`, settings persistence, 6 new IPC handlers, drag-sync hook, tray menu item
- `desktop/src/preload.ts` — 6 new methods on `daisyAPI`
- `desktop/src/renderer/types.ts` — extend `DaisyAPI` interface
- `desktop/src/renderer/main.jsx` — wire `daisy_text` → subtitle, 4s linger timer, settings toggle plumbing
- `desktop/src/renderer/screens.jsx` — extend `SettingsSheet` with a Subtitles row; add `subtitles`/`subtitlesOn`/`subtitlesOff` to EN/ES `COPY`

---

## Task 1: Subtitle window scaffold (main process)

**Files:**
- Modify: `desktop/src/main.ts` (add `subtitleWindow` + `createSubtitle()` + call from `whenReady`)
- Create: `desktop/src/renderer/subtitle.html` (minimal markup so the window has something to render)

- [ ] **Step 1: Create `desktop/src/renderer/subtitle.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self'; script-src 'self';" />
  <link rel="stylesheet" href="subtitle.css" />
</head>
<body>
  <div id="pill" hidden aria-live="polite">
    <div class="pill__clip">
      <span class="pill__text"></span>
    </div>
  </div>
  <script type="module" src="subtitle.js"></script>
</body>
</html>
```

(Note: `subtitle.js` is the TypeScript compile output of `subtitle.ts`, created in Task 2.)

- [ ] **Step 2: Add `subtitleWindow` declaration and `createSubtitle()` to `main.ts`**

Add the declaration alongside the existing top-level `let` bindings near line 11–14 of `desktop/src/main.ts`:

```ts
let subtitleWindow: BrowserWindow | null = null;
```

Add this function just below `createIndicator()` (around line 76):

```ts
function createSubtitle(): void {
  // Pill-shaped subtitle banner anchored below the overlay. Fixed size, fully
  // click-through, alwaysOnTop. Stays alive for the app lifetime; toggling
  // visibility is show()/hide() rather than destroy/recreate.
  const SUB_W = 320;
  const SUB_H = 44;
  const primary = screen.getPrimaryDisplay();
  // Initial position is recomputed by repositionSubtitle() right after creation
  // (and again whenever the overlay moves). The values here just have to be valid.
  const x = primary.bounds.x + 16;
  const y = primary.bounds.y + 16;

  subtitleWindow = new BrowserWindow({
    width: SUB_W, height: SUB_H,
    x, y,
    useContentSize: true,
    frame: false, transparent: true,
    alwaysOnTop: true, skipTaskbar: true,
    focusable: false, resizable: false,
    minimizable: false, maximizable: false, fullscreenable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  subtitleWindow.setAlwaysOnTop(true, 'screen-saver');
  subtitleWindow.setIgnoreMouseEvents(true);
  subtitleWindow.loadFile(path.join(__dirname, 'renderer', 'subtitle.html'));
  subtitleWindow.on('closed', () => { subtitleWindow = null; });
}
```

- [ ] **Step 3: Call `createSubtitle()` from `whenReady`**

In `desktop/src/main.ts`, find the block near the end of the `app.whenReady().then(() => { ... })` that calls `createOverlay(); createIndicator();` (around line 238–239) and add the subtitle call right after:

```ts
  createTray();
  createWindow();
  createOverlay();
  createIndicator();
  createSubtitle();        // ← new
  setupAutoUpdate();
```

- [ ] **Step 4: Verify it builds and the (still-hidden) window loads without error**

Run from `desktop/`:

```bash
npm run build
```

Expected: TypeScript compiles cleanly. No errors about `subtitleWindow`, `createSubtitle`, or the HTML file path.

- [ ] **Step 5: Smoke check — launch the app**

```bash
npm start
```

Expected: app launches normally (overlay daisy in the corner, main window opens). No new visible window yet (subtitle is `show: false`). Check `--enable-logging` console for any "Failed to load resource: subtitle.html" errors — there should be none.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/main.ts desktop/src/renderer/subtitle.html
git commit -m "desktop: subtitle window scaffold (hidden by default)"
```

---

## Task 2: Subtitle renderer (CSS + sliding-window text logic)

**Files:**
- Create: `desktop/src/renderer/subtitle.css`
- Create: `desktop/src/renderer/subtitle.ts`

- [ ] **Step 1: Create `desktop/src/renderer/subtitle.css`**

```css
/* Pill-shaped subtitle banner. Window is fixed 320×44; the pill itself fills
   the window and the inner text uses translateX for the sliding-window ticker
   effect. */
*, *::before, *::after { box-sizing: border-box; }

html, body {
  margin: 0; padding: 0;
  width: 320px; height: 44px;
  background: transparent;
  overflow: hidden;
  -webkit-user-select: none; user-select: none;
}

#pill {
  width: 320px; height: 44px;
  border-radius: 22px;
  background: rgba(20, 20, 24, 0.82);
  color: #fff;
  font: 16px/1 -apple-system, "Segoe UI", system-ui, sans-serif;
  display: flex; align-items: center;
  padding: 0 18px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
  opacity: 0;
  transition: opacity 240ms ease;
}
#pill:not([hidden]) { opacity: 1; }

.pill__clip {
  flex: 1 1 auto;
  overflow: hidden;
  height: 22px;
  display: flex; align-items: center;
}

.pill__text {
  white-space: nowrap;
  display: inline-block;
  transition: transform 120ms linear;
  will-change: transform;
}

@media (prefers-reduced-motion: reduce) {
  #pill, .pill__text { transition: none !important; }
}
```

- [ ] **Step 2: Create `desktop/src/renderer/subtitle.ts`**

```ts
// Subtitle renderer — receives accumulated text from main via IPC and renders
// it as a sliding-window ticker. The pill is fixed width; if the rendered
// text is wider than the visible area, we translate the text leftward so the
// most recent characters (right edge) are always visible.

const pill = document.getElementById('pill') as HTMLElement;
const clip = pill.querySelector('.pill__clip') as HTMLElement;
const text = pill.querySelector('.pill__text') as HTMLElement;

let hideTimer: number | null = null;

function render(content: string): void {
  if (hideTimer !== null) {
    window.clearTimeout(hideTimer);
    hideTimer = null;
  }
  text.textContent = content;
  pill.hidden = false;
  // Measure on the next animation frame so layout has settled. Without rAF,
  // scrollWidth on the just-mutated span occasionally lags by one frame.
  requestAnimationFrame(() => {
    const overflow = text.scrollWidth - clip.clientWidth;
    text.style.transform = overflow > 0 ? `translateX(-${overflow}px)` : 'none';
  });
}

function fadeOut(): void {
  // Set opacity via the [hidden] toggle (pill has `opacity: 0` while hidden,
  // `opacity: 1` otherwise — see subtitle.css). The 240ms transition runs;
  // we wait for it before clearing the text so the fade is uninterrupted.
  pill.hidden = true;
  if (hideTimer !== null) window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    text.textContent = '';
    text.style.transform = 'none';
    hideTimer = null;
  }, 260);
}

window.daisyAPI?.onShowSubtitle?.((newText: string) => render(newText));
window.daisyAPI?.onClearSubtitle?.(() => fadeOut());
```

(Note: `onShowSubtitle` / `onClearSubtitle` are added to `daisyAPI` in Task 3.)

- [ ] **Step 3: Verify the build copies the new files**

The existing `build:renderer` script in `desktop/package.json` already globs `*.{html,css,jsx}` and compiles `.ts` via `tsconfig.renderer.json`. Run:

```bash
npm run build
```

Expected: `desktop/dist/renderer/subtitle.html`, `subtitle.css`, `subtitle.js` all exist. No TS errors.

```bash
ls dist/renderer/subtitle.*
```

- [ ] **Step 4: Commit**

```bash
git add desktop/src/renderer/subtitle.css desktop/src/renderer/subtitle.ts
git commit -m "desktop: subtitle renderer with sliding-window text"
```

---

## Task 3: Show/Clear IPC + preload bridge

**Files:**
- Modify: `desktop/src/main.ts` (add 2 IPC handlers, forward to subtitle window)
- Modify: `desktop/src/preload.ts` (expose `subtitleShow`, `subtitleClear`, `onShowSubtitle`, `onClearSubtitle`)
- Modify: `desktop/src/renderer/types.ts` (extend `DaisyAPI`)

- [ ] **Step 1: Add IPC handlers in `main.ts`**

Add these handlers inside the `app.whenReady().then(...)` block, alongside the existing indicator IPC (around line 212–226):

```ts
  // Subtitle IPC (main renderer → main → subtitle renderer).
  ipcMain.on('daisy:subtitle-show', (_e, text: string) => {
    if (!subtitleWindow) return;
    if (!subtitleWindow.isVisible()) subtitleWindow.showInactive();
    subtitleWindow.webContents.send('daisy:show-subtitle', text);
  });
  ipcMain.on('daisy:subtitle-clear', () => {
    if (!subtitleWindow) return;
    subtitleWindow.webContents.send('daisy:clear-subtitle');
    // Hide after the fade transition (~260ms) — keeps the pill from
    // visually "popping" out when text-clearing completes mid-fade.
    setTimeout(() => subtitleWindow?.hide(), 280);
  });
```

- [ ] **Step 2: Expose subtitle methods in `preload.ts`**

Add to the `contextBridge.exposeInMainWorld('daisyAPI', { ... })` object in `desktop/src/preload.ts`, right after the existing indicator block:

```ts
  // Subtitle (main renderer → main → subtitle renderer)
  subtitleShow:  (text: string) => ipcRenderer.send('daisy:subtitle-show', text),
  subtitleClear: () => ipcRenderer.send('daisy:subtitle-clear'),
  onShowSubtitle: (cb: (text: string) => void) => {
    ipcRenderer.on('daisy:show-subtitle', (_e, text) => cb(text));
  },
  onClearSubtitle: (cb: () => void) => {
    ipcRenderer.on('daisy:clear-subtitle', () => cb());
  },
```

- [ ] **Step 3: Extend `DaisyAPI` in `types.ts`**

Add to the `DaisyAPI` interface in `desktop/src/renderer/types.ts` (after the `indicatorSetPassthrough` line):

```ts
  subtitleShow(text: string): void;
  subtitleClear(): void;
  onShowSubtitle(cb: (text: string) => void): void;
  onClearSubtitle(cb: () => void): void;
```

- [ ] **Step 4: Build + manual show test**

```bash
npm run build
```

Then add a temporary one-shot test by editing `desktop/src/main.ts` to invoke a test show 5 seconds after launch. **Skip this step** (it requires temporary code and then a revert) — Task 5 will wire real flow and we can test then. Just verify the build:

```bash
npm run build
```

Expected: no TS errors.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/main.ts desktop/src/preload.ts desktop/src/renderer/types.ts
git commit -m "desktop: subtitle show/clear IPC bridge"
```

---

## Task 4: Position lock + drag sync + edge handling

**Files:**
- Modify: `desktop/src/main.ts` (add `repositionSubtitle()`, hook into createSubtitle + overlay drag + overlay move)

- [ ] **Step 1: Add `repositionSubtitle()` helper to `main.ts`**

Insert just below `createSubtitle()` (which was added in Task 1):

```ts
function repositionSubtitle(): void {
  if (!overlayWindow || !subtitleWindow) return;
  const o = overlayWindow.getBounds();
  const sw = 320, sh = 44;
  const GAP = 8;
  // Pick the display the overlay currently sits on (handles multi-monitor
  // when the user drags the daisy from one screen to another).
  const display = screen.getDisplayNearestPoint({ x: o.x + o.width / 2, y: o.y + o.height / 2 });
  const { x: dx, y: dy, width: dw, height: dh } = display.workArea;

  // Centered horizontally on the overlay, GAP below.
  let x = Math.round(o.x + o.width / 2 - sw / 2);
  let y = o.y + o.height + GAP;

  // Clamp within the overlay's current display.
  if (x < dx) x = dx;
  if (x + sw > dx + dw) x = dx + dw - sw;
  // If no room below, flip above.
  if (y + sh > dy + dh) y = o.y - sh - GAP;
  // And if there's no room above either (overlay covers the whole display
  // height somehow), pin to the top of the work area.
  if (y < dy) y = dy;

  subtitleWindow.setBounds({ x, y, width: sw, height: sh });
}
```

- [ ] **Step 2: Call `repositionSubtitle()` after `createSubtitle()`**

In the `whenReady` block, change:

```ts
  createOverlay();
  createIndicator();
  createSubtitle();
  setupAutoUpdate();
```

to:

```ts
  createOverlay();
  createIndicator();
  createSubtitle();
  repositionSubtitle();
  // Keep the subtitle stuck to the overlay whenever the overlay moves by any
  // means (drag, programmatic, future setPosition calls).
  overlayWindow?.on('move', () => repositionSubtitle());
  setupAutoUpdate();
```

- [ ] **Step 3: Hook drag-move IPC handler**

The existing `daisy:overlay-drag-move` handler (around lines 189–195) currently only calls `overlayWindow.setPosition(...)`. Append a `repositionSubtitle()` call:

Find:

```ts
  ipcMain.on('daisy:overlay-drag-move', (_e, dx: number, dy: number) => {
    if (!overlayWindow || !overlayDragOrigin) return;
    overlayWindow.setPosition(
      Math.round(overlayDragOrigin.x + dx),
      Math.round(overlayDragOrigin.y + dy),
    );
  });
```

(The `overlayWindow.on('move', ...)` from Step 2 will fire automatically here, so no explicit call is needed inside the handler. Leave the handler unchanged — the `'move'` listener registered in Step 2 covers drag, programmatic moves, and future affordances.)

- [ ] **Step 4: Build and smoke-test position lock**

```bash
npm run build
npm start
```

Expected: app launches; subtitle window is created but hidden (still no visible pill yet — Task 5 wires the data source). Verify no errors at startup.

To make the pill visible for this position-lock smoke test, **temporarily** add at the bottom of `app.whenReady().then(...)`:

```ts
  // TEMPORARY — remove after Task 4 verification
  setTimeout(() => {
    subtitleWindow?.webContents.send('daisy:show-subtitle', 'Position lock smoke test');
    subtitleWindow?.showInactive();
  }, 2000);
```

Rebuild, launch. Expected:
- Pill appears below the daisy 2s after launch.
- Drag the overlay daisy around the screen; the pill follows in lockstep.
- Drag the daisy to within ~50px of the bottom edge of the screen; the pill flips above.
- (If you have multiple monitors) drag the daisy to a secondary display; the pill follows to that display.

- [ ] **Step 5: Remove the temporary test code and rebuild**

Delete the TEMPORARY block from `main.ts`. Rebuild:

```bash
npm run build
```

- [ ] **Step 6: Commit**

```bash
git add desktop/src/main.ts
git commit -m "desktop: subtitle position-lock + drag sync + edge flip"
```

---

## Task 5: Settings persistence (JSON file)

**Files:**
- Modify: `desktop/src/main.ts` (add `loadSettings()`, `saveSettings()`, in-memory `subtitlesEnabled`)

- [ ] **Step 1: Add settings infrastructure to `main.ts`**

Add `fs` import at the top of `desktop/src/main.ts`:

```ts
import fs from 'node:fs';
```

(Goes alongside the existing `import path from 'node:path';`.)

Add this block near the top of the file, just below the existing top-level `let` declarations (around line 14):

```ts
interface AppSettings {
  subtitles_enabled: boolean;
}
const DEFAULT_SETTINGS: AppSettings = { subtitles_enabled: true };
let appSettings: AppSettings = { ...DEFAULT_SETTINGS };

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings(): void {
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    appSettings = {
      subtitles_enabled: typeof parsed.subtitles_enabled === 'boolean'
        ? parsed.subtitles_enabled
        : DEFAULT_SETTINGS.subtitles_enabled,
    };
  } catch (err: unknown) {
    // ENOENT on first launch is expected. Anything else: warn and use defaults.
    if (!(err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT')) {
      console.warn('[settings] failed to read settings.json, using defaults:', err);
    }
    appSettings = { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(): void {
  try {
    fs.writeFileSync(settingsPath(), JSON.stringify(appSettings, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[settings] failed to write settings.json:', err);
  }
}
```

- [ ] **Step 2: Load settings before any windows are created**

In `app.whenReady().then(() => { ... })`, add `loadSettings()` as the very first call:

```ts
app.whenReady().then(() => {
  loadSettings();

  // Grant mic permission to the renderer once at startup
  session.defaultSession.setPermissionRequestHandler(...);
  ...
```

- [ ] **Step 3: Build + verify the file path works**

```bash
npm run build
npm start
```

Expected: app launches, no errors. After launch, the file at `%APPDATA%/daisyhelps-desktop/settings.json` may not exist yet (no write has happened) — that's normal. The load attempts and falls through to defaults.

To verify path resolution, temporarily call `saveSettings()` after `loadSettings()`:

```ts
  loadSettings();
  saveSettings();  // TEMPORARY
```

Rebuild, launch, then verify the file exists:

```powershell
Get-Content "$env:APPDATA\daisyhelps-desktop\settings.json"
```

Expected: `{ "subtitles_enabled": true }`. Remove the temporary `saveSettings()` call.

- [ ] **Step 4: Commit**

```bash
git add desktop/src/main.ts
git commit -m "desktop: subtitle settings persistence (userData/settings.json)"
```

---

## Task 6: Subtitle on/off IPC (get / set / broadcast)

**Files:**
- Modify: `desktop/src/main.ts` (3 new IPC handlers + broadcast helper)
- Modify: `desktop/src/preload.ts` (3 new methods)
- Modify: `desktop/src/renderer/types.ts` (3 new entries on `DaisyAPI`)

- [ ] **Step 1: Add IPC handlers to `main.ts`**

Add inside `app.whenReady().then(...)`, near the other subtitle handlers from Task 3:

```ts
  // Subtitle enable/disable state + cross-window broadcast.
  ipcMain.handle('daisy:subtitle-enabled-get', () => appSettings.subtitles_enabled);
  ipcMain.on('daisy:subtitle-enabled-set', (_e, enabled: boolean) => {
    setSubtitlesEnabled(!!enabled);
  });
```

Add this helper function near `loadSettings()` / `saveSettings()`:

```ts
function setSubtitlesEnabled(enabled: boolean): void {
  if (appSettings.subtitles_enabled === enabled) return;
  appSettings.subtitles_enabled = enabled;
  saveSettings();
  // Hide the pill immediately when disabling mid-turn.
  if (!enabled) subtitleWindow?.hide();
  // Broadcast to all renderers so tray + settings sheet stay in sync.
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send('daisy:subtitle-enabled-changed', enabled);
  }
  // Rebuild the tray menu so its checkbox reflects the new state.
  rebuildTrayMenu();
}
```

(`rebuildTrayMenu()` is added in Task 7. Until then, the function call will be a TypeScript error — we'll add a forward stub here so this task compiles standalone.)

Add a stub above `setSubtitlesEnabled`:

```ts
function rebuildTrayMenu(): void {
  // Real implementation in Task 7. Stub so setSubtitlesEnabled is self-contained.
}
```

- [ ] **Step 2: Gate `daisy:subtitle-show` on the setting**

Change the `daisy:subtitle-show` handler from Task 3 so it respects the setting:

```ts
  ipcMain.on('daisy:subtitle-show', (_e, text: string) => {
    if (!subtitleWindow) return;
    if (!appSettings.subtitles_enabled) return;  // ← new gate
    if (!subtitleWindow.isVisible()) subtitleWindow.showInactive();
    subtitleWindow.webContents.send('daisy:show-subtitle', text);
  });
```

(The renderer-side gate in `main.jsx` from Task 8 makes this redundant for the normal path, but defense-in-depth is cheap and protects against future direct callers.)

- [ ] **Step 3: Expose methods in `preload.ts`**

Add to the `daisyAPI` object:

```ts
  // Subtitle enable/disable
  subtitleEnabledGet: () => ipcRenderer.invoke('daisy:subtitle-enabled-get') as Promise<boolean>,
  subtitleEnabledSet: (enabled: boolean) => ipcRenderer.send('daisy:subtitle-enabled-set', enabled),
  onSubtitleEnabledChanged: (cb: (enabled: boolean) => void) => {
    ipcRenderer.on('daisy:subtitle-enabled-changed', (_e, enabled) => cb(enabled));
  },
```

- [ ] **Step 4: Extend `DaisyAPI` in `types.ts`**

Add to the interface:

```ts
  subtitleEnabledGet(): Promise<boolean>;
  subtitleEnabledSet(enabled: boolean): void;
  onSubtitleEnabledChanged(cb: (enabled: boolean) => void): void;
```

- [ ] **Step 5: Build**

```bash
npm run build
```

Expected: clean TS compile.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/main.ts desktop/src/preload.ts desktop/src/renderer/types.ts
git commit -m "desktop: subtitle enable/disable IPC + broadcast"
```

---

## Task 7: Tray menu checkable item

**Files:**
- Modify: `desktop/src/main.ts` (replace stub `rebuildTrayMenu()` with real implementation; switch initial `createTray()` to use it)

- [ ] **Step 1: Replace the `rebuildTrayMenu()` stub with the real implementation**

Replace the stub from Task 6:

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

- [ ] **Step 2: Update `createTray()` to delegate to `rebuildTrayMenu()`**

Replace the existing menu construction inside `createTray()`:

```ts
function createTray(): void {
  tray = new Tray(path.join(__dirname, 'tray-icon.png'));
  tray.setToolTip('Daisy Helps');
  rebuildTrayMenu();
  tray.on('click', () => {
    if (mainWindow?.isVisible()) mainWindow.hide();
    else { mainWindow?.show(); mainWindow?.focus(); }
  });
}
```

- [ ] **Step 3: Build + smoke-test the tray toggle**

```bash
npm run build
npm start
```

Expected:
- Right-click the tray icon → "Subtitles" item is visible with a checkmark (default on).
- Click it → checkmark disappears; `%APPDATA%/daisyhelps-desktop/settings.json` now contains `"subtitles_enabled": false`.
- Click it again → checkmark returns; file shows `true`.

Verify file:

```powershell
Get-Content "$env:APPDATA\daisyhelps-desktop\settings.json"
```

- [ ] **Step 4: Commit**

```bash
git add desktop/src/main.ts
git commit -m "desktop: tray menu — subtitles checkbox toggle"
```

---

## Task 8: Wire `daisy_text` → subtitle in main renderer (+ 4s linger + interrupt clearing)

**Files:**
- Modify: `desktop/src/renderer/main.jsx` (extend `useDaisyBackend` to forward to subtitle window + manage linger timer)

- [ ] **Step 1: Add subtitles-enabled state to `useDaisyBackend`**

Near the existing `useState` block in `useDaisyBackend` (around lines 77–86 of `desktop/src/renderer/main.jsx`), add:

```js
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(true);
  const subtitlesEnabledRef = useRef(true);
  useEffect(() => { subtitlesEnabledRef.current = subtitlesEnabled; }, [subtitlesEnabled]);
```

After the existing top-level `useEffect` that connects the WS (around line 158), add a separate effect to load + subscribe to the setting:

```js
  // Subtitle setting — load initial value from main and listen for changes
  // (tray menu or other windows can toggle it; we mirror via broadcast).
  useEffect(() => {
    let mounted = true;
    void window.daisyAPI?.subtitleEnabledGet?.().then((enabled) => {
      if (mounted) setSubtitlesEnabled(!!enabled);
    });
    window.daisyAPI?.onSubtitleEnabledChanged?.((enabled) => {
      if (mounted) setSubtitlesEnabled(!!enabled);
    });
    return () => { mounted = false; };
  }, []);
```

- [ ] **Step 2: Add a linger-timer ref**

Add alongside the other `useRef` declarations (near line 100):

```js
  const subtitleLingerRef = useRef(null);
```

- [ ] **Step 3: Forward `daisy_text` to the subtitle window**

Replace the existing `daisy_text` case in the `ws.onmessage` switch (lines 184–194):

```js
          case 'daisy_text':
            // Cancel any pending linger-hide — new content arrives, the pill
            // should stay (or come back) visible immediately.
            if (subtitleLingerRef.current) {
              clearTimeout(subtitleLingerRef.current);
              subtitleLingerRef.current = null;
            }
            if (msg.partial) {
              partialRef.current += msg.text;
              setDaisyText(partialRef.current);
              setDaisyStreaming(true);
              if (subtitlesEnabledRef.current) {
                window.daisyAPI?.subtitleShow?.(partialRef.current);
              }
            } else {
              setDaisyText(msg.text);
              partialRef.current = '';
              setDaisyStreaming(false);
              if (subtitlesEnabledRef.current) {
                window.daisyAPI?.subtitleShow?.(msg.text);
              }
            }
            break;
```

- [ ] **Step 4: Schedule the 4-second linger hide on `audio_end`**

Replace the existing `audio_end` case (lines 198–210) to add the timer:

```js
          case 'audio_end':
            setDaisyStreaming(false);
            // Linger the subtitle pill 4s after speech ends, then clear.
            if (subtitleLingerRef.current) clearTimeout(subtitleLingerRef.current);
            subtitleLingerRef.current = setTimeout(() => {
              window.daisyAPI?.subtitleClear?.();
              subtitleLingerRef.current = null;
            }, 4000);
            // Conversational continuation: if Daisy ended with a question and
            // isn't currently pointing the user to click something, auto-start
            // listening so the user doesn't have to click the daisy each turn.
            {
              const text = (daisyTextRef.current || '').trim();
              const endsWithQuestion = /[?¿]\s*$/.test(text);
              if (endsWithQuestion && !clickHintRef.current) {
                setTimeout(() => { void startTalkingRef.current?.(); }, 500);
              }
            }
            break;
```

- [ ] **Step 5: Clear subtitle on interrupt + on end_session**

In `interruptIfBusy` (around line 313), just after `setDaisyText('')` add:

```js
    setDaisyText('');
    partialRef.current = '';
    setDaisyStreaming(false);
    if (subtitleLingerRef.current) {
      clearTimeout(subtitleLingerRef.current);
      subtitleLingerRef.current = null;
    }
    window.daisyAPI?.subtitleClear?.();          // ← new
    window.daisyAPI?.clearIndicator?.();
    setClickHint(null);
```

In `endSession` (around line 463–470), just after `setDaisyText('')` add:

```js
  const endSession = useCallback(() => {
    stopMicCapture();
    send({ type: 'end_session' });
    setState('idle');
    setUserText('');
    setDaisyText('');
    setDaisyStreaming(false);
    if (subtitleLingerRef.current) {
      clearTimeout(subtitleLingerRef.current);
      subtitleLingerRef.current = null;
    }
    window.daisyAPI?.subtitleClear?.();          // ← new
  }, [send]);
```

- [ ] **Step 6: Expose `subtitlesEnabled` + setter from the hook**

In the hook's `return` block (around lines 498–504), add `subtitlesEnabled` so the settings UI can read it:

```js
  return {
    state, markState, userText, daisyText, daisyStreaming,
    consentReason, micDenied, errorMsg, clickHint,
    startTalking, stopTalking, stopDaisy,
    respondConsent, changeLanguage, endSession, sendUserText, clearError,
    sendScreenshot, primeMicPermission,
    subtitlesEnabled,                            // ← new
  };
}
```

- [ ] **Step 7: Build + smoke test the full flow**

```bash
npm run build
npm start
```

Expected (with a live backend + working ElevenLabs):
- Click the corner daisy → mic starts.
- Say something → backend replies.
- As Daisy speaks, the pill appears below the daisy and her words stream in word-by-word.
- When she finishes, the pill stays visible ~4 seconds, then fades.
- If you start another turn within 4s, the pill resets immediately.
- Right-click tray → toggle Subtitles off → pill disappears immediately.
- Next turn: no pill.
- Toggle on again → pill returns on next turn.

If the ElevenLabs TTS 401 issue (from the known constraints) is still unresolved, the audio will fail but `daisy_text` partials still stream — verify the pill appears and slides during the text stream, then the error banner appears.

- [ ] **Step 8: Commit**

```bash
git add desktop/src/renderer/main.jsx
git commit -m "desktop: wire daisy_text → subtitle + 4s linger + interrupt clearing"
```

---

## Task 9: Settings UI toggle in SettingsSheet

**Files:**
- Modify: `desktop/src/renderer/screens.jsx` (extend `SettingsSheet` signature + EN/ES COPY)
- Modify: `desktop/src/renderer/main.jsx` (pass new props when rendering `SettingsSheet`)

- [ ] **Step 1: Add EN/ES copy for subtitles**

In `desktop/src/renderer/screens.jsx`, find the `COPY.en` block (around lines 28–32):

```js
    settingsTitle: 'Settings',
    textSize: 'Text size',
    audioTest: 'Test the sound',
    end: 'End the visit',
    close: 'Close',
```

Add the three new keys (before `close`):

```js
    settingsTitle: 'Settings',
    textSize: 'Text size',
    audioTest: 'Test the sound',
    subtitles: 'Subtitles',
    subtitlesOn: 'On',
    subtitlesOff: 'Off',
    end: 'End the visit',
    close: 'Close',
```

Likewise in the `COPY.es` block (around lines 74–78), add:

```js
    settingsTitle: 'Ajustes',
    textSize: 'Tamaño del texto',
    audioTest: 'Probar el sonido',
    subtitles: 'Subtítulos',
    subtitlesOn: 'Activado',
    subtitlesOff: 'Desactivado',
    end: 'Terminar la visita',
    close: 'Cerrar',
```

- [ ] **Step 2: Extend `SettingsSheet` to accept and render the subtitle toggle**

Replace the `SettingsSheet` function (lines 328–357 of `screens.jsx`) with:

```jsx
function SettingsSheet({
  lang, fontScale, onFontScale, onClose, onEnd, onAudioTest,
  subtitlesEnabled, onSubtitlesEnabled,
}) {
  const t = COPY[lang];
  return (
    <aside className="sheet" role="dialog" aria-modal="false" aria-labelledby="settings-title">
      <h3 id="settings-title">{t.settingsTitle}</h3>
      <div className="sheet__row">
        <div className="sheet__label">{t.textSize}</div>
        <div className="sheet__steppers">
          <button className="stepper" aria-label="Smaller" onClick={() => onFontScale(Math.max(0.85, +(fontScale - 0.1).toFixed(2)))}>A&minus;</button>
          <button className="stepper" aria-label="Larger" onClick={() => onFontScale(Math.min(1.6, +(fontScale + 0.1).toFixed(2)))}>A+</button>
        </div>
      </div>
      <div className="sheet__row">
        <div className="sheet__label">{t.subtitles}</div>
        <button
          className={`btn ${subtitlesEnabled ? 'btn--primary' : 'btn--quiet'}`}
          onClick={() => onSubtitlesEnabled(!subtitlesEnabled)}
          aria-pressed={subtitlesEnabled}
          style={{ minHeight: 56, minWidth: 120 }}
        >
          {subtitlesEnabled ? t.subtitlesOn : t.subtitlesOff}
        </button>
      </div>
      <div className="sheet__row">
        <div className="sheet__label">{t.audioTest}</div>
        <button className="btn btn--quiet" onClick={onAudioTest} style={{ minHeight: 56 }}>
          {lang === 'en' ? 'Play sound' : 'Reproducir'}
        </button>
      </div>
      <div className="sheet__row">
        <div className="sheet__label">{t.end}</div>
        <button className="btn btn--danger" onClick={onEnd} style={{ minHeight: 56 }}>
          {lang === 'en' ? 'End now' : 'Terminar'}
        </button>
      </div>
      <div className="sheet__row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn btn--ghost" onClick={onClose} style={{ minHeight: 56 }}>{t.close}</button>
      </div>
    </aside>
  );
}
```

- [ ] **Step 3: Pass the new props from `main.jsx`**

Find the `<SettingsSheet ... />` invocation in `desktop/src/renderer/main.jsx` (around lines 744–752):

```jsx
      {settingsOpen && screen === 'conversation' && (
        <SettingsSheet
          lang={lang}
          fontScale={t.fontScale}
          onFontScale={(v) => setTweak('fontScale', v)}
          onClose={() => setSettingsOpen(false)}
          onEnd={endSession}
          onAudioTest={() => {/* play a friendly beep in real build */}}
        />
      )}
```

Replace with:

```jsx
      {settingsOpen && screen === 'conversation' && (
        <SettingsSheet
          lang={lang}
          fontScale={t.fontScale}
          onFontScale={(v) => setTweak('fontScale', v)}
          onClose={() => setSettingsOpen(false)}
          onEnd={endSession}
          onAudioTest={() => {/* play a friendly beep in real build */}}
          subtitlesEnabled={daisy.subtitlesEnabled}
          onSubtitlesEnabled={(v) => window.daisyAPI?.subtitleEnabledSet?.(v)}
        />
      )}
```

(Note: `daisy.subtitlesEnabled` was exposed from `useDaisyBackend` in Task 8 Step 6. The setter goes through main → broadcast → state update, so we don't `setSubtitlesEnabled` locally.)

- [ ] **Step 4: Build + smoke test cross-window sync**

```bash
npm run build
npm start
```

Expected:
- Open the main window → click the gear/settings button → SettingsSheet shows a Subtitles row with an "On" button (highlighted as primary).
- Click it → button label flips to "Off" / style changes to quiet.
- Right-click tray → "Subtitles" checkbox is now **unchecked** (cross-window sync).
- Click the tray checkbox → SettingsSheet's button flips back to "On".

- [ ] **Step 5: Commit**

```bash
git add desktop/src/renderer/screens.jsx desktop/src/renderer/main.jsx
git commit -m "desktop: subtitles toggle in SettingsSheet (EN/ES)"
```

---

## Task 10: Manual smoke test pass + readiness bump (optional)

**Files:**
- (None — verification + version bump only)

- [ ] **Step 1: Run the spec's manual smoke checklist end-to-end**

From `desktop/`:

```bash
npm start
```

Walk through every item in the spec's testing checklist:

1. Launch cold → setting defaults on → first turn shows pill below daisy.
2. Toggle off via tray → pill disappears immediately if visible, no pill on next turn.
3. Toggle on via main-window settings → tray menu's check reflects the change (and vice versa).
4. Long Daisy reply → ticker slides left as new words stream; final words always visible on right edge.
5. Short reply → pill lingers ~4s after audio_end, then fades.
6. New turn within the 4s linger → pill reset immediately, no double-show.
7. Drag overlay across the screen → pill follows in lockstep.
8. Drag overlay to bottom edge → pill flips above.
9. Drag overlay to second monitor (if available) → pill follows, clamps to that monitor.
10. Quit + relaunch → setting persists.
11. Click "through" where the pill is → click reaches the app underneath, never the pill.

Fix any regressions, recommit, re-test.

- [ ] **Step 2: (Optional) Bump desktop version for next release tag**

If this feature is being shipped as part of v0.1.2:

Edit `desktop/package.json`:

```json
  "version": "0.1.2",
```

- [ ] **Step 3: Commit smoke-test sign-off (no file change needed beyond version bump)**

```bash
git add desktop/package.json
git commit -m "desktop: bump to v0.1.2 (subtitles)"
```

(If shipping later, skip the bump; the smoke-test sign-off is just notes in the PR / handoff.)

---

## Self-review (filled in after writing the plan above)

**Spec coverage check:**
- ✅ Subtitle window architecture → Task 1
- ✅ Renderer sliding-window rendering → Task 2
- ✅ Show/Clear IPC → Task 3
- ✅ Position lock + drag sync + edge handling → Task 4
- ✅ Settings persistence to `userData/settings.json` → Task 5
- ✅ Enable/disable get/set/broadcast → Task 6
- ✅ Tray menu checkbox → Task 7
- ✅ `daisy_text` wire + 4s linger + interrupt clearing → Task 8
- ✅ Main-window settings UI toggle + EN/ES copy + cross-window sync → Task 9
- ✅ Manual smoke checklist → Task 10
- ✅ Error handling (missing settings, corrupt settings, multi-monitor, bottom-edge flip, mid-turn disable) all addressed in their respective tasks.

**Placeholder scan:** No "TBD", "TODO", or hand-waving. Every code-bearing step shows the actual code. Task 4 Step 3 explicitly says "leave the handler unchanged" (which is intentional and explained — the `on('move')` listener already covers it).

**Type-consistency check:**
- `daisyAPI.subtitleShow(text)` / `subtitleClear()` / `subtitleEnabledGet()` / `subtitleEnabledSet(enabled)` / `onShowSubtitle(cb)` / `onClearSubtitle(cb)` / `onSubtitleEnabledChanged(cb)` — same names in `main.ts` IPC channels, `preload.ts` bindings, `types.ts` declarations, and renderer call sites.
- IPC channels: `daisy:subtitle-show`, `daisy:subtitle-clear`, `daisy:show-subtitle` (forward), `daisy:clear-subtitle` (forward), `daisy:subtitle-enabled-get`, `daisy:subtitle-enabled-set`, `daisy:subtitle-enabled-changed` — used identically in all three layers.
- `AppSettings.subtitles_enabled` (snake_case) consistent across `DEFAULT_SETTINGS`, `loadSettings`, `saveSettings`, and the JSON on disk.
- `subtitlesEnabled` (camelCase) consistent in React state, refs, hook return, prop names.
