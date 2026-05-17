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
  pill.classList.remove('pill--fading');
  // Measure on the next animation frame so layout has settled. Without rAF,
  // scrollWidth on the just-mutated span occasionally lags by one frame.
  requestAnimationFrame(() => {
    const overflow = text.scrollWidth - clip.clientWidth;
    text.style.transform = overflow > 0 ? `translateX(-${overflow}px)` : 'none';
  });
}

function fadeOut(): void {
  // Trigger the CSS opacity transition via a class (not via [hidden], because
  // the UA stylesheet maps [hidden] to display: none, which would remove the
  // element from the render tree before the 240ms opacity transition could run).
  pill.classList.add('pill--fading');
  if (hideTimer !== null) window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    pill.hidden = true;
    pill.classList.remove('pill--fading');
    pill.classList.remove('pill--error');
    text.textContent = '';
    text.style.transform = 'none';
    hideTimer = null;
  }, 260);
}

window.daisyAPI?.onShowSubtitle?.((newText: string) => render(newText));
window.daisyAPI?.onClearSubtitle?.(() => fadeOut());

// Close button — turn subtitles off for the session. The host window defaults
// to setIgnoreMouseEvents(true, { forward: true }) so all clicks pass through;
// we toggle passthrough off only while the cursor is over the X so the button
// is clickable without blocking clicks elsewhere on the pill.
const closeBtn = document.getElementById('close-x') as HTMLButtonElement | null;
let cursorOverX = false;
function setSubtitlePassthrough(passthrough: boolean): void {
  if (cursorOverX === !passthrough) return;
  cursorOverX = !passthrough;
  window.daisyAPI?.subtitleSetPassthrough?.(passthrough);
}

window.addEventListener('mousemove', (e) => {
  if (!closeBtn || pill.hidden) { setSubtitlePassthrough(true); return; }
  const r = closeBtn.getBoundingClientRect();
  const inside = e.clientX >= r.left && e.clientX <= r.right
              && e.clientY >= r.top  && e.clientY <= r.bottom;
  setSubtitlePassthrough(!inside);
});

closeBtn?.addEventListener('click', () => {
  window.daisyAPI?.subtitleEnabledSet?.(false);
  // Optimistically fade out locally so there's no flash of pill while the
  // round-trip through main + the broadcast back finishes.
  fadeOut();
  setSubtitlePassthrough(true);
});

// Error variant — same pill, red tint, auto-clears after 5 seconds.
// Replaces any current subtitle content (Daisy speech) for the duration.
let errorAutoClearTimer: number | null = null;
window.daisyAPI?.onShowSubtitleError?.((errText: string) => {
  if (errorAutoClearTimer !== null) {
    window.clearTimeout(errorAutoClearTimer);
    errorAutoClearTimer = null;
  }
  pill.classList.add('pill--error');
  render(errText);
  errorAutoClearTimer = window.setTimeout(() => {
    pill.classList.remove('pill--error');
    fadeOut();
    errorAutoClearTimer = null;
  }, 5000);
});
