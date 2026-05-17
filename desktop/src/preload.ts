import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('daisyAPI', {
  // Screen capture
  captureScreen: () => ipcRenderer.invoke('daisy:captureScreen') as Promise<{ pngBase64: string } | { error: string }>,

  // Auto-update
  onUpdateReady: (cb: (info: { version: string }) => void) => {
    ipcRenderer.on('daisy:update-ready', (_e, info) => cb(info));
  },
  quitAndInstall: () => ipcRenderer.send('daisy:quit-and-install'),

  // Overlay control (called from main renderer)
  overlayShow:  () => ipcRenderer.send('daisy:overlay-show'),
  overlayHide:  () => ipcRenderer.send('daisy:overlay-hide'),
  overlayState: (state: string) => ipcRenderer.send('daisy:overlay-state', state),

  // Overlay receives state (called from overlay renderer)
  onOverlayState: (cb: (state: string) => void) => {
    ipcRenderer.on('daisy:overlay-state', (_e, state) => cb(state));
  },
});
