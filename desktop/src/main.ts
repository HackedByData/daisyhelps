import { app, BrowserWindow, desktopCapturer, ipcMain, Menu, screen, session, Tray } from 'electron';
import path from 'node:path';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quittingForReal = false;

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
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.on('close', (e) => {
    if (!quittingForReal) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

function createTray(): void {
  tray = new Tray(path.join(__dirname, '..', 'src', 'assets', 'tray-icon.png'));
  tray.setToolTip('Daisy Helps');
  const menu = Menu.buildFromTemplate([
    { label: 'Show Daisy', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { label: 'Hide Daisy', click: () => mainWindow?.hide() },
    { type: 'separator' },
    { label: 'Quit', click: () => { quittingForReal = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => {
    if (mainWindow?.isVisible()) mainWindow.hide();
    else { mainWindow?.show(); mainWindow?.focus(); }
  });
}

app.whenReady().then(() => {
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

  createTray();
  createWindow();
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
