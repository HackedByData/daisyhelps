// main.jsx — Daisy Helps renderer
// Same screens/components as the design prototype, but driven by a real
// WebSocket client (useDaisyBackend) instead of the simulated state machine.

const { useState, useEffect, useRef, useCallback } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "screen": "welcome",
  "state": "idle",
  "language": "en",
  "fontScale": 1.0,
  "backendStubbed": false,
  "micDenied": false,
  "showConsent": false,
  "autoDemo": false,
  "mkScale": 4.0,
  "mkOffsetX": -40,
  "mkOffsetY": -52,
  "mkOriginX": 22.5,
  "mkOriginY": 25.5,
  "mkCenterX": -40,
  "mkCenterY": -52,
  "logoSize": 298,
  "logoOffsetY": -92,
  "helpOffsetY": -78,
  "helpOffsetX": -62
}/*EDITMODE-END*/;

// ─────────────────────────────────────────────────────────────
// Audio utils — inlined so this file is self-contained for Babel
// ─────────────────────────────────────────────────────────────
function float32ToBase64Pcm16(input) {
  const int16 = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(int16.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function base64Pcm16ToFloat32(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const int16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;
  return float32;
}

// "Goodbye, Daisy" detector — matches the literal farewell in EN/ES.
// Punctuation is collapsed before matching; "bye" alone is intentionally
// excluded (too many false positives).
function isFarewell(text) {
  if (!text) return false;
  const norm = String(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return /\b(goodbye|good\s+bye|bye\s+bye|adi[oó]s|hasta\s+luego|hasta\s+pronto)\s+daisy\b/.test(norm);
}

// ─────────────────────────────────────────────────────────────
// Real backend hook — WebSocket + mic + audio playback + screenshot
// Matches the protocol in docs/API.md and mirrors the wire client
// from the previous app.ts implementation.
// ─────────────────────────────────────────────────────────────
const WS_BASE = 'wss://api.daisyhelps.com';
const SESSION_ID = (typeof crypto !== 'undefined' && crypto.randomUUID)
  ? crypto.randomUUID()
  : `s-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function useDaisyBackend() {
  const [state, setState]                   = useState('idle');
  const [userText, setUserText]             = useState('');
  const [daisyText, setDaisyText]           = useState('');
  const [daisyStreaming, setDaisyStreaming] = useState(false);
  const [consentReason, setConsentReason]   = useState(null); // null | string
  const [micDenied, setMicDenied]           = useState(false);
  const [errorMsg, setErrorMsg]             = useState(null);
  // Click indicator hint from backend (label of the thing to click).
  // Suppresses auto-listen so the user can actually go click the target.
  const [clickHint, setClickHint]           = useState(null);
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(true);
  const subtitlesEnabledRef = useRef(true);
  useEffect(() => { subtitlesEnabledRef.current = subtitlesEnabled; }, [subtitlesEnabled]);
  // Ref so we can read latest values inside the audio_end handler closure.
  const daisyTextRef = useRef('');
  useEffect(() => { daisyTextRef.current = daisyText; }, [daisyText]);
  const clickHintRef = useRef(null);
  useEffect(() => { clickHintRef.current = clickHint; }, [clickHint]);

  const wsRef           = useRef(null);
  const partialRef      = useRef('');
  const micSeqRef       = useRef(0);
  const micCtxRef       = useRef(null);
  const micStreamRef    = useRef(null);
  const micSourceRef    = useRef(null);
  const micNodeRef      = useRef(null);
  const playbackCtxRef  = useRef(null);
  const playbackTimeRef = useRef(0);
  // After an interrupt, drop any audio_chunks that arrive before the backend
  // has fully cancelled. ~1500ms covers Render's WS latency + a generous tail
  // of in-flight chunks; without this, mid-stream chunks would recreate the
  // AudioContext and Daisy would briefly resume.
  const discardAudioUntilRef = useRef(0);
  // Tracks every BufferSource currently scheduled on the playback context so
  // interruptIfBusy can call .stop() on each. Closing the AudioContext is
  // async on Windows and doesn't reliably silence the speakers in one tick —
  // explicit per-source stop() does.
  const activeSourcesRef = useRef(new Set());
  // Silence-cutoff: stop mic after 5s with no speech above threshold.
  const SILENCE_THRESHOLD = 0.012;  // RMS of float32 mono audio
  const SILENCE_TIMEOUT_MS = 5000;
  const silenceTimerRef = useRef(null);
  const lastSpeechAtRef = useRef(0);
  const subtitleLingerRef = useRef(null);

  const send = useCallback((msg) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  // Mark state (visual) — separate from logical `state` so we can insert a
  // brief 'returning' frame between thinking and speaking that lets the
  // orbiting petals float back to rest before the chorus animation begins.
  const [markState, setMarkState] = useState('idle');
  const prevStateRef = useRef('idle');
  useEffect(() => {
    const prev = prevStateRef.current;
    prevStateRef.current = state;
    if (prev === 'thinking' && state !== 'thinking') {
      setMarkState('returning');
      const t = setTimeout(() => setMarkState(state), 1200);
      return () => clearTimeout(t);
    }
    setMarkState(state);
  }, [state]);

  // Mirror MARK state (so the overlay sees 'returning' too) via IPC
  useEffect(() => {
    window.daisyAPI?.overlayState?.(markState);
  }, [markState]);

  // Stuck-thinking watchdog: if the backend never advances past 'thinking'
  // within 25s, fall back to idle and surface a friendly error. This avoids
  // the user staring at orbiting petals forever when an upstream call hangs.
  useEffect(() => {
    if (state !== 'thinking') return;
    const t = setTimeout(() => {
      console.warn('stuck in thinking — resetting');
      setState('idle');
      setErrorMsg("Sorry, I had trouble with that. Could you try once more?");
    }, 25000);
    return () => clearTimeout(t);
  }, [state]);

  // Connect + auto-reconnect (3s backoff on close)
  useEffect(() => {
    let closed = false;
    function connect() {
      if (closed) return;
      const ws = new WebSocket(`${WS_BASE}/ws/${SESSION_ID}`);
      wsRef.current = ws;
      ws.onopen  = () => ws.send(JSON.stringify({ type: 'config', language: 'en' }));
      ws.onclose = () => { if (!closed) setTimeout(connect, 3000); };
      ws.onerror = () => { /* surfaced via onclose */ };
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        switch (msg.type) {
          case 'status':
            setState(msg.state);
            break;
          case 'transcript':
            setUserText(msg.text);
            partialRef.current = '';
            // Voice farewell: if the user said "Goodbye, Daisy" (any variant),
            // tear down and quit. Only act on the final transcript so a
            // partial doesn't trigger early.
            if ((msg.final ?? true) && isFarewell(msg.text)) {
              goodbyeAndQuitRef.current?.();
            }
            break;
          case 'daisy_text':
            // Cancel any pending linger-hide — new content arrives, the pill
            // should stay (or come back) visible immediately.
            if (subtitleLingerRef.current) {
              clearTimeout(subtitleLingerRef.current);
              subtitleLingerRef.current = null;
            }
            if (msg.partial) {
              partialRef.current += msg.text;
              setDaisyText(partialRef.current);
              setDaisyStreaming(true);
              if (subtitlesEnabledRef.current) {
                window.daisyAPI?.subtitleShow?.(partialRef.current);
              }
            } else {
              setDaisyText(msg.text);
              partialRef.current = '';
              setDaisyStreaming(false);
              if (subtitlesEnabledRef.current) {
                window.daisyAPI?.subtitleShow?.(msg.text);
              }
            }
            break;
          case 'audio_chunk':
            playPcmChunk(msg.data);
            break;
          case 'audio_end':
            setDaisyStreaming(false);
            // Linger the subtitle pill 4s after speech ends, then clear.
            if (subtitleLingerRef.current) clearTimeout(subtitleLingerRef.current);
            subtitleLingerRef.current = setTimeout(() => {
              window.daisyAPI?.subtitleClear?.();
              subtitleLingerRef.current = null;
            }, 4000);
            // Conversational continuation: if Daisy ended with a question and
            // isn't currently pointing the user to click something, auto-start
            // listening so the user doesn't have to click the daisy each turn.
            {
              const text = (daisyTextRef.current || '').trim();
              const endsWithQuestion = /[?¿]\s*$/.test(text);
              if (endsWithQuestion && !clickHintRef.current) {
                setTimeout(() => { void startTalkingRef.current?.(); }, 500);
              }
            }
            break;
          case 'screenshot_request':
            setConsentReason(msg.reason ?? '');
            break;
          case 'click_indicator':
            // Show a screen-wide daisy pointer at the indicated target, and
            // keep the caption banner as a secondary cue. The banner also
            // suppresses auto-listen on audio_end so the user has time to
            // actually go click the thing.
            window.daisyAPI?.showIndicator?.({
              x: msg.x, y: msg.y,
              refW: msg.ref_width, refH: msg.ref_height,
              label: msg.label || undefined,
            });
            setClickHint(msg.label || 'this');
            break;
          case 'clear_indicator':
            window.daisyAPI?.clearIndicator?.();
            setClickHint(null);
            break;
          case 'error':
            console.error('server error', msg.code, msg.message);
            setErrorMsg(msg.message ?? String(msg.code));
            // Reset to idle so the user isn't stuck watching the thinking
            // animation forever when a turn fails downstream (e.g. TTS 401).
            setState('idle');
            setDaisyStreaming(false);
            break;
          default:
            break;
        }
      };
    }
    connect();
    return () => {
      closed = true;
      try { wsRef.current?.close(); } catch {}
    };
  }, []);

  // Subtitle setting — load initial value from main and listen for changes
  // (tray menu or other windows can toggle it; we mirror via broadcast).
  useEffect(() => {
    let mounted = true;
    void window.daisyAPI?.subtitleEnabledGet?.().then((enabled) => {
      if (mounted) setSubtitlesEnabled(!!enabled);
    });
    window.daisyAPI?.onSubtitleEnabledChanged?.((enabled) => {
      if (mounted) setSubtitlesEnabled(!!enabled);
    });
    return () => { mounted = false; };
  }, []);

  function playPcmChunk(b64) {
    if (Date.now() < discardAudioUntilRef.current) return;
    // If the user is currently talking, the previous turn's audio shouldn't
    // sneak through. (audio_end / interruptIfBusy may have raced with chunks
    // already in flight on the WS.)
    if (liveStateRef.current === 'listening') return;
    if (!playbackCtxRef.current) {
      playbackCtxRef.current = new AudioContext({ sampleRate: 24000 });
      playbackTimeRef.current = playbackCtxRef.current.currentTime;
    }
    const ctx = playbackCtxRef.current;
    const float32 = base64Pcm16ToFloat32(b64);
    const buffer  = ctx.createBuffer(1, float32.length, 24000);
    buffer.getChannelData(0).set(float32);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    const startAt = Math.max(ctx.currentTime, playbackTimeRef.current);
    src.start(startAt);
    playbackTimeRef.current = startAt + buffer.duration;
    // Track the node so interruptIfBusy can stop() it. onended removes it
    // from the set after it plays through naturally.
    activeSourcesRef.current.add(src);
    src.onended = () => activeSourcesRef.current.delete(src);
  }

  function stopMicCapture() {
    try { micNodeRef.current?.disconnect(); } catch {}
    micNodeRef.current = null;
    try { micSourceRef.current?.disconnect(); } catch {}
    micSourceRef.current = null;
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    if (silenceTimerRef.current) {
      clearInterval(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }

  // Barge-in. Called before any new user-initiated turn (Talk button, overlay
  // click, text submit) so the user can cut Daisy off mid-thought.
  // - sends WS interrupt → backend cancels TTS/LLM and stops streaming
  // - closes the playback AudioContext → already-queued chunks stop playing
  // - opens a brief discard window → in-flight chunks the backend already sent
  //   are dropped rather than starting a fresh playback context
  // - clears the caption / click indicator so the next turn starts clean
  // Refs are read instead of `state` so this can stay outside the callback's
  // deps and not invalidate startTalking on every state change.
  const liveStateRef = useRef('idle');
  useEffect(() => { liveStateRef.current = state; }, [state]);
  const interruptIfBusy = useCallback(() => {
    if (liveStateRef.current === 'idle') return;
    send({ type: 'interrupt' });
    discardAudioUntilRef.current = Date.now() + 1500;
    // Explicitly stop every queued buffer source — closing the context alone
    // doesn't reliably silence Windows' audio buffer in time.
    activeSourcesRef.current.forEach((s) => {
      try { s.onended = null; s.stop(0); s.disconnect(); } catch {}
    });
    activeSourcesRef.current.clear();
    try { playbackCtxRef.current?.close(); } catch {}
    playbackCtxRef.current = null;
    playbackTimeRef.current = 0;
    setDaisyText('');
    partialRef.current = '';
    setDaisyStreaming(false);
    if (subtitleLingerRef.current) {
      clearTimeout(subtitleLingerRef.current);
      subtitleLingerRef.current = null;
    }
    window.daisyAPI?.subtitleClear?.();
    window.daisyAPI?.clearIndicator?.();
    setClickHint(null);
  }, [send]);

  const startTalking = useCallback(async () => {
    // Barge-in: if Daisy is mid-thinking or speaking, cancel that turn so the
    // user can take the floor.
    interruptIfBusy();
    setUserText('');
    setErrorMsg(null);
    // Optimistic: kick the UI into "listening" immediately so the overlay
    // and the conversation hero start their listening animation before
    // the backend's first audio chunk causes it to fire `status: listening`.
    setState('listening');
    try {
      if (!micCtxRef.current) micCtxRef.current = new AudioContext({ sampleRate: 16000 });
      // Try permissive constraints first — some Windows mic drivers reject
      // explicit sampleRate=16000 + channelCount=1. The AudioContext does the
      // resampling for us anyway.
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (innerErr) {
        // Fall back to the constrained request in case the simple form failed
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
        });
      }
      micStreamRef.current = stream;
      const ctx = micCtxRef.current;
      const source = ctx.createMediaStreamSource(stream);
      micSourceRef.current = source;
      // ScriptProcessorNode requires a power-of-two buffer size between 256
      // and 16384. 2048 ≈ 128ms at 16kHz which keeps streaming latency low.
      const node = ctx.createScriptProcessor(2048, 1, 1);
      // Treat the moment listening starts as "just spoke" so we don't immediately cut off.
      lastSpeechAtRef.current = Date.now();
      node.onaudioprocess = (e) => {
        const float32 = e.inputBuffer.getChannelData(0);
        // RMS-based silence detection — refresh lastSpeechAt while audio is above threshold.
        let sumSq = 0;
        for (let i = 0; i < float32.length; i++) sumSq += float32[i] * float32[i];
        const rms = Math.sqrt(sumSq / float32.length);
        if (rms > SILENCE_THRESHOLD) lastSpeechAtRef.current = Date.now();
        send({ type: 'audio_chunk', data: float32ToBase64Pcm16(float32), sequence: micSeqRef.current++ });
      };
      source.connect(node);
      node.connect(ctx.destination);
      micNodeRef.current = node;
      // Watchdog: every 500ms check whether we've been silent for SILENCE_TIMEOUT_MS.
      silenceTimerRef.current = setInterval(() => {
        if (micNodeRef.current && Date.now() - lastSpeechAtRef.current > SILENCE_TIMEOUT_MS) {
          stopMicCapture();
        }
      }, 500);
      setMicDenied(false);
    } catch (err) {
      console.error('mic failed', err && err.name, err && err.message, err);
      setMicDenied(true);
      // Surface the concrete cause so the banner can guide the user.
      const name = (err && err.name) || 'Error';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setErrorMsg('Windows is blocking microphone access. Open Settings → Privacy & security → Microphone and turn on "Let apps access your microphone" and "Daisy Helps".');
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        setErrorMsg("I can't find a microphone on this computer. Plug one in and try again.");
      } else if (name === 'NotReadableError') {
        setErrorMsg('Another app is using the microphone. Close it and try again.');
      } else {
        setErrorMsg(`Microphone error (${name}). You can still type to me.`);
      }
      setState('idle');
    }
  }, [send, interruptIfBusy]);

  const stopTalking = useCallback(() => {
    stopMicCapture();
    // Optimistic: flip to thinking now that the user is done. The backend
    // will fire its own status events shortly that confirm/override.
    setState('thinking');
  }, []);

  // Ref to startTalking so the WS message handler (whose closure is set
  // up on first render) can call the latest version after auto-listen on
  // audio_end.
  const startTalkingRef = useRef(null);
  useEffect(() => { startTalkingRef.current = startTalking; }, [startTalking]);
  // Same ref pattern for goodbyeAndQuit — the transcript handler needs the
  // freshest callback, but goodbyeAndQuit is declared after this useEffect.
  const goodbyeAndQuitRef = useRef(null);

  // Capture a screenshot via the preload IPC and send it on the wire.
  // Used by the overlay click flow ("show daisy my screen + start listening").
  const sendScreenshot = useCallback(async () => {
    if (!window.daisyAPI?.captureScreen) return false;
    const result = await window.daisyAPI.captureScreen();
    if ('error' in result) {
      console.error('screen capture failed', result.error);
      setErrorMsg('Could not capture your screen.');
      return false;
    }
    send({ type: 'screenshot', data: result.pngBase64 });
    return true;
  }, [send]);

  // Best-effort: prime the OS mic-permission prompt without starting a turn.
  // Called from the Welcome screen's first button so the dialog appears early
  // rather than at the moment the user expects Daisy to start listening.
  const primeMicPermission = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setMicDenied(false);
      setErrorMsg(null);
      return true;
    } catch (err) {
      console.warn('mic permission not granted at session start',
        err && err.name, err && err.message, err);
      setMicDenied(true);
      const name = (err && err.name) || 'Error';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setErrorMsg('Windows is blocking microphone access. Open Settings → Privacy & security → Microphone and turn on "Let apps access your microphone" and "Daisy Helps".');
      }
      return false;
    }
  }, []);

  const stopDaisy = useCallback(() => {
    send({ type: 'interrupt' });
  }, [send]);

  const respondConsent = useCallback(async (yes) => {
    setConsentReason(null);
    if (yes && window.daisyAPI?.captureScreen) {
      const result = await window.daisyAPI.captureScreen();
      if ('error' in result) {
        console.error('screen capture failed', result.error);
        setErrorMsg('Could not capture your screen.');
      } else {
        send({ type: 'screenshot', data: result.pngBase64 });
      }
    }
  }, [send]);

  const changeLanguage = useCallback((newLang) => {
    send({ type: 'language_change', language: newLang });
  }, [send]);

  const endSession = useCallback(() => {
    stopMicCapture();
    send({ type: 'end_session' });
    setState('idle');
    setUserText('');
    setDaisyText('');
    setDaisyStreaming(false);
    if (subtitleLingerRef.current) {
      clearTimeout(subtitleLingerRef.current);
      subtitleLingerRef.current = null;
    }
    window.daisyAPI?.subtitleClear?.();
  }, [send]);

  // "Goodbye, Daisy" → tear everything down and quit Electron.
  // Stops mic + active TTS, sends end_session so the backend can release the
  // session, closes the WS, then hands off to the main process to quit.
  const goodbyeAndQuit = useCallback(() => {
    interruptIfBusy();
    stopMicCapture();
    try { send({ type: 'end_session' }); } catch {}
    try { wsRef.current?.close(); } catch {}
    window.daisyAPI?.overlayHide?.();
    // Tiny delay so the WS frame and audio teardown have a chance to flush
    // before Electron yanks the process.
    setTimeout(() => { window.daisyAPI?.quitApp?.(); }, 150);
  }, [send, interruptIfBusy]);
  useEffect(() => { goodbyeAndQuitRef.current = goodbyeAndQuit; }, [goodbyeAndQuit]);

  const sendUserText = useCallback((text) => {
    if (!text || !text.trim()) return;
    if (isFarewell(text)) { goodbyeAndQuit(); return; }
    // Barge-in: if Daisy is mid-thinking/speaking, cancel that turn so this
    // text becomes the next prompt instead of being queued behind the reply.
    interruptIfBusy();
    send({ type: 'user_text', text });
  }, [send, interruptIfBusy, goodbyeAndQuit]);

  const clearError = useCallback(() => setErrorMsg(null), []);

  return {
    state, markState, userText, daisyText, daisyStreaming,
    consentReason, micDenied, errorMsg, clickHint,
    startTalking, stopTalking, stopDaisy,
    respondConsent, changeLanguage, endSession, sendUserText, clearError,
    sendScreenshot, primeMicPermission,
    subtitlesEnabled,
  };
}

// ─────────────────────────────────────────────────────────────
// Main app
// ─────────────────────────────────────────────────────────────
function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const lang   = t.language;
  const screen = t.screen;

  // Live backend connection — state, captions, mic, audio, screenshot
  const daisy = useDaisyBackend();

  // On the conversation screen the real backend drives Daisy's state; on
  // welcome/goodbye we just sit in idle (or whatever the tweaks panel set,
  // for visual previews).
  const state = (screen === 'conversation') ? daisy.state : 'idle';

  // Apply font scale at the root
  useEffect(() => {
    document.documentElement.style.setProperty('--scale', String(t.fontScale));
  }, [t.fontScale]);

  // Sync logo size + position to CSS custom properties
  useEffect(() => {
    const r = document.documentElement.style;
    r.setProperty('--logo-size', t.logoSize + 'px');
    r.setProperty('--logo-offset-y', t.logoOffsetY + 'px');
    r.setProperty('--help-offset-y', t.helpOffsetY + 'px');
    r.setProperty('--help-offset-x', t.helpOffsetX + 'px');
  }, [t.logoSize, t.logoOffsetY, t.helpOffsetY, t.helpOffsetX]);

  // Sync flower positioning to CSS custom properties so DaisyMark picks them up
  useEffect(() => {
    const r = document.documentElement.style;
    r.setProperty('--mk-scale', t.mkScale);
    r.setProperty('--mk-x', t.mkOffsetX + '%');
    r.setProperty('--mk-y', t.mkOffsetY + '%');
    r.setProperty('--mk-ox', t.mkOriginX + '%');
    r.setProperty('--mk-oy', t.mkOriginY + '%');
    r.setProperty('--mk-cx', t.mkCenterX + '%');
    r.setProperty('--mk-cy', t.mkCenterY + '%');
  }, [t.mkScale, t.mkOffsetX, t.mkOffsetY, t.mkOriginX, t.mkOriginY, t.mkCenterX, t.mkCenterY]);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [micPromptOpen, setMicPromptOpen] = useState(false);

  // Push language changes to the backend
  useEffect(() => {
    daisy.changeLanguage(lang);
  }, [lang]);

  // Handlers
  const startSession = () => {
    // Show a plain-language consent modal first. Electron auto-grants the
    // Chromium media permission (see main.ts setPermissionRequestHandler),
    // so the OS-level dialog never fires — this modal is the user-facing
    // "may I?" surface.
    setMicPromptOpen(true);
  };

  const acceptMicAndEnter = async () => {
    setMicPromptOpen(false);
    await daisy.primeMicPermission();
    setTweak({ screen: 'conversation' });
    window.daisyAPI?.overlayShow?.();
  };
  const declineMicAndEnter = () => {
    setMicPromptOpen(false);
    setTweak({ screen: 'conversation' });
    window.daisyAPI?.overlayShow?.();
  };
  const onTalk      = () => { void daisy.startTalking(); };
  const onStopTalk  = () => daisy.stopTalking();
  const onStopDaisy = () => daisy.stopDaisy();

  const endSession = () => {
    daisy.endSession();
    setSettingsOpen(false);
    window.daisyAPI?.overlayHide?.();
    setTweak({ screen: 'goodbye' });
  };
  const startOver = () => {
    setTweak({ screen: 'welcome' });
  };

  const onConsentYes = () => { void daisy.respondConsent(true); };
  const onConsentNo  = () => { void daisy.respondConsent(false); };

  // Surface the live consent prompt from the backend (or the manual tweak override)
  const consentVisible = daisy.consentReason !== null || t.showConsent;
  const consentReasonText = daisy.consentReason ?? (lang === 'en'
    ? "I'd like to see what's on your screen so I can point to the right button."
    : 'Quisiera ver lo que está en tu pantalla para indicarte el botón correcto.');

  // Auto-update notification (no UI surface yet — fire alert in v1)
  useEffect(() => {
    window.daisyAPI?.onUpdateReady?.((info) => {
      const restart = window.confirm(`Daisy ${info.version} is ready. Restart now to update?`);
      if (restart) window.daisyAPI.quitAndInstall();
    });
  }, []);

  // Overlay daisy click → screenshot + start listening, or stop if already listening.
  // Uses a state ref so the IPC listener registers once and reads the freshest state.
  const stateRef = useRef(daisy.state);
  useEffect(() => { stateRef.current = daisy.state; }, [daisy.state]);
  useEffect(() => {
    if (!window.daisyAPI?.onOverlayClick) return;
    window.daisyAPI.onOverlayClick(async () => {
      const s = stateRef.current;
      if (s === 'listening') {
        // Toggle: second click stops the mic.
        daisy.stopTalking();
        return;
      }
      // Any other state (idle / thinking / speaking) → start a fresh turn.
      // startTalking() will interrupt the current turn first if Daisy is
      // mid-thought, so the user can cut her off and ask something new.
      // Screenshot first so the backend has it when transcription completes.
      await daisy.sendScreenshot();
      void daisy.startTalking();
    });
  }, []);

  // Dev-only: Ctrl+Shift+T toggles the Tweaks panel
  const [tweaksVisible, setTweaksVisible] = useState(false);
  useEffect(() => {
    function onKey(e) {
      if (e.ctrlKey && e.shiftKey && (e.key === 'T' || e.key === 't')) {
        e.preventDefault();
        setTweaksVisible((v) => !v);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ─────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────
  return (
    <>
      <div className="shell">
        {(screen === 'welcome' || screen === 'conversation' || screen === 'goodbye') && (
          <TopBar
            lang={lang}
            onLang={(l) => setTweak('language', l)}
            onSettings={() => setSettingsOpen((v) => !v)}
            showSettings={screen === 'conversation'}
          />
        )}

        {screen === 'welcome' && (
          <WelcomeScreen lang={lang} onStart={startSession} />
        )}

        {screen === 'conversation' && (
          <>
            <ConversationScreen
              lang={lang}
              state={state}
              markState={daisy.markState}
              userTranscript={daisy.userText}
              daisyText={daisy.daisyText}
              daisyStreaming={daisy.daisyStreaming}
              backendStubbed={t.backendStubbed}
              micDenied={t.micDenied || daisy.micDenied}
              micMessage={daisy.errorMsg}
              clickHint={daisy.clickHint}
              onTextFallback={(text) => daisy.sendUserText(text)}
            />
            <ActionBar
              lang={lang}
              state={state}
              onTalk={onTalk}
              onStopTalk={onStopTalk}
              onStopDaisy={onStopDaisy}
            />
          </>
        )}

        {screen === 'goodbye' && (
          <GoodbyeScreen lang={lang} onAgain={startOver} />
        )}

        {/* a tiny footer mark on welcome */}
        {screen === 'welcome' && (
          <div style={{ textAlign: 'center', color: 'var(--ink-2)', fontSize: '0.9rem', paddingBottom: 8 }}>
            {COPY[lang].tagline}
          </div>
        )}
      </div>

      {consentVisible && screen === 'conversation' && (
        <ScreenshotConsent
          lang={lang}
          reason={consentReasonText}
          onYes={onConsentYes}
          onNo={onConsentNo}
        />
      )}

      {micPromptOpen && (
        <div className="modal-scrim" role="dialog" aria-modal="true" aria-labelledby="mic-prompt-title">
          <div className="modal">
            <h2 id="mic-prompt-title">
              {lang === 'en' ? 'May I use your microphone?' : '¿Puedo usar tu micrófono?'}
            </h2>
            <div className="modal__reason">
              <strong style={{ fontFamily: 'Fraunces, serif', fontWeight: 600 }}>
                {lang === 'en' ? 'Daisy says: ' : 'Daisy dice: '}
              </strong>
              &ldquo;{lang === 'en'
                ? "I'll only listen while you're talking to me. When you close Daisy, the microphone turns off."
                : 'Solo te escucho cuando me hablas. Cuando cierras Daisy, el micrófono se apaga.'}&rdquo;
            </div>
            <div className="modal__why">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" style={{ flex: 'none', color: 'var(--ink-2)' }}>
                <rect x="9" y="3" width="6" height="12" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0" />
                <path d="M12 18v3" />
              </svg>
              <span>{lang === 'en'
                ? 'I need your microphone so I can hear what you say. You can change this any time in Windows settings.'
                : 'Necesito tu micrófono para escucharte. Puedes cambiar esto en cualquier momento en la configuración de Windows.'}</span>
            </div>
            <div className="modal__actions">
              <button className="btn btn--primary btn--xl" onClick={acceptMicAndEnter} style={{ flex: 1 }} autoFocus>
                {lang === 'en' ? 'Yes, use my microphone' : 'Sí, usa mi micrófono'}
              </button>
              <button className="btn btn--ghost btn--xl" onClick={declineMicAndEnter} style={{ flex: 1 }}>
                {lang === 'en' ? 'Not right now' : 'Ahora no'}
              </button>
            </div>
          </div>
        </div>
      )}

      {settingsOpen && screen === 'conversation' && (
        <SettingsSheet
          lang={lang}
          fontScale={t.fontScale}
          onFontScale={(v) => setTweak('fontScale', v)}
          onClose={() => setSettingsOpen(false)}
          onEnd={endSession}
          onAudioTest={() => {/* play a friendly beep in real build */}}
          subtitlesEnabled={daisy.subtitlesEnabled}
          onSubtitlesEnabled={(v) => window.daisyAPI?.subtitleEnabledSet?.(v)}
        />
      )}

      {tweaksVisible && <TweaksPanel title="Tweaks">
        <TweakSection label="Demo" />
        <TweakRadio label="Screen" value={screen}
          options={['welcome', 'conversation', 'goodbye']}
          onChange={(v) => setTweak('screen', v)} />
        {/* State is driven by the live backend; the manual jumper was a
            prototype-only affordance and is intentionally omitted. */}
        <TweakButton label="Start talking" onClick={() => { setTweak({ screen: 'conversation' }); void daisy.startTalking(); }} />
        <TweakButton label="Interrupt Daisy" onClick={() => daisy.stopDaisy()} />

        <TweakSection label="Language" />
        <TweakRadio label="Language" value={lang}
          options={['en', 'es']}
          onChange={(v) => setTweak('language', v)} />

        <TweakSection label="Accessibility" />
        <TweakSlider label="Font scale" value={t.fontScale} min={0.85} max={1.6} step={0.05} unit="x"
          onChange={(v) => setTweak('fontScale', +v.toFixed(2))} />
        <TweakSlider label="Logo size" value={t.logoSize} min={40} max={400} step={2} unit="px"
          onChange={(v) => setTweak('logoSize', v)} />
        <TweakSlider label="Logo offset Y" value={t.logoOffsetY} min={-200} max={100} step={1} unit="px"
          onChange={(v) => setTweak('logoOffsetY', v)} />
        <TweakSlider label="Helps offset Y" value={t.helpOffsetY} min={-200} max={100} step={1} unit="px"
          onChange={(v) => setTweak('helpOffsetY', v)} />
        <TweakSlider label="Helps offset X" value={t.helpOffsetX} min={-200} max={200} step={1} unit="px"
          onChange={(v) => setTweak('helpOffsetX', v)} />

        <TweakSection label="Flower position" />
        <TweakSlider label="Scale" value={t.mkScale} min={1} max={10} step={0.1} unit="×"
          onChange={(v) => setTweak('mkScale', +v.toFixed(1))} />
        <TweakSlider label="Offset X" value={t.mkOffsetX} min={-200} max={100} step={1} unit="%"
          onChange={(v) => setTweak('mkOffsetX', v)} />
        <TweakSlider label="Offset Y" value={t.mkOffsetY} min={-200} max={100} step={1} unit="%"
          onChange={(v) => setTweak('mkOffsetY', v)} />
        <TweakSlider label="Origin X" value={t.mkOriginX} min={0} max={100} step={0.5} unit="%"
          onChange={(v) => setTweak('mkOriginX', +v.toFixed(1))} />
        <TweakSlider label="Origin Y" value={t.mkOriginY} min={0} max={100} step={0.5} unit="%"
          onChange={(v) => setTweak('mkOriginY', +v.toFixed(1))} />

        <TweakSection label="Center position" />
        <TweakSlider label="Center X" value={t.mkCenterX} min={-200} max={100} step={1} unit="%"
          onChange={(v) => setTweak('mkCenterX', v)} />
        <TweakSlider label="Center Y" value={t.mkCenterY} min={-200} max={100} step={1} unit="%"
          onChange={(v) => setTweak('mkCenterY', v)} />

        <TweakSection label="Edge cases" />
        <TweakToggle label="Backend partly stubbed" value={t.backendStubbed}
          onChange={(v) => setTweak('backendStubbed', v)} />
        <TweakToggle label="Microphone denied" value={t.micDenied}
          onChange={(v) => setTweak('micDenied', v)} />
        <TweakButton label="Show screenshot consent" onClick={() => setTweak({ screen: 'conversation', showConsent: true })} />
      </TweaksPanel>}
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
