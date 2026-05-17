import { app, BrowserWindow, desktopCapturer, ipcMain, Menu, net, protocol, screen, session, Tray } from 'electron';
import { autoUpdater } from 'electron-updater';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Must be called before the app ready event
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

let mainWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let indicatorWindow: BrowserWindow | null = null;
let subtitleWindow: BrowserWindow | null = null;
let indicatorClearTimer: NodeJS.Timeout | null = null;
let subtitleHideTimer: NodeJS.Timeout | null = null;
let tray: Tray | null = null;
let quittingForReal = false;

interface AppSettings {
  subtitles_enabled: boolean;
  share_screen_remembered: boolean;
}
const DEFAULT_SETTINGS: AppSettings = {
  subtitles_enabled: true,
  share_screen_remembered: false,
};
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
      share_screen_remembered: typeof parsed.share_screen_remembered === 'boolean'
        ? parsed.share_screen_remembered
        : DEFAULT_SETTINGS.share_screen_remembered,
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

function setSubtitlesEnabled(enabled: boolean): void {
  if (appSettings.subtitles_enabled === enabled) return;
  appSettings.subtitles_enabled = enabled;
  saveSettings();
  // Hide the pill immediately when disabling mid-turn; cancel any pending
  // fade-out timer so the window doesn't reappear briefly via a late hide().
  if (!enabled) {
    if (subtitleHideTimer) { clearTimeout(subtitleHideTimer); subtitleHideTimer = null; }
    subtitleWindow?.hide();
  }
  // Broadcast to all renderers so tray + settings sheet stay in sync.
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send('daisy:subtitle-enabled-changed', enabled);
  }
  // Rebuild the tray menu so its checkbox reflects the new state.
  rebuildTrayMenu();
}

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

