# Screen-guide flow: auto-minimize + persistent screen sharing

**Status:** Approved, awaiting implementation plan
**Date:** 2026-05-17
**Scope:** `desktop/` only — no backend or wire-protocol changes

## Problem

The big Daisy window is in the way of the very thing Daisy is trying to help with — the user's actual screen. Today there is no in-app affordance to get Daisy out of the way; users have to discover the system tray menu to hide the window. The corner-overlay daisy already exists and already supports screenshot + listen on click, but it is presented as a secondary surface rather than the primary one. The "Daisy watches your screen and guides you through tasks" experience — which is the main use case — is therefore hidden behind tribal knowledge.

## Goal

Make the corner-daisy + screen-share mode the **default working state** once Daisy has reason to look at the screen, and explain the spatial change to the user the first time it happens. After that first time, remove all repeated friction (consent re-prompts, modals) so subsequent screen peeks happen invisibly while the user focuses on their task.

## Non-goals

- **Pointer overlay completion.** `createIndicator()` + `daisy:show-indicator` IPC are already wired; the indicator renderer is a separate work item (see `docs/POINTER-OVERLAY-PROMPT.md`). It composes naturally with this design — the corner-daisy mode is exactly when the pointer overlay is most useful — but is delivered separately.
- **Conversation history surface while minimized.** `mainWindow` is `.hide()`d (not destroyed), so React state persists. Bringing the window back via tray shows the full thread intact. No separate viewer.
- **Per-display corner-daisy placement.** Corner stays on the primary display. Following the user's active display is a v2 nice-to-have.
- **Voice command to bring the big window back.** Tray-only return path was chosen explicitly; a "Daisy, show yourself" voice gesture is a separate feature.
- **Backend / wire-protocol changes.** Everything in this design lives in `desktop/`.
- **End-session / goodbye flow.** `endSession` already calls `overlayHide()` and switches to the goodbye screen, which forces the main window back. Unchanged.

## Design

### Persistence

A new boolean lives in `settings.json` (under `app.getPath('userData')`), alongside the existing `subtitles_enabled`:

```ts
interface AppSettings {
  subtitles_enabled: boolean;        // existing
  share_screen_remembered: boolean;  // new — defaults to false
}
```

This flag is the single source of truth for "user has bought into the corner-daisy / screen-sharing model." Everything else derives from it. `loadSettings()` gets a third branch with the same `typeof === 'boolean'` guard pattern; `saveSettings()` is unchanged.

### Flow

Two distinct first-screenshot paths, treated differently:

**Path 1 — proactive (the recommended primary path).** Backend sends `screenshot_request` → existing `ScreenshotConsent` modal → user clicks **Yes**:

1. Consent modal closes; `captureScreen` runs.
2. Screenshot is sent on the WebSocket *immediately*, so Daisy starts thinking. This overlaps the next modal's read-time so the user does not feel a stall.
3. If `share_screen_remembered === false`: open **HandoffModal** over the big window. (If already `true`: skip the modal entirely — the user has already gone through this ceremony before.)
4. User clicks **OK** ("Got it") → IPC `daisy:hide-main-window` → big window hides → write `share_screen_remembered = true` → broadcast to tray.
5. Corner daisy plays a one-time gentle attention pulse.

**Path 2 — overlay click (power-user gesture).** User clicks corner daisy directly (current code does `sendScreenshot()` + `startTalking()`):

- Path 2 does **NOT** trigger the hand-off modal or the big-window minimize, even on first use. Rationale: clicking the corner daisy means the user has already discovered the corner paradigm; popping a modal mid-utterance would interrupt the very thing they just initiated. The hand-off ceremony is reserved for the proactive path where the user has not necessarily seen the corner yet.
- If the user later goes through Path 1, the hand-off fires as usual.

**Subsequent screenshots when `share_screen_remembered === true`:** silent. No consent modal, no hand-off. `screenshot_request` is auto-answered with a screenshot in the renderer.

**Revocation** (tray checkbox off) flips the bit back to `false`. The next `screenshot_request` falls through to the original consent modal path, and the hand-off ceremony fires again on the next Yes. The hidden main window is NOT auto-restored when sharing is revoked — toggling sharing off is independent of window visibility.

### UI surfaces

**HandoffModal** (`main.jsx`, sibling to `MicConsent` and `ScreenshotConsent`)

Re-uses the existing `.modal-scrim` / `.modal` / `.modal__actions` styles. Single primary CTA — no decline path, because by this point the user has already said yes to the screenshot.

