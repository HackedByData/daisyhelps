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
  // Measure on the next animation frame so layout has settled. Without rAF,
  // scrollWidth on the just-mutated span occasionally lags by one frame.
  requestAnimationFrame(() => {
    const overflow = text.scrollWidth - clip.clientWidth;
    text.style.transform = overflow > 0 ? `translateX(-${overflow}px)` : 'none';
  });
}

function fadeOut(): void {
  // Set opacity via the [hidden] toggle (pill has `opacity: 0` while hidden,
  // `opacity: 1` otherwise — see subtitle.css). The 240ms transition runs;
  // we wait for it before clearing the text so the fade is uninterrupted.
  pill.hidden = true;
  if (hideTimer !== null) window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    text.textContent = '';
    text.style.transform = 'none';
    hideTimer = null;
  }, 260);
}

window.daisyAPI?.onShowSubtitle?.((newText: string) => render(newText));
window.daisyAPI?.onClearSubtitle?.(() => fadeOut());
