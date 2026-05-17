import { float32ToBase64Pcm16, base64Pcm16ToFloat32 } from './audio-utils.js';
import type { ClientMsg, ServerMsg, Language, Status } from './types.js';

const WS_BASE = 'wss://api.daisyhelps.com';

// ─── Copy (EN / ES) ──────────────────────────────────────────────────────────

const COPY = {
  en: {
    tagline: 'Patient help for your computer',
    welcomeTitle: 'Hello. I’m Daisy.',
    welcomeLede: 'I help you do things on your computer, one calm step at a time. Just talk to me out loud.',
    start: 'Start talking to Daisy',
    micExplain: 'I’ll ask to use your microphone so I can hear you.',
    youSaid: 'You said',
    daisy: 'Daisy',
    daisySays: 'Daisy is saying',
    statusIdle: 'Tap the big button when you’re ready',
    statusIdleHero: 'I’m here when you’re ready.',
    statusListening: 'I’m listening…',
    statusListeningHero: 'Go ahead, I’m listening.',
    statusThinking: 'Daisy is thinking…',
    statusThinkingHero: 'Just a moment, I’m thinking…',
    statusSpeaking: 'Daisy is speaking',
    statusSpeakingHero: 'Listen — I’m here.',
    talk: 'Start talking',
    stopTalking: 'I’m done talking',
    stopDaisy: 'Stop Daisy',
    settings: 'Settings',
    settingsTitle: 'Settings',
    textSize: 'Text size',
    audioTest: 'Test the sound',
    playSound: 'Play sound',
    end: 'End the visit',
    endNow: 'End now',
    close: 'Close',
    consentTitle: 'May I see your screen?',
    consentWhy: 'Your screen is only sent to Daisy for this one moment. It is not saved.',
    consentYes: 'Show Daisy my screen',
    consentNo: 'Not right now',
    goodbye: 'Thanks for visiting with Daisy.',
    goodbyeSub: 'Come back any time. I’m always happy to help.',
    again: 'Start a new visit',
    errMicTitle: 'I can’t hear you yet.',
    errMicBody: 'Your microphone is turned off. Check Windows microphone settings, then try again.',
  },
  es: {
    tagline: 'Ayuda paciente para tu computadora',
    welcomeTitle: 'Hola. Soy Daisy.',
    welcomeLede: 'Te ayudo a hacer cosas en tu computadora, un paso a la vez. Solo háblame en voz alta.',
    start: 'Empezar a hablar con Daisy',
    micExplain: 'Te voy a pedir permiso para usar el micrófono y poder escucharte.',
    youSaid: 'Dijiste',
    daisy: 'Daisy',
    daisySays: 'Daisy está hablando',
    statusIdle: 'Toca el botón grande cuando estés lista',
    statusIdleHero: 'Aquí estoy cuando estés lista.',
    statusListening: 'Te estoy escuchando…',
    statusListeningHero: 'Adelante, te escucho.',
    statusThinking: 'Daisy está pensando…',
    statusThinkingHero: 'Un momento, estoy pensando…',
    statusSpeaking: 'Daisy está hablando',
    statusSpeakingHero: 'Escucha — estoy aquí.',
    talk: 'Empezar a hablar',
    stopTalking: 'Terminé de hablar',
    stopDaisy: 'Detener a Daisy',
    settings: 'Ajustes',
    settingsTitle: 'Ajustes',
    textSize: 'Tamaño del texto',
    audioTest: 'Probar el sonido',
    playSound: 'Reproducir',
    end: 'Terminar la visita',
    endNow: 'Terminar',
    close: 'Cerrar',
    consentTitle: '¿Puedo ver tu pantalla?',
    consentWhy: 'Tu pantalla se envía a Daisy solo por un momento. No se guarda.',
    consentYes: 'Mostrar mi pantalla',
    consentNo: 'Ahora no',
    goodbye: 'Gracias por visitar a Daisy.',
    goodbyeSub: 'Vuelve cuando quieras. Siempre me alegra ayudarte.',
    again: 'Empezar una nueva visita',
    errMicTitle: 'Todavía no te escucho.',
    errMicBody: 'Tu micrófono está apagado. Revisa los ajustes del micrófono, luego inténtalo de nuevo.',
  },
} as const;