| | English | Spanish |
|---|---|---|
| Headline | "I'm moving to the corner." | "Me muevo a la esquina." |
| Body | "I'll watch from up here so I can see your screen and help you with what you're doing. Click me anytime, or just talk. To bring this big window back, click the little daisy near your clock (bottom-right) and choose 'Show Daisy.'" | "Te voy a acompañar desde aquí arriba para ver tu pantalla y ayudarte con lo que estás haciendo. Haz clic en mí cuando me necesites, o háblame. Para volver a abrir esta ventana grande, haz clic en la florecita junto al reloj (abajo a la derecha) y elige 'Mostrar Daisy.'" |
| Button | "Got it" | "Entendido" |

Modal includes a small inline illustration — an arrow from a representative window-rectangle to a daisy in the top-right corner — so the spatial idea is visual, not just textual. This is important for elderly users.

**Corner-daisy one-time attention pulse** (`overlay.{html,css,ts}`)

After the big window hides, main process sends `daisy:overlay-attention-pulse`. Overlay renderer adds a CSS class for ~1.2s that does a soft scale `1.0 → 1.12 → 1.0` plus a cream-colored glow. Fires once, then the class is removed. Subsequent minimizes (after toggling sharing off/on) do not re-fire — the pulse is a true onboarding cue tied to the same "first time" moment as the modal.

**Tray menu** (one new row, existing structure preserved)

```
Show Daisy            ← unchanged
Hide Daisy            ← unchanged
─────────
Subtitles          ☑  ← unchanged
Sharing my screen  ☑  ← NEW. Bidirectional. Unchecking sets the flag to false;
                       the next screenshot re-prompts. Re-checking from off to on
                       flips the flag silently — no screenshot is taken at that
                       moment — so future screenshot_requests are auto-granted again.
─────────
Quit
```

The new row uses the same checkbox pattern as Subtitles, so the implementation mirrors `setSubtitlesEnabled` / `daisy:subtitle-enabled-changed`.

### IPC

| Channel | Direction | Purpose |
|---|---|---|
| `daisy:share-screen-remembered-get` | renderer → main (handle) | Renderer reads initial value on mount, paralleling `daisy:subtitle-enabled-get` |
| `daisy:share-screen-remembered-set` | renderer / tray → main (on) | Persist + broadcast; called from HandoffModal OK and from tray checkbox |
| `daisy:share-screen-remembered-changed` | main → all renderers | Cross-window sync (settings sheet, tray-aware UI) |
| `daisy:hide-main-window` | renderer → main (on) | Called from HandoffModal OK; main runs `mainWindow?.hide()` |
| `daisy:overlay-attention-pulse` | main → overlay renderer | One-time pulse trigger, fires immediately after `hide-main-window` |

A single new helper in `main.ts` — `setShareScreenRemembered(enabled: boolean)` — does the write, broadcast, and tray-menu rebuild, exactly paralleling `setSubtitlesEnabled`. Both the IPC handler and the tray click route through it, so the source of truth is one function.

Preload surface additions (extending `window.daisyAPI`):

```ts
shareScreenRememberedGet: () => Promise<boolean>;
shareScreenRememberedSet: (enabled: boolean) => void;
onShareScreenRememberedChanged: (cb: (enabled: boolean) => void) => void;
hideMainWindow: () => void;
onOverlayAttentionPulse: (cb: () => void) => void;
```

### Renderer wiring

In `useDaisyBackend`, parallel to existing subtitle setup:

```jsx
const [shareScreenRemembered, setShareScreenRemembered] = useState(false);
const shareScreenRememberedRef = useRef(false);
useEffect(() => { shareScreenRememberedRef.current = shareScreenRemembered; }, [shareScreenRemembered]);
useEffect(() => {
  let mounted = true;
  void window.daisyAPI?.shareScreenRememberedGet?.().then((v) => {
    if (mounted) setShareScreenRemembered(!!v);
  });
  window.daisyAPI?.onShareScreenRememberedChanged?.((v) => {
    if (mounted) setShareScreenRemembered(!!v);
  });
  return () => { mounted = false; };
}, []);
```

The `useDaisyBackend` hook gains three new values in its return object:

- `shareScreenRemembered: boolean` — current flag value (mirrored to App for read access).
- `handoffNeeded: boolean` — hook-owned state. Becomes `true` when a screenshot was just sent successfully AND `share_screen_remembered` was `false` at that moment. App reads this; when `true`, App renders the `HandoffModal`.
- `dismissHandoff(): void` — App calls this from the modal's OK handler. Sets `handoffNeeded` back to `false`. (Persisting the flag + hiding the main window happens in App, not the hook — see the App-level `onHandoffConfirmed` further down.)

The Yes-path in `respondConsent` becomes:

```jsx
const respondConsent = useCallback(async (yes) => {
  setConsentReason(null);
  if (yes && window.daisyAPI?.captureScreen) {
    const result = await window.daisyAPI.captureScreen();
    if ('error' in result) {
      setErrorMsg('Could not capture your screen.');
    } else {
      send({ type: 'screenshot', data: result.pngBase64 });
      if (!shareScreenRememberedRef.current) {
        setHandoffNeeded(true);  // hook-owned state; App reads it
      }
    }
  }
}, [send]);
```

