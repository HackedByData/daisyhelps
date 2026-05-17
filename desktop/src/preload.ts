import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('daisyAPI', {
  captureScreen: () => ipcRenderer.invoke('daisy:captureScreen') as Promise<{ pngBase64: string } | { error: string }>,
  onUpdateReady: (cb: (info: { version: string }) => void) => {
    ipcRenderer.on('daisy:update-ready', (_e, info) => cb(info));
  },
  quitAndInstall: () => ipcRenderer.send('daisy:quit-and-install'),
});
