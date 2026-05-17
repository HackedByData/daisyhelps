import { float32ToBase64Pcm16, base64Pcm16ToFloat32 } from './audio-utils.js';
import type { ClientMsg, ServerMsg, Language, Status } from './types.js';

// Base URL: prod by default, override with localhost via env at dev time
const WS_BASE = 'wss://api.daisyhelps.com';

const sessionId = crypto.randomUUID();

// DOM refs
const statusPill = document.getElementById('status-pill') as HTMLDivElement;
const captions = document.getElementById('captions') as HTMLDivElement;
const micBtn = document.getElementById('mic-btn') as HTMLButtonElement;
const screenBtn = document.getElementById('screen-btn') as HTMLButtonElement;
const stopBtn = document.getElementById('stop-btn') as HTMLButtonElement;
const langToggle = document.getElementById('lang-toggle') as HTMLDivElement;
const updateBadge = document.getElementById('update-badge') as HTMLSpanElement;

// State
let ws: WebSocket | null = null;
let language: Language = 'en';
let micActive = false;
let micStream: MediaStream | null = null;
let micCtx: AudioContext | null = null;
let micSource: MediaStreamAudioSourceNode | null = null;
let micNode: ScriptProcessorNode | null = null;
let micSeq = 0;
let playbackCtx: AudioContext | null = null;
let playbackTime = 0;
let partialCaption = '';

function send(msg: ClientMsg): void {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function setStatus(s: Status | 'connecting' | 'offline'): void {
  statusPill.textContent = ({
    connecting: 'Connecting…',
    offline: 'Offline',
    idle: 'Ready',
    listening: 'Listening',
    thinking: 'Thinking',
    speaking: 'Speaking',
  } as Record<string, string>)[s];
  statusPill.className = 'status-pill';
  if (s === 'listening' || s === 'thinking' || s === 'speaking') {
    statusPill.classList.add(s);
  }
}

function setButtonsEnabled(connected: boolean): void {
  micBtn.disabled = !connected;
  screenBtn.disabled = !connected;
  stopBtn.disabled = !connected;
}

function connect(): void {
  setStatus('connecting');
  setButtonsEnabled(false);
  ws = new WebSocket(`${WS_BASE}/ws/${sessionId}`);
  ws.onopen = () => {
    send({ type: 'config', language });
    setStatus('idle');
    setButtonsEnabled(true);
  };
  ws.onclose = () => {
    setStatus('offline');
    setButtonsEnabled(false);
    stopMic();
    // Auto-reconnect after 3s
    setTimeout(connect, 3000);
  };
  ws.onerror = () => { /* surfaced via onclose */ };
  ws.onmessage = (ev) => {
    let msg: ServerMsg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    handleServerMsg(msg);
  };
}

function handleServerMsg(msg: ServerMsg): void {
  switch (msg.type) {
    case 'status':
      setStatus(msg.state);
      break;
    case 'transcript':
      // Briefly flash the user's words in captions before Daisy replies
      captions.textContent = `You: ${msg.text}`;
      partialCaption = '';
      break;
    case 'daisy_text':
      if (msg.partial) {
        partialCaption += msg.text;
        captions.textContent = partialCaption;
      } else {
        captions.textContent = msg.text;
        partialCaption = '';
      }
      break;
    case 'audio_chunk':
      playPcmChunk(msg.data);
      break;
    case 'audio_end':
      // playback queue drains itself
      break;
    case 'screenshot_request':
      void captureAndSendScreen();
      break;
    case 'error':
      console.error('server error', msg.code, msg.message);
      break;
    case 'click_indicator':
    case 'clear_indicator':
      // Overlay rendering deferred to a later task; ignore for v1.
      break;
  }
}

// --- Mic capture ---

async function startMic(): Promise<void> {
  try {
    if (!micCtx) micCtx = new AudioContext({ sampleRate: 16000 });
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    micSource = micCtx.createMediaStreamSource(micStream);
    const bufferSize = 1600;  // 100ms at 16kHz
    micNode = micCtx.createScriptProcessor(bufferSize, 1, 1);
    micNode.onaudioprocess = (e) => {
      const float32 = e.inputBuffer.getChannelData(0);
      const data = float32ToBase64Pcm16(float32);
      send({ type: 'audio_chunk', data, sequence: micSeq++ });
    };
    micSource.connect(micNode);
    micNode.connect(micCtx.destination);
    micActive = true;
    micBtn.classList.add('active');
    micBtn.querySelector('.label')!.textContent = 'Stop talking';
  } catch (err) {
    console.error('startMic failed', err);
    captions.textContent = 'Could not access the microphone. Check Windows microphone settings, then try again.';
    micActive = false;
    micBtn.classList.remove('active');
    micBtn.querySelector('.label')!.textContent = 'Start talking';
  }
}

function stopMic(): void {
  if (micNode) { try { micNode.disconnect(); } catch {} micNode = null; }
  if (micSource) { try { micSource.disconnect(); } catch {} micSource = null; }
  if (micStream) { micStream.getTracks().forEach((t) => t.stop()); micStream = null; }
  micActive = false;
  micBtn.classList.remove('active');
  micBtn.querySelector('.label')!.textContent = 'Start talking';
}

// --- Audio playback ---

function playPcmChunk(b64: string): void {
  if (!playbackCtx) {
    playbackCtx = new AudioContext({ sampleRate: 24000 });
    playbackTime = playbackCtx.currentTime;
  }
  const float32 = base64Pcm16ToFloat32(b64);
  const buffer = playbackCtx.createBuffer(1, float32.length, 24000);
  buffer.getChannelData(0).set(float32);
  const src = playbackCtx.createBufferSource();
  src.buffer = buffer;
  src.connect(playbackCtx.destination);
  const startAt = Math.max(playbackCtx.currentTime, playbackTime);
  src.start(startAt);
  playbackTime = startAt + buffer.duration;
}

// --- Screen capture (wired in Task 6) ---

async function captureAndSendScreen(): Promise<void> {
  const result = await window.daisyAPI.captureScreen();
  if ('error' in result) {
    console.error('screen capture failed', result.error);
    return;
  }
  send({ type: 'screenshot', data: result.pngBase64 });
}

// --- UI events ---

micBtn.onclick = () => {
  if (micActive) { stopMic(); }
  else { void startMic(); }
};

screenBtn.onclick = () => { void captureAndSendScreen(); };

stopBtn.onclick = () => { send({ type: 'interrupt' }); };

langToggle.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (!target.classList.contains('lang-btn')) return;
  const next = target.dataset.lang as Language;
  if (next === language) return;
  language = next;
  langToggle.querySelectorAll('.lang-btn').forEach((b) => b.classList.remove('active'));
  target.classList.add('active');
  send({ type: 'language_change', language });
});

window.daisyAPI?.onUpdateReady?.((info) => {
  updateBadge.classList.remove('hidden');
  updateBadge.textContent = `Update v${info.version} ready — click to restart`;
  updateBadge.style.cursor = 'pointer';
  updateBadge.onclick = () => window.daisyAPI.quitAndInstall();
});

connect();
