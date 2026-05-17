# Overlay Subtitles — Design

**Status:** Design approved, ready for implementation plan
**Author:** Devin (with Claude Code)
**Date:** 2026-05-17

## Problem

Users hard of hearing can't follow Daisy's spoken guidance when she's in the corner overlay (main window hidden). The main conversation screen already shows on-screen text, but the overlay surface — which is the steady-state UX for an in-progress task — has no visible captions.

## Goal

A pill-shaped subtitle banner that appears below the corner Daisy icon, displays one line of her speech at a time as she talks, and disappears shortly after she stops. Toggleable on/off; default on.

## Non-goals

- Subtitles on the main conversation screen (already has in-page captions).
- Persistent transcript / scrollback. The pill is ephemeral by design.
- User text (what the user said) — only Daisy's speech.
- Localization beyond what's already in `daisy_text` from the backend (EN/ES handled upstream).

## UX decisions (locked)

| Decision | Choice |
|---|---|
| Visibility default | On. User can toggle off. |
| Streaming mode | Word-by-word from `daisy_text` partials. |
| Long-line behavior | Sliding window (ticker): single line, old words scroll off the left edge as new ones arrive on the right. |
| Lifetime after speech ends | Linger 4 seconds, then hide. |
| Toggle location | Both system tray menu and main-window settings, shared state. |
| Scope | Overlay only. |

## Architecture

A new dedicated BrowserWindow — `subtitleWindow` — joins the existing trio (`mainWindow`, `overlayWindow`, `indicatorWindow`). Approach B from brainstorming: rejected expanding the overlay itself (would unwind the Aero-Snap hardening that locks it at 72×72) and rejected reusing the indicator window (couples unrelated features, indicator is locked to the primary display).

```
┌─────────────────┐
│ overlayWindow   │   72×72   alwaysOnTop, clickable (drag/click)
│   (daisy icon)  │
└─────────────────┘
        │
        │ position-locked (8px below, centered on overlay X)
        ▼
┌──────────────────────────────────────┐
│ subtitleWindow                       │  320×44  alwaysOnTop, click-through
│  ●●●● ...older  newest word here     │
└──────────────────────────────────────┘
```

**Window properties:**
- `width: 320, height: 44` (fixed — overflow handled inside the renderer, not via resize)
- `frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true`
- `focusable: false, resizable: false, minimizable: false, maximizable: false`
- `setIgnoreMouseEvents(true)` — click-through (subtitles never intercept clicks)
- `show: false` initially; `showInactive()` when subtitles enabled + Daisy is speaking
- Stays alive for app lifetime; toggling visibility is `show()` / `hide()`

**Why fixed size:** Dynamic resize on every streamed word causes flicker and risks re-triggering the Windows Aero-Snap behavior that the overlay window is hardened against. Internal CSS overflow + JS-driven text translation is cheaper and visually stable.

## Files touched

**New files:**
- `desktop/src/renderer/subtitle.html` — pill markup
- `desktop/src/renderer/subtitle.css` — pill styling
- `desktop/src/renderer/subtitle.ts` — sliding-window text logic, IPC subscriber

**Modified files:**
- `desktop/src/main.ts` — `createSubtitle()`, IPC handlers, settings persistence, tray menu item, drag-sync hook inside `overlay-drag-move`
- `desktop/src/preload.ts` — expose subtitle methods on `daisyAPI`
- `desktop/src/renderer/types.ts` — extend `DaisyAPI` interface
- `desktop/src/renderer/main.jsx` — forward `daisy_text` to subtitle window, render settings toggle

## Components

### Main process (`main.ts`)