// ─── Types ───────────────────────────────────────────────────────────────────

type Screen = 'welcome' | 'stage' | 'goodbye';

interface CenterXY { x: number; y: number }
interface MarkPos {
  scale: number; offsetX: number; offsetY: number;
  originX: number; originY: number;
  center: CenterXY | Partial<Record<Status, CenterXY>>;
}

// ─── Per-screen DaisyMark positions (tuned in the prototype tweaks panel) ────

const POS_WELCOME: MarkPos = {
  scale: 5.2, offsetX: -121, offsetY: -200, originX: 13, originY: 25.5,
  center: { x: -121, y: -200 },
};
const POS_CONV: MarkPos = {
  scale: 2.8, offsetX: -68, offsetY: -80, originX: 13, originY: 25.5,
  center: { idle: { x: -67, y: -80 }, listening: { x: -62, y: -77 }, thinking: { x: -67, y: -80 }, speaking: { x: -67, y: -80 } },
};
const POS_GOODBYE: MarkPos = {
  scale: 2.8, offsetX: -1, offsetY: -78, originX: 13, originY: 25.5,
  center: { x: -1, y: -78 },
};

// ─── State ───────────────────────────────────────────────────────────────────

const sessionId = crypto.randomUUID();
let ws: WebSocket | null = null;
let language: Language = 'en';
let daisyState: Status = 'idle';
let currentScreen: Screen = 'welcome';
let micActive = false;
let micStream: MediaStream | null = null;
let micCtx: AudioContext | null = null;
let micSource: MediaStreamAudioSourceNode | null = null;
let micNode: ScriptProcessorNode | null = null;
let micSeq = 0;
let playbackCtx: AudioContext | null = null;
let playbackTime = 0;
let partialCaption = '';
let daisyCaption = '';
let userTranscript = '';
let fontScale = 1.0;

// ─── DOM refs ────────────────────────────────────────────────────────────────

const langEnBtn        = document.getElementById('lang-en')           as HTMLButtonElement;
const langEsBtn        = document.getElementById('lang-es')           as HTMLButtonElement;
const settingsBtn      = document.getElementById('settings-btn')      as HTMLButtonElement;
const screenWelcome    = document.getElementById('screen-welcome')    as HTMLElement;
const screenStage      = document.getElementById('screen-stage')      as HTMLElement;
const screenGoodbye    = document.getElementById('screen-goodbye')    as HTMLElement;
const screenActions    = document.getElementById('screen-actions')    as HTMLElement;
const welcomeTagline   = document.getElementById('welcome-tagline')   as HTMLElement;
const welcomeTitle     = document.getElementById('welcome-title')     as HTMLElement;
const welcomeLede      = document.getElementById('welcome-lede')      as HTMLElement;
const startLabel       = document.getElementById('start-label')       as HTMLElement;
const permNote         = document.getElementById('perm-note')         as HTMLElement;
const startBtn         = document.getElementById('start-btn')         as HTMLButtonElement;
const heroLabel        = document.getElementById('hero-label')        as HTMLElement;
const heroStatus       = document.getElementById('hero-status')       as HTMLElement;
const micBarsWrap      = document.getElementById('mic-bars-wrap')     as HTMLElement;
const daisyWhoEl       = document.getElementById('daisy-who')         as HTMLElement;
const daisyTextEl      = document.getElementById('daisy-text')        as HTMLElement;
const youSaidWrap      = document.getElementById('you-said-wrap')     as HTMLElement;
const youSaidLabel     = document.getElementById('you-said-label')    as HTMLElement;
const youSaidText      = document.getElementById('you-said-text')     as HTMLElement;
const statusDot        = document.getElementById('status-dot')        as HTMLElement;
const actionPrimary    = document.getElementById('action-primary')    as HTMLElement;
const micDeniedBanner  = document.getElementById('mic-denied-banner') as HTMLElement;
const errMicTitle      = document.getElementById('err-mic-title')     as HTMLElement;
const errMicBody       = document.getElementById('err-mic-body')      as HTMLElement;
const goodbyeTitle     = document.getElementById('goodbye-title')     as HTMLElement;
const goodbyeSub       = document.getElementById('goodbye-sub')       as HTMLElement;
const againBtn         = document.getElementById('again-btn')         as HTMLButtonElement;
const settingsSheet    = document.getElementById('settings-sheet')    as HTMLElement;
const settingsTitle    = document.getElementById('settings-title')    as HTMLElement;
const fontSmallerBtn   = document.getElementById('font-smaller')      as HTMLButtonElement;
const fontLargerBtn    = document.getElementById('font-larger')       as HTMLButtonElement;
const audioTestBtn     = document.getElementById('audio-test-btn')    as HTMLButtonElement;
const endBtn           = document.getElementById('end-btn')           as HTMLButtonElement;
const settingsCloseBtn = document.getElementById('settings-close-btn') as HTMLButtonElement;
const consentModal     = document.getElementById('consent-modal')     as HTMLElement;
const consentReason    = document.getElementById('consent-reason')    as HTMLElement;
const consentWhy       = document.getElementById('consent-why')       as HTMLElement;
const consentTitle     = document.getElementById('consent-title')     as HTMLElement;
const consentYesBtn    = document.getElementById('consent-yes-btn')   as HTMLButtonElement;
const consentNoBtn     = document.getElementById('consent-no-btn')    as HTMLButtonElement;
const updateBadge      = document.getElementById('update-badge')      as HTMLElement;