The `screenshot_request` handler gets the auto-grant branch:

```js
case 'screenshot_request':
  if (shareScreenRememberedRef.current) {
    void (async () => {
      const result = await window.daisyAPI.captureScreen();
      if ('error' in result) setErrorMsg('Could not capture your screen.');
      else send({ type: 'screenshot', data: result.pngBase64 });
    })();
  } else {
    setConsentReason(msg.reason ?? '');
  }
  break;
```

The HandoffModal `onConfirm` handler (lives in `App`):

```jsx
const onHandoffConfirmed = () => {
  daisy.dismissHandoff();                                  // hook clears handoffNeeded
  window.daisyAPI?.shareScreenRememberedSet?.(true);       // main persists + broadcasts
  window.daisyAPI?.hideMainWindow?.();                     // main hides the big window
  // The main-process tray rebuild + overlay pulse happen in main.ts in
  // response to the IPCs above; no further renderer work needed.
};
```

### Edge cases

- **Screenshot capture fails after consent-yes.** Existing error banner shows ("Could not capture your screen"). HandoffModal does NOT open; `share_screen_remembered` stays `false`. The user is on the big window in the same state they were before — they can retry on the next `screenshot_request`.
- **User says No to the screenshot consent.** Same as today. No screenshot is sent. HandoffModal never appears. Flag stays `false`. Daisy may re-ask later.
- **User toggles "Sharing my screen" off in tray, then back on without taking a screenshot.** Flag becomes `false`, then `true` again. No screenshot fires from either toggle — toggling is metadata-only. The next `screenshot_request` is silent (because flag is `true`). No second hand-off modal: the flag-flip alone doesn't represent a new "first time." The hand-off modal is gated solely on the flag being `false` at the moment of a *successful screenshot send*.
- **User toggles "Sharing my screen" off in tray, then later goes through a fresh `screenshot_request` and says Yes.** Flag was `false` at the moment of consent-yes, so the hand-off modal DOES fire again. Each revocation followed by a real re-grant is treated as a fresh "first time." This is acceptable and probably desirable — if the user revoked and is being asked again, re-explaining where Daisy goes is helpful.
- **Multi-monitor.** `captureScreen` already handles the picker. HandoffModal opens over the main window (primary display) regardless of which display was captured. Corner daisy stays on its current display. No multi-monitor-specific logic for v1.
- **Mic denied but screen allowed.** Independent dimensions. Mic-denied error surfaces through the subtitle pill while the big window is hidden (see below).
- **Error banners while the big window is hidden.** The main window's `ConversationScreen` renders the error banner today, so errors that fire after a minimize are invisible. To prevent silent failures, errors are also pushed through the existing subtitle pill with a red-tinted style (a red dot + slightly different background tint) while `mainWindow` is hidden. Auto-dismiss after 5 seconds. The user can then bring the window back via tray to see full details.

## Testing

No automated path — Electron UI. Manual test plan:

1. **Fresh-install Path 1.** Wipe `userData/settings.json`. Launch, talk through to first `screenshot_request`. Verify: `ScreenshotConsent` → Yes → `HandoffModal` appears → Got it → big window hides, corner daisy pulses once. `settings.json` now has `share_screen_remembered: true`. Tray "Sharing my screen" is checked.
2. **Fresh-install Path 2.** Wipe `settings.json`. Launch, click corner daisy. Verify: screenshot fires, mic starts, NO `HandoffModal`, big window stays open, flag stays `false`.
3. **Subsequent screenshot, flag true.** With flag already true, trigger a `screenshot_request`. Verify: no modals, screenshot sent silently, Daisy thinks and responds.
4. **Revoke from tray.** Toggle "Sharing my screen" off. Trigger another `screenshot_request`. Verify: full consent modal returns; hand-off modal opens after Yes (flag was false at consent time); pulse fires again.
5. **Capture error after consent-yes.** Force `captureScreen` to return `{ error }` (temporary `main.ts` edit). Verify: error banner shows in the conversation screen (big window is still visible because `HandoffModal` never opened), flag stays `false`.
5a. **Capture error while flag is true and big window is hidden.** With flag true and main window hidden, force a `captureScreen` error on the next `screenshot_request`. Verify: subtitle pill displays the error with red styling, auto-dismisses after 5 seconds, flag stays unchanged.
6. **Decline consent.** Verify: no screenshot, no modal, no minimize, flag unchanged.
7. **Bring back via tray.** With big window hidden, click tray daisy. Verify: big window reappears with conversation history intact, corner daisy still present.
8. **i18n.** Repeat 1 + 4 with language set to `es`. Verify modal copy + tray label.
9. **No regression.** Subtitle toggle, overlay drag, conversation flow without ever taking a screenshot, screen-picker on multi-monitor.