**`createSubtitle()`** — Mirrors `createOverlay()` / `createIndicator()`. Loads `renderer/subtitle.html`. Calls `setIgnoreMouseEvents(true)` (no `forward: true` — we don't need hit-testing).

**Position synchronization.** A helper `repositionSubtitle()` reads `overlayWindow.getBounds()` and computes the subtitle position:

```ts
function repositionSubtitle(): void {
  if (!overlayWindow || !subtitleWindow) return;
  const o = overlayWindow.getBounds();
  const display = screen.getDisplayNearestPoint({ x: o.x, y: o.y });
  const sw = 320, sh = 44;
  const GAP = 8;

  // Centered horizontally on the overlay, 8px below.
  let x = Math.round(o.x + o.width / 2 - sw / 2);
  let y = o.y + o.height + GAP;

  // Edge clamps within the overlay's current display.
  const { x: dx, y: dy, width: dw, height: dh } = display.workArea;
  if (x < dx) x = dx;
  if (x + sw > dx + dw) x = dx + dw - sw;
  if (y + sh > dy + dh) y = o.y - sh - GAP; // flip above if no room below

  subtitleWindow.setBounds({ x, y, width: sw, height: sh });
}
```

Called from:
- After `createSubtitle()` returns (initial placement)
- Inside the existing `daisy:overlay-drag-move` IPC handler (after `overlayWindow.setPosition`)
- On `overlayWindow.on('move', ...)` (covers any other movement paths)

**IPC handlers (new):**

| Channel | Direction | Purpose |
|---|---|---|
| `daisy:subtitle-show` | renderer → main | Forward latest accumulated text to the subtitle renderer. |
| `daisy:subtitle-clear` | renderer → main | Tell the subtitle renderer to fade out. |
| `daisy:subtitle-enabled-get` | renderer → main (invoke) | Read current setting from `userData/settings.json`. Returns boolean. |
| `daisy:subtitle-enabled-set` | renderer → main | Write to `userData/settings.json`, broadcast `daisy:subtitle-enabled-changed` to all renderers. |
| `daisy:subtitle-enabled-changed` | main → all renderers | Settings broadcast for cross-window sync. |
| `daisy:show-subtitle` | main → subtitle renderer | Forward of `subtitle-show`. |
| `daisy:clear-subtitle` | main → subtitle renderer | Forward of `subtitle-clear`. |

**Window visibility policy.** `daisy:subtitle-show` shows the window (if enabled) and forwards text. `daisy:subtitle-clear` hides the window. When the setting flips off, main process hides the window immediately. When the setting flips on, the window remains hidden until the next `subtitle-show`.

**Tray menu.** Add a checkable item to the existing tray context menu:

```ts
{ label: 'Subtitles', type: 'checkbox', checked: subtitlesEnabled,
  click: (item) => setSubtitlesEnabled(item.checked) }
```

The tray menu is rebuilt when state changes (or the menu item's `checked` is mutated directly).

### Settings persistence

A small JSON file at `path.join(app.getPath('userData'), 'settings.json')`. No new dependency.

```ts
interface Settings { subtitles_enabled: boolean; }
const DEFAULT_SETTINGS: Settings = { subtitles_enabled: true };
```

- Read once at startup with a try/catch — missing or corrupt file → defaults, log warning, overwrite on next change.
- Write synchronously on toggle change (settings are tiny; async unnecessary).

### Subtitle renderer (`subtitle.ts`)

State: `currentText: string` and a DOM `<span>` element inside a clipping `<div>`.

```html
<div id="pill" hidden>
  <div class="pill__clip">
    <span class="pill__text"></span>
  </div>
</div>
```

On `daisy:show-subtitle` (text):
1. `pill.hidden = false`
2. `text.textContent = newText`
3. Measure `text.scrollWidth`. If `> clip.clientWidth`, set `text.style.transform = translateX(-(scrollWidth - clipWidth)px)` to right-align. Otherwise, `transform = none`.

On `daisy:clear-subtitle`:
- Fade out via CSS (`opacity: 0` transition), then `pill.hidden = true` after the transition.

**Why JS measurement over a pure-CSS solution:** `direction: rtl` flips word order; `float: right` doesn't work with `white-space: nowrap` overflow; flex `justify-content: flex-end` with overflow clips on the wrong side. A `translateX` based on `scrollWidth - clientWidth` is the cleanest reliable approach and runs ≤16ms per partial.

### Subtitle styling (`subtitle.css`)

```css
html, body { margin: 0; padding: 0; background: transparent;
             width: 320px; height: 44px; overflow: hidden; }

#pill {
  width: 320px; height: 44px;
  border-radius: 22px;
  background: rgba(20, 20, 24, 0.82);
  color: #fff;
  font: 16px/1 -apple-system, "Segoe UI", system-ui, sans-serif;
  display: flex; align-items: center;
  padding: 0 18px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.18);
  opacity: 0; transition: opacity 240ms ease;
}
#pill:not([hidden]) { opacity: 1; }

.pill__clip { flex: 1 1 auto; overflow: hidden; height: 22px; }
.pill__text { white-space: nowrap; display: inline-block;
              transition: transform 120ms linear; }

@media (prefers-reduced-motion: reduce) {
  #pill, .pill__text { transition: none !important; }
}
```

### Main renderer wire (`main.jsx`)

Inside `useDaisyBackend`, the existing `daisy_text` case:

```js
case 'daisy_text':
  if (msg.partial) {
    partialRef.current += msg.text;
    setDaisyText(partialRef.current);
    setDaisyStreaming(true);
    if (subtitlesEnabledRef.current) {
      window.daisyAPI.subtitleShow(partialRef.current);
    }
  } else {
    setDaisyText(msg.text);
    partialRef.current = '';
    setDaisyStreaming(false);
    if (subtitlesEnabledRef.current) {
      window.daisyAPI.subtitleShow(msg.text);
    }
  }
  break;
```

A 4-second linger timer on `audio_end` (or on transition out of `speaking`):

```js
case 'audio_end':
  // existing handling …
  if (subtitleLingerRef.current) clearTimeout(subtitleLingerRef.current);
  subtitleLingerRef.current = setTimeout(() => {
    window.daisyAPI.subtitleClear();
    subtitleLingerRef.current = null;
  }, 4000);
  break;
```

The timer is cancelled on the next `daisy_text` partial (next turn begins) or on `interrupt` / hard-reset paths.

The settings toggle UI is a single checkbox/switch on the main conversation screen. It reads initial state via `subtitleEnabledGet()` and writes via `subtitleEnabledSet(enabled)`; the tray menu writes through the same path. Both surfaces listen to `onSubtitleEnabledChanged` for cross-window sync.

## Data flow

```
Backend WS  ──daisy_text──▶  main.jsx (useDaisyBackend)
                                  │
                                  │ if subtitlesEnabled:
                                  ▼
                          daisyAPI.subtitleShow(text)
                                  │ (IPC)
                                  ▼
                          main.ts: daisy:subtitle-show
                                  │
                                  ▼
                          subtitleWindow.showInactive() + send
                                  │
                                  ▼
                          subtitle.ts: render + slide

  audio_end ──▶  4s timer ──▶ subtitleClear ──▶ main ──▶ subtitle.ts: fade out
```

Tray click and main-window toggle both write to `subtitle-enabled-set`. Main process broadcasts `subtitle-enabled-changed` to all renderers; both UIs reconcile their checkbox state.

## Error handling

| Failure | Behavior |
|---|---|
| `settings.json` missing | Default to enabled=true. No error surfaced. |
| `settings.json` corrupt | Log warning to main-process console; default to enabled=true; overwrite next change. |
| Subtitle window not ready when `daisy_text` arrives | Main process no-ops the send (`if (!subtitleWindow) return`). |
| Multi-monitor: overlay dragged to second display | `screen.getDisplayNearestPoint(overlay.x, overlay.y)` selects the right display; clamps and below/above flip are computed against that display's `workArea`. |
| Overlay near bottom edge | `repositionSubtitle()` flips the pill above the overlay when no room below. |
| User disables subtitles mid-turn | Main process hides the subtitle window immediately. The main renderer's `daisy_text` handler gates on `subtitlesEnabledRef.current`, so no further forwards happen for this turn. Re-enabling mid-turn does *not* retroactively show the in-progress text — the pill returns on the next turn. (Acceptable: toggling subtitles is a rare action; the simpler invariant — "renderer-side gate" — beats a re-show feature.) |

## Testing

The desktop app has no automated tests today; this feature follows the existing manual-smoke pattern.

**Manual checklist (before merging the v0.1.2 tag):**

1. Launch app cold → setting defaults on → first turn shows pill below daisy.
2. Toggle off via tray → pill disappears immediately if visible, no pill on next turn.
3. Toggle on via main-window settings → tray menu's check reflects the change (and vice versa).
4. Long Daisy reply → ticker slides left as new words stream; final words always visible on right.
5. Short reply → pill lingers ~4s after audio_end, then fades.
6. New turn within the 4s linger → pill reset immediately, no double-show.
7. Drag overlay across the screen → pill follows in lockstep.
8. Drag overlay to bottom edge → pill flips above.
9. Drag overlay to second monitor → pill follows to that monitor, clamps within its bounds.
10. Quit + relaunch → setting persists.
11. Click "through" the pill → click reaches the app underneath (never the pill).

## Open considerations (not blocking)

- **Font sizing for older users.** 16px is a starting point. May want to bump to 18px after stranger-test feedback.
- **Persisted text history.** Out of scope for this design, but a future "show last 5 lines" mode could reuse the same window with `height` increased.
- **Per-language font tweaks.** ES uses the same Latin alphabet, so probably moot.

## Files at a glance

| File | Change |
|---|---|
| `desktop/src/main.ts` | +createSubtitle, +6 IPC handlers, +settings persistence, +tray menu item, +reposition hook |
| `desktop/src/preload.ts` | +6 daisyAPI methods |
| `desktop/src/renderer/types.ts` | +6 entries on DaisyAPI |
| `desktop/src/renderer/main.jsx` | +subtitleShow/Clear wire, +linger timer, +settings toggle UI, +cross-window sync |
| `desktop/src/renderer/subtitle.html` | new (~10 lines) |
| `desktop/src/renderer/subtitle.css` | new (~25 lines) |
| `desktop/src/renderer/subtitle.ts` | new (~40 lines) |
