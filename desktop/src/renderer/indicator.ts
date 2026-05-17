// Indicator renderer — receives a (physical-pixel) target point and optional
// label from main, positions the daisy pointer there, and shows it.
//
// Mouse handling: the host BrowserWindow defaults to setIgnoreMouseEvents(
// true, { forward: true }) so the entire screen is click-through but the
// renderer still sees mousemove events. We watch the cursor; when it enters
// the pointer's hit radius we ask main to disable passthrough (so the daisy
// is clickable), and when it leaves we re-enable it. Clicking the daisy
// dismisses the indicator.

const pointer = document.getElementById('pointer') as HTMLElement;
const labelEl = document.getElementById('label') as HTMLElement;

// Track current pointer center (CSS pixels) so we can hit-test on mousemove.
let centerX = -1;
let centerY = -1;
let visible = false;
let cursorOverDaisy = false;
const HIT_RADIUS = 56; // pixels — roughly the daisy's visual halo

function setPassthrough(passthrough: boolean): void {
  if (cursorOverDaisy === !passthrough) return; // no-op if state unchanged
  cursorOverDaisy = !passthrough;
  window.daisyAPI?.indicatorSetPassthrough?.(passthrough);
}

window.daisyAPI?.onShowIndicator?.(({ x, y, label }) => {
  centerX = x;
  centerY = y;
  visible = true;
  pointer.style.left = `${x}px`;
  pointer.style.top  = `${y}px`;
  pointer.classList.add('is-visible');
  if (label && label.trim()) {
    labelEl.textContent = label;
    labelEl.classList.add('is-visible');
  } else {
    labelEl.textContent = '';
    labelEl.classList.remove('is-visible');
  }
  // Reset passthrough state — main will already be set to (true, forward) on
  // show-indicator. We assume cursor is not over the daisy until proven so.
  cursorOverDaisy = false;
});

window.addEventListener('mousemove', (e) => {
  if (!visible) return;
  const dx = e.clientX - centerX;
  const dy = e.clientY - centerY;
  const overDaisy = (dx * dx + dy * dy) <= HIT_RADIUS * HIT_RADIUS;
  setPassthrough(!overDaisy);
});

pointer.addEventListener('click', () => {
  visible = false;
  pointer.classList.remove('is-visible');
  labelEl.classList.remove('is-visible');
  window.daisyAPI?.clearIndicator?.();
});
