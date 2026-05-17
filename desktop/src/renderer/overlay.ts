// Overlay renderer — receives state from main via IPC and animates the mark.
import type { Status } from './types.js';

const mark = document.getElementById('daisy-mark') as HTMLElement;

window.daisyAPI?.onOverlayState?.((state: string) => {
  mark.dataset.state = state as Status;
});