// ─── DaisyMark DOM renderer ───────────────────────────────────────────────────

function createDaisyMark(container: HTMLElement, pos: MarkPos): (state: Status) => void {
  const PETALS = [
    'petal1-removebg-preview', 'petal2-removebg-preview', 'petal3-removebg-preview',
    'petal4-removebg-preview', 'petal5-removebg-preview', 'petal6-removebg-preview',
  ];
  const w  = `${pos.scale * 100}%`;
  const ox = `${pos.originX}%`;
  const oy = `${pos.originY}%`;

  const mark = document.createElement('div');
  mark.className = 'mark';
  mark.dataset.state = 'idle';
  mark.setAttribute('aria-hidden', 'true');

  for (let i = 0; i < 3; i++) {
    const ring = document.createElement('span');
    ring.className = 'ring';
    mark.appendChild(ring);
  }

  const flower = document.createElement('div');
  flower.className = 'mark__flower';
  Object.assign(flower.style, { position: 'absolute', inset: '0', transformOrigin: `${ox} ${oy}` });

  for (const p of PETALS) {
    const img = document.createElement('img');
    img.className = 'mark__petal';
    img.src = `assets/${p}.png`;
    img.alt = '';
    Object.assign(img.style, {
      position: 'absolute', width: w, height: w,
      left: `${pos.offsetX}%`, top: `${pos.offsetY}%`,
      objectFit: 'contain', pointerEvents: 'none',
      transformOrigin: `${ox} ${oy}`,
    });
    flower.appendChild(img);
  }

  function resolveCenter(state: Status): CenterXY {
    const c = pos.center;
    if ('x' in c) return c as CenterXY;
    const map = c as Partial<Record<Status, CenterXY>>;
    return map[state] ?? map.idle ?? { x: pos.offsetX, y: pos.offsetY };
  }

  function applyCenterStyle(el: HTMLImageElement, cp: CenterXY, z: string): void {
    Object.assign(el.style, {
      position: 'absolute', width: w, height: w,
      left: `${cp.x}%`, top: `${cp.y}%`,
      objectFit: 'contain', pointerEvents: 'none',
      transformOrigin: `${ox} ${oy}`, zIndex: z,
    });
  }

  const core = document.createElement('img');
  core.className = 'mark__core';
  core.src = 'assets/center-removebg-preview.png';
  core.alt = '';
  applyCenterStyle(core, resolveCenter('idle'), '1');

  const face = document.createElement('img');
  face.src = 'assets/face-removebg-preview.png';
  face.alt = '';
  applyCenterStyle(face, resolveCenter('idle'), '2');

  flower.appendChild(core);
  flower.appendChild(face);
  mark.appendChild(flower);
  container.appendChild(mark);

  return function update(state: Status): void {
    mark.dataset.state = state;
    const cp = resolveCenter(state);
    applyCenterStyle(core, cp, '1');
    applyCenterStyle(face, cp, '2');
  };
}

