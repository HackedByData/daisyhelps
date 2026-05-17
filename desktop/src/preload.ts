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

  // Overlay click (overlay renderer → main → main renderer)
  overlayClick:   () => ipcRenderer.send('daisy:overlay-click'),
  onOverlayClick: (cb: () => void) => {
    ipcRenderer.on('daisy:overlay-click', () => cb());
  },

  // Overlay drag (overlay renderer → main process moves the window)
  overlayDragStart: () => ipcRenderer.send('daisy:overlay-drag-start'),
  overlayDragMove:  (dx: number, dy: number) => ipcRenderer.send('daisy:overlay-drag-move', dx, dy),
  overlayDragEnd:   () => ipcRenderer.send('daisy:overlay-drag-end'),

  // Click indicator (main renderer → main → indicator renderer)
  showIndicator: (args: { x: number; y: number; refW: number; refH: number; label?: string }) =>
    ipcRenderer.send('daisy:show-indicator', args),
  clearIndicator: () => ipcRenderer.send('daisy:clear-indicator'),
  onShowIndicator: (cb: (args: { x: number; y: number; label?: string }) => void) => {
    ipcRenderer.on('daisy:show-indicator', (_e, args) => cb(args));
  },
  indicatorSetPassthrough: (passthrough: boolean) =>
    ipcRenderer.send('daisy:indicator-set-passthrough', passthrough),
});