function createOverlay(): void {
  const primary = screen.getPrimaryDisplay();
  const { width } = primary.workAreaSize;
  const SIZE   = 72;   // was 220 — reduced by 67% so the corner icon doesn't loom
  const MARGIN =  16;

  overlayWindow = new BrowserWindow({
    width: SIZE, height: SIZE,
    x: width - SIZE - MARGIN, y: MARGIN,
    useContentSize: true,
    frame: false, transparent: true,
    alwaysOnTop: true, skipTaskbar: true,
    // Prevent Aero Snap / accidental resizing during drag — the perceived
    // "growth" was the window being briefly resized by Windows snap,
    // exposing more of the 280%-scaled petal composition through overflow.
    resizable: false,
    minimizable: false, maximizable: false, fullscreenable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  // Overlay is clickable now — see daisy:overlay-click IPC.
  overlayWindow.loadFile(path.join(__dirname, 'renderer', 'overlay.html'));
  overlayWindow.on('closed', () => { overlayWindow = null; });
}

function createIndicator(): void {
  // Full-screen, click-through, transparent always-on-top window that hosts
  // the daisy pointer for click_indicator messages. Modelled on createOverlay()
  // but sized to the whole primary display and locked to ignore mouse events
  // so the user's clicks pass through to the app underneath.
  const primary = screen.getPrimaryDisplay();
  const { width, height } = primary.size;

  indicatorWindow = new BrowserWindow({
    width, height,
    x: primary.bounds.x, y: primary.bounds.y,
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
  // alwaysOnTop level: 'screen-saver' keeps it above fullscreen apps on Windows
  indicatorWindow.setAlwaysOnTop(true, 'screen-saver');
  // forward: true lets the renderer see mousemove events for hit-testing the
  // pointer (so we can toggle passthrough off when the cursor is over the
  // daisy and let the user click it). Click-through everywhere else.
  indicatorWindow.setIgnoreMouseEvents(true, { forward: true });
  indicatorWindow.loadFile(path.join(__dirname, 'renderer', 'indicator.html'));
  indicatorWindow.on('closed', () => { indicatorWindow = null; });
}

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
  // forward: true so the renderer can hit-test mousemove against the close
  // button. Renderer toggles passthrough off only while the cursor is over
  // the X; clicks anywhere else still pass through.
  subtitleWindow.setIgnoreMouseEvents(true, { forward: true });
  subtitleWindow.loadFile(path.join(__dirname, 'renderer', 'subtitle.html'));
  subtitleWindow.on('closed', () => { subtitleWindow = null; });
}

function repositionSubtitle(): void {
  if (!overlayWindow || !subtitleWindow) return;
  const o = overlayWindow.getBounds();
  const sw = 320, sh = 44;  // must match SUB_W / SUB_H in createSubtitle()
  const GAP = 8;
  // Pick the display the overlay currently sits on (handles multi-monitor
  // when the user drags the daisy from one screen to another).
  const display = screen.getDisplayNearestPoint({ x: o.x + o.width / 2, y: o.y + o.height / 2 });
  const { x: dx, y: dy, width: dw, height: dh } = display.workArea;

  // Centered horizontally on the overlay, GAP below.
  let x = Math.round(o.x + o.width / 2 - sw / 2);
  let y = Math.round(o.y + o.height + GAP);

  // Clamp within the overlay's current display.
  if (x < dx) x = dx;
  if (x + sw > dx + dw) x = dx + dw - sw;
  // If no room below, flip above.
  if (y + sh > dy + dh) y = Math.round(o.y - sh - GAP);
  // And if there's no room above either (overlay covers the whole display
  // height somehow), pin to the top of the work area.
  if (y < dy) y = dy;

  subtitleWindow.setBounds({ x, y, width: sw, height: sh });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 640,
    minHeight: 480,
    title: 'Daisy Helps',
    backgroundColor: '#fdf7ec',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.loadURL('app://localhost/index.html');
  mainWindow.on('close', (e) => {
    if (!quittingForReal) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

function createTray(): void {
  tray = new Tray(path.join(__dirname, 'tray-icon.png'));
  tray.setToolTip('Daisy Helps');
  rebuildTrayMenu();
  tray.on('click', () => {
    if (mainWindow?.isVisible()) mainWindow.hide();
    else { mainWindow?.show(); mainWindow?.focus(); }
  });
}

function setupAutoUpdate(): void {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-downloaded', (info) => {
    mainWindow?.webContents.send('daisy:update-ready', { version: info.version });
  });
  autoUpdater.on('error', (err) => {
    // Network failures are expected when offline; don't surface to users
    console.warn('[updater]', err.message);
  });

  // Initial check 30s after launch; then every 6 hours.
  setTimeout(() => { void autoUpdater.checkForUpdates(); }, 30_000);
  setInterval(() => { void autoUpdater.checkForUpdates(); }, 6 * 60 * 60 * 1000);
}

app.whenReady().then(() => {
  loadSettings();

  // Grant mic permission to the renderer once at startup
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    if (permission === 'media') return callback(true);
    callback(false);
  });

  // IPC: captureScreen
  ipcMain.handle('daisy:captureScreen', async () => {
    try {
      const displays = screen.getAllDisplays();
      const primary = screen.getPrimaryDisplay();
      const targetSize = primary.size;
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: targetSize.width, height: targetSize.height },
      });
      if (sources.length === 0) return { error: 'no screen sources available' };

      let chosen = sources[0];
      if (sources.length > 1 && displays.length > 1) {
        chosen = await pickScreen(sources);
      }
      const png = chosen.thumbnail.toPNG();
      return { pngBase64: png.toString('base64') };
    } catch (err) {
      return { error: String(err) };
    }
  });

  ipcMain.on('daisy:quit-and-install', () => {
    quittingForReal = true;
    autoUpdater.quitAndInstall();
  });

  // Renderer can request a full app quit (used by the "Goodbye, Daisy"
  // voice-exit flow). Bypasses the close-to-tray behaviour in createWindow.
  ipcMain.on('daisy:quit-app', () => {
    quittingForReal = true;
    app.quit();
  });

  // Overlay IPC
  ipcMain.on('daisy:overlay-show', () => overlayWindow?.show());
  ipcMain.on('daisy:overlay-hide', () => overlayWindow?.hide());
  ipcMain.on('daisy:overlay-state', (_e, state: string) => {
    overlayWindow?.webContents.send('daisy:overlay-state', state);
  });
  // Overlay click → forward to main renderer so it can capture screen + start mic
  ipcMain.on('daisy:overlay-click', () => {
    mainWindow?.webContents.send('daisy:overlay-click');
  });
  // Overlay drag — overlay reports screen-relative pointer deltas; we move the
  // window from the position recorded at drag-start.
  let overlayDragOrigin: { x: number; y: number } | null = null;
  ipcMain.on('daisy:overlay-drag-start', () => {
    if (!overlayWindow) return;
    const [x, y] = overlayWindow.getPosition();
    overlayDragOrigin = { x, y };
  });
  ipcMain.on('daisy:overlay-drag-move', (_e, dx: number, dy: number) => {
    if (!overlayWindow || !overlayDragOrigin) return;
    overlayWindow.setPosition(
      Math.round(overlayDragOrigin.x + dx),
      Math.round(overlayDragOrigin.y + dy),
    );
  });
  ipcMain.on('daisy:overlay-drag-end', () => { overlayDragOrigin = null; });

  // Click indicator IPC. Translates from screenshot pixel space (refW × refH)
  // to physical primary-display pixels, then asks the indicator renderer to
  // place the daisy pointer there. Auto-clears after 8s so a missed
  // clear_indicator from the backend doesn't leave a stale pointer on screen.
  ipcMain.on('daisy:show-indicator', (_e, args: { x: number; y: number; refW: number; refH: number; label?: string }) => {
    if (!indicatorWindow) return;
    const primary = screen.getPrimaryDisplay();
    const { width: sw, height: sh } = primary.size;
    const physX = Math.round(args.x * (sw / args.refW));
    const physY = Math.round(args.y * (sh / args.refH));
    indicatorWindow.webContents.send('daisy:show-indicator', { x: physX, y: physY, label: args.label });
    indicatorWindow.showInactive();
    if (indicatorClearTimer) clearTimeout(indicatorClearTimer);
    indicatorClearTimer = setTimeout(() => indicatorWindow?.hide(), 8000);
  });
  ipcMain.on('daisy:clear-indicator', () => {
    if (indicatorClearTimer) { clearTimeout(indicatorClearTimer); indicatorClearTimer = null; }
    indicatorWindow?.hide();
    // Restore click-through-with-forwarding for the next time the window is shown
    indicatorWindow?.setIgnoreMouseEvents(true, { forward: true });
  });
  // Renderer asks main to (un)cover the screen for clicks. While the cursor is
  // over the daisy pointer the window captures mouse events so it can be
  // clicked; otherwise clicks pass through to whatever app is underneath.
  ipcMain.on('daisy:indicator-set-passthrough', (_e, passthrough: boolean) => {
    if (!indicatorWindow) return;
    if (passthrough) indicatorWindow.setIgnoreMouseEvents(true, { forward: true });
    else             indicatorWindow.setIgnoreMouseEvents(false);
  });

  // Subtitle IPC (main renderer → main → subtitle renderer).
  ipcMain.on('daisy:subtitle-show', (_e, text: string) => {
    if (!subtitleWindow) return;
    if (!appSettings.subtitles_enabled) return;  // gate: honor the user's toggle
    // Cancel any pending hide from a prior clear — a fast new turn within
    // the 280ms fade window must not get hidden mid-stream.
    if (subtitleHideTimer) { clearTimeout(subtitleHideTimer); subtitleHideTimer = null; }
    if (!subtitleWindow.isVisible()) subtitleWindow.showInactive();
    subtitleWindow.webContents.send('daisy:subtitle-show', text);
  });
  ipcMain.on('daisy:subtitle-clear', () => {
    if (!subtitleWindow) return;
    subtitleWindow.webContents.send('daisy:subtitle-clear');
    if (subtitleHideTimer) clearTimeout(subtitleHideTimer);
    subtitleHideTimer = setTimeout(() => {
      subtitleWindow?.hide();
      subtitleHideTimer = null;
    }, 280);
  });

  // Subtitle enable/disable state + cross-window broadcast.
  ipcMain.handle('daisy:subtitle-enabled-get', () => appSettings.subtitles_enabled);
  ipcMain.on('daisy:subtitle-enabled-set', (_e, enabled: boolean) => {
    setSubtitlesEnabled(!!enabled);
  });

  ipcMain.handle('daisy:share-screen-remembered-get', () => appSettings.share_screen_remembered);
  ipcMain.on('daisy:share-screen-remembered-set', (_e, enabled: boolean) => {
    setShareScreenRemembered(!!enabled);
  });

  // Subtitle passthrough toggle. Renderer flips it off while the cursor is
  // over the close-X so the button is clickable; clicks anywhere else on
  // the pill pass through to whatever's underneath.
  ipcMain.on('daisy:subtitle-set-passthrough', (_e, passthrough: boolean) => {
    if (!subtitleWindow) return;
    if (passthrough) subtitleWindow.setIgnoreMouseEvents(true, { forward: true });
    else             subtitleWindow.setIgnoreMouseEvents(false);
  });

  // Serve renderer files via app:// so Babel's XHR (used for src="*.jsx") works
  // under the sandboxed renderer — file:// blocks XHR in sandboxed contexts.
  protocol.handle('app', (request) => {
    const urlPath = new URL(request.url).pathname;
    const filePath = path.join(__dirname, 'renderer', urlPath);
    return net.fetch(pathToFileURL(filePath).href);
  });

  createTray();
  createWindow();
  createOverlay();
  createIndicator();
  createSubtitle();
  repositionSubtitle();
  // Keep the subtitle stuck to the overlay whenever the overlay moves by any
  // means (drag, programmatic, future setPosition calls). The if-guard makes
  // a future refactor that conditionally skips createOverlay() a TypeScript
  // error rather than a silent no-op listener registration.
  if (overlayWindow) overlayWindow.on('move', () => repositionSubtitle());
  setupAutoUpdate();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => { quittingForReal = true; });