// Instantiate the three marks
const updateWelcomeMark = createDaisyMark(document.getElementById('welcome-mark')!, POS_WELCOME);
const updateConvMark    = createDaisyMark(document.getElementById('conv-mark')!,    POS_CONV);
const updateGoodbyeMark = createDaisyMark(document.getElementById('goodbye-mark')!, POS_GOODBYE);

// ─── Language ────────────────────────────────────────────────────────────────

function c(): typeof COPY.en { return COPY[language]; }

function updateAllText(): void {
  const t = c();

  welcomeTitle.textContent   = t.welcomeTitle;
  welcomeLede.textContent    = t.welcomeLede;
  startLabel.textContent     = t.start;
  permNote.textContent       = t.micExplain;
  welcomeTagline.textContent = t.tagline;

  langEnBtn.setAttribute('aria-pressed', language === 'en' ? 'true' : 'false');
  langEsBtn.setAttribute('aria-pressed', language === 'es' ? 'true' : 'false');

  settingsBtn.setAttribute('aria-label', t.settings);
  settingsTitle.textContent  = t.settingsTitle;
  audioTestBtn.textContent   = t.playSound;
  endBtn.textContent         = t.endNow;
  settingsCloseBtn.textContent = t.close;

  goodbyeTitle.textContent = t.goodbye;
  goodbyeSub.textContent   = t.goodbyeSub;
  againBtn.textContent     = t.again;

  consentTitle.textContent = t.consentTitle;
  consentWhy.textContent   = t.consentWhy;
  consentYesBtn.textContent = t.consentYes;
  consentNoBtn.textContent  = t.consentNo;

  errMicTitle.textContent = t.errMicTitle;
  errMicBody.textContent  = t.errMicBody;

  daisyWhoEl.textContent   = t.daisy;
  youSaidLabel.textContent = t.youSaid;

  document.documentElement.lang = language;
  updateStateUI();
}

// ─── Daisy state UI ──────────────────────────────────────────────────────────

function heroLabels(): Record<Status, string> {
  const t = c();
  return { idle: t.statusIdle, listening: t.statusListening, thinking: t.statusThinking, speaking: t.statusSpeaking };
}
function heroStatuses(): Record<Status, string> {
  const t = c();
  return { idle: t.statusIdleHero, listening: t.statusListeningHero, thinking: t.statusThinkingHero, speaking: t.statusSpeakingHero };
}

function updateStateUI(): void {
  heroLabel.textContent   = heroLabels()[daisyState];
  heroStatus.textContent  = heroStatuses()[daisyState];
  statusDot.textContent   = heroLabels()[daisyState];
  statusDot.dataset.state = daisyState;
  micBarsWrap.classList.toggle('hidden', daisyState !== 'listening');
  renderActionBar();
}

function renderActionBar(): void {
  const t = c();
  actionPrimary.innerHTML = '';
  const micSvg  = `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/></svg>`;
  const stopSvg = `<svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`;

  const btn = document.createElement('button');
  if (daisyState === 'idle') {
    btn.className = 'btn btn--primary btn--xl';
    btn.innerHTML = micSvg + `<span>${t.talk}</span>`;
    btn.onclick = () => void startMic();
  } else if (daisyState === 'listening') {
    btn.className = 'btn btn--go btn--xl';
    btn.innerHTML = stopSvg + `<span>${t.stopTalking}</span>`;
    btn.onclick = () => stopMic();
  } else if (daisyState === 'thinking') {
    btn.className = 'btn btn--quiet btn--xl';
    btn.disabled = true;
    btn.setAttribute('aria-disabled', 'true');
    btn.textContent = t.statusThinking;
  } else {
    btn.className = 'btn btn--stop btn--xl';
    btn.innerHTML = stopSvg + `<span>${t.stopDaisy}</span>`;
    btn.onclick = () => send({ type: 'interrupt' });
  }
  actionPrimary.appendChild(btn);
}

// ─── Screen management ───────────────────────────────────────────────────────

