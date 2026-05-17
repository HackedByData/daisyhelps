import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('daisyAPI', {
  // Filled in by later tasks.
});
