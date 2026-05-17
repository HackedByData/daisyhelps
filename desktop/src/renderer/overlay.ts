// Overlay renderer — receives state from main via IPC, animates the mark,
// forwards user clicks back to the main renderer, and supports custom drag
// (mouseup with no movement → click; with movement → drag the window).
import type { Status } from './types.js';

const mark = document.getElementById('daisy-mark') as HTMLElement;

window.daisyAPI?.onOverlayState?.((state: string) => {
  mark.dataset.state = state as Status;
});

const DRAG_THRESHOLD = 4; // pixels (Manhattan distance)
let dragOrigin: { x: number; y: number } | null = null;
let dragMoved = false;

mark.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  dragOrigin = { x: e.screenX, y: e.screenY };
  dragMoved = false;
  // Pause the breathe/listening/etc. animations while the user is holding,
  // otherwise the daisy appears to grow/shrink mid-drag.
  mark.classList.add('dragging');
  window.daisyAPI?.overlayDragStart?.();
  e.preventDefault();
});

window.addEventListener('mousemove', (e) => {
  if (!dragOrigin) return;
  const dx = e.screenX - dragOrigin.x;
  const dy = e.screenY - dragOrigin.y;
  if (!dragMoved && Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) dragMoved = true;
  if (dragMoved) window.daisyAPI?.overlayDragMove?.(dx, dy);
});

window.addEventListener('mouseup', () => {
  if (!dragOrigin) return;
  if (!dragMoved) window.daisyAPI?.overlayClick?.();
  window.daisyAPI?.overlayDragEnd?.();
  dragOrigin = null;
  dragMoved = false;
  mark.classList.remove('dragging');
});

// Close button — hides the overlay window. stopPropagation on mousedown
// ensures the click can't be misread as a tap on the daisy.
const closeBtn = document.getElementById('close-x');
closeBtn?.addEventListener('mousedown', (e) => { e.stopPropagation(); });
closeBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  window.daisyAPI?.overlayHide?.();
});