// --- Multi-monitor picker ---

async function pickScreen(
  sources: Electron.DesktopCapturerSource[],
): Promise<Electron.DesktopCapturerSource> {
  return new Promise((resolve) => {
    const picker = new BrowserWindow({
      width: 720,
      height: 480,
      modal: true,
      parent: mainWindow ?? undefined,
      title: 'Choose a screen',
      backgroundColor: '#fdf7ec',
      // Picker uses require('electron') inline; needs nodeIntegration on.
      // The main renderer that talks to the network stays sandboxed.
      webPreferences: { contextIsolation: false, nodeIntegration: true },
    });
    picker.loadFile(path.join(__dirname, 'screen-picker.html'));
    picker.webContents.once('did-finish-load', () => {
      const payload = sources.map((s, i) => ({
        index: i,
        name: s.name,
        thumbnail: s.thumbnail.toDataURL(),
      }));
      picker.webContents.send('picker:sources', payload);
    });
    ipcMain.handleOnce('picker:choose', (_e, index: number) => {
      picker.close();
      resolve(sources[index]);
      return null;
    });
    picker.on('closed', () => {
      // Clean up the handleOnce in case the user closed without choosing
      ipcMain.removeHandler('picker:choose');
      // Fallback: if user closes without choosing, resolve to first source.
      // (If picker:choose already fired, the promise is already settled — this no-ops.)
      resolve(sources[0]);
    });
  });
}