function showScreen(screen: Screen): void {
  currentScreen = screen;
  const onWelcome = screen === 'welcome';
  const onStage   = screen === 'stage';
  const onGoodbye = screen === 'goodbye';

  screenWelcome.classList.toggle('hidden', !onWelcome);
  welcomeTagline.classList.toggle('hidden', !onWelcome);
  screenStage.classList.toggle('hidden', !onStage);
  screenActions.classList.toggle('hidden', !onStage);
  screenGoodbye.classList.toggle('hidden', !onGoodbye);
  settingsBtn.classList.toggle('hidden', !onStage);

  if (onStage) updateStateUI();
}

function startSession(): void {
  daisyCaption  = '';
  userTranscript = '';
  updateDaisyCaption();
  showScreen('stage');
  window.daisyAPI?.overlayShow?.();
}

function endSession(): void {
  stopMic();
  settingsSheet.classList.add('hidden');
  send({ type: 'end_session' });
  daisyState = 'idle';
  window.daisyAPI?.overlayHide?.();
  showScreen('goodbye');
}

function startOver(): void {
  daisyCaption  = '';
  userTranscript = '';
  daisyState = 'idle';
  showScreen('welcome');
}

// ─── Caption updates ─────────────────────────────────────────────────────────

function updateDaisyCaption(): void {
  // Clear any previous cursor span, then set text
  if (daisyCaption) {
    daisyTextEl.textContent = daisyCaption;
    if (daisyState === 'speaking') {
      const cursor = document.createElement('span');
      cursor.className = 'cursor';
      cursor.setAttribute('aria-hidden', 'true');
      daisyTextEl.appendChild(cursor);
    }
  } else {
    daisyTextEl.textContent = daisyState === 'idle' ? '—' : '…';
  }

  if (userTranscript) {
    youSaidWrap.classList.remove('hidden');
    youSaidText.textContent = `“${userTranscript}”`;
  } else {
    youSaidWrap.classList.add('hidden');
  }
}

// ─── State driver ────────────────────────────────────────────────────────────

function setDaisyState(state: Status): void {
  daisyState = state;
  updateConvMark(state);
  window.daisyAPI?.overlayState?.(state);
  if (currentScreen === 'stage') updateStateUI();
}

// ─── WebSocket ───────────────────────────────────────────────────────────────

function send(msg: ClientMsg): void {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function connect(): void {
  ws = new WebSocket(`${WS_BASE}/ws/${sessionId}`);
  ws.onopen  = () => send({ type: 'config', language });
  ws.onclose = () => setTimeout(connect, 3000);
  ws.onerror = () => { /* surfaced via onclose */ };
  ws.onmessage = (ev) => {
    let msg: ServerMsg;
    try { msg = JSON.parse(ev.data as string); } catch { return; }
    handleServerMsg(msg);
  };
}

function handleServerMsg(msg: ServerMsg): void {
  switch (msg.type) {
    case 'status':
      setDaisyState(msg.state);
      break;
    case 'transcript':
      userTranscript = msg.text;
      partialCaption = '';
      updateDaisyCaption();
      break;
    case 'daisy_text':
      if (msg.partial) {
        partialCaption += msg.text;
        daisyCaption = partialCaption;
      } else {
        daisyCaption   = msg.text;
        partialCaption = '';
      }
      updateDaisyCaption();
      break;
    case 'audio_chunk':
      playPcmChunk(msg.data);
      break;
    case 'audio_end':
      break;
    case 'screenshot_request':
      showConsentModal(msg.reason);
      break;
    case 'error':
      console.error('server error', msg.code, msg.message);
      break;
    case 'click_indicator':
    case 'clear_indicator':
      // Overlay rendering deferred; ignore for v1.
      break;
  }
}

// ─── Mic capture ─────────────────────────────────────────────────────────────

async function startMic(): Promise<void> {
  try {
    if (!micCtx) micCtx = new AudioContext({ sampleRate: 16000 });
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    micSource = micCtx.createMediaStreamSource(micStream);
    const bufferSize = 1600;
    micNode = micCtx.createScriptProcessor(bufferSize, 1, 1);
    micNode.onaudioprocess = (e) => {
      const float32 = e.inputBuffer.getChannelData(0);
      send({ type: 'audio_chunk', data: float32ToBase64Pcm16(float32), sequence: micSeq++ });
    };
    micSource.connect(micNode);
    micNode.connect(micCtx.destination);
    micActive = true;
    micDeniedBanner.classList.add('hidden');
  } catch (err) {
    console.error('startMic failed', err);
    micDeniedBanner.classList.remove('hidden');
    micActive = false;
  }
}

function stopMic(): void {
  if (micNode)   { try { micNode.disconnect(); }   catch {} micNode   = null; }
  if (micSource) { try { micSource.disconnect(); } catch {} micSource = null; }
  if (micStream) { micStream.getTracks().forEach((t) => t.stop()); micStream = null; }
  micActive = false;
}

// ─── Audio playback ───────────────────────────────────────────────────────────

function playPcmChunk(b64: string): void {
  if (!playbackCtx) {
    playbackCtx = new AudioContext({ sampleRate: 24000 });
    playbackTime = playbackCtx.currentTime;
  }
  const float32 = base64Pcm16ToFloat32(b64);
  const buffer  = playbackCtx.createBuffer(1, float32.length, 24000);
  buffer.getChannelData(0).set(float32);
  const src = playbackCtx.createBufferSource();
  src.buffer = buffer;
  src.connect(playbackCtx.destination);
  const startAt = Math.max(playbackCtx.currentTime, playbackTime);
  src.start(startAt);
  playbackTime = startAt + buffer.duration;
}

// ─── Screenshot consent ───────────────────────────────────────────────────────

function showConsentModal(reason?: string): void {
  const t = c();
  consentTitle.textContent   = t.consentTitle;
  consentWhy.textContent     = t.consentWhy;
  consentYesBtn.textContent  = t.consentYes;
  consentNoBtn.textContent   = t.consentNo;
  const who = language === 'en' ? 'Daisy says: ' : 'Daisy dice: ';
  consentReason.innerHTML    = `<strong style="font-family:Fraunces,serif;font-weight:600">${who}</strong>“${reason ?? ''}”`;
  consentModal.classList.remove('hidden');
  consentYesBtn.focus();
}

consentYesBtn.onclick = async () => {
  consentModal.classList.add('hidden');
  await captureAndSendScreen();
};
consentNoBtn.onclick = () => consentModal.classList.add('hidden');

async function captureAndSendScreen(): Promise<void> {
  const result = await window.daisyAPI.captureScreen();
  if ('error' in result) { console.error('screen capture failed', result.error); return; }
  send({ type: 'screenshot', data: result.pngBase64 });
}

// ─── UI event wiring ─────────────────────────────────────────────────────────

startBtn.onclick  = () => startSession();
againBtn.onclick  = () => startOver();
endBtn.onclick    = () => endSession();

langEnBtn.onclick = () => { language = 'en'; send({ type: 'language_change', language }); updateAllText(); };
langEsBtn.onclick = () => { language = 'es'; send({ type: 'language_change', language }); updateAllText(); };

settingsBtn.onclick      = () => settingsSheet.classList.toggle('hidden');
settingsCloseBtn.onclick = () => settingsSheet.classList.add('hidden');

fontSmallerBtn.onclick = () => {
  fontScale = Math.max(0.85, +(fontScale - 0.1).toFixed(2));
  document.documentElement.style.setProperty('--scale', String(fontScale));
};
fontLargerBtn.onclick = () => {
  fontScale = Math.min(1.6, +(fontScale + 0.1).toFixed(2));
  document.documentElement.style.setProperty('--scale', String(fontScale));
};

audioTestBtn.onclick = () => { /* play a friendly beep in a future update */ };

// ─── Auto-update ─────────────────────────────────────────────────────────────

window.daisyAPI?.onUpdateReady?.((info) => {
  updateBadge.classList.remove('hidden');
  updateBadge.textContent = `Update v${info.version} ready — click to restart`;
  updateBadge.onclick = () => window.daisyAPI.quitAndInstall();
});

// ─── Init ─────────────────────────────────────────────────────────────────────

updateAllText();
showScreen('welcome');
connect();
