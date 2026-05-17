# Daisy Helps Desktop Pivot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Daisy Helps as a downloadable Windows desktop app distributed via `daisyhelps.com`, while the existing backend at `api.daisyhelps.com` stays untouched.

**Architecture:** New `desktop/` Electron+TypeScript app ports the existing `test_harness/test_page.html` logic into a production client; adds native screen capture via `desktopCapturer`, system-tray support, and auto-update from GitHub Releases. New `landing/` static site (served from a Render Static Site at `daisyhelps.com`) hosts a "Download for Windows" CTA that redirects to the latest GitHub Release asset. CI workflow builds the installer on `v*` tags. Backend is unchanged; both sides speak the existing protocol in `docs/API.md`.

**Tech Stack:** Electron 32+, TypeScript 5+, electron-builder, electron-updater, Node 20+, GitHub Actions (`windows-latest`), Render Static Sites. Backend stays Python 3.11 + FastAPI as-is.

**Spec:** `docs/superpowers/specs/2026-05-16-daisy-helps-desktop-pivot-design.md`

**Notes for executor:**
- TDD does not fit Electron main-process or DOM-renderer code well. Where this plan calls for tests, they target pure logic (PCM encoding, message-type guards) that can run in Node without a window. UI and IPC tasks specify exact manual verification steps with expected outputs.
- All commands assume PowerShell on Windows (matches the dev machine in `CLAUDE.md`). Equivalent bash is in parentheses when meaningfully different.
- The repo root is `C:\Users\devin\DaisyHelps\daisyhelps\`. Tasks use relative paths.
- Commit prefixes: `desktop:` for desktop app, `landing:` for landing page, `ci:` for workflows, `docs:` for docs, `phase-6:` for the final readiness bump.
- Do NOT `git add -A`; stage by explicit path. The repo root has untracked `.env`, `rosa-claude-code-prompt.md`, and `elevenlabs-voice-prompt.md` that must stay untracked.

---

## Task 1: Scaffold the `desktop/` Electron + TypeScript project

**Files:**
- Create: `desktop/.gitignore`
- Create: `desktop/package.json`
- Create: `desktop/tsconfig.json`
- Create: `desktop/tsconfig.renderer.json`
- Create: `desktop/src/main.ts`
- Create: `desktop/src/preload.ts`
- Create: `desktop/src/renderer/index.html`

- [ ] **Step 1: Create `desktop/.gitignore`**

```
node_modules/
dist/
out/
release/
*.log
.DS_Store
```

- [ ] **Step 2: Create `desktop/package.json`**

```json
{
  "name": "daisyhelps-desktop",
  "version": "0.1.0",
  "private": true,
  "description": "Daisy Helps desktop app (Electron)",
  "author": "Daisy Helps",
  "main": "dist/main.js",
  "scripts": {
    "build:main": "tsc -p tsconfig.json",
    "build:renderer": "tsc -p tsconfig.renderer.json && copyfiles -u 2 \"src/renderer/**/*.{html,css}\" dist/renderer",
    "build": "npm run build:main && npm run build:renderer",
    "start": "npm run build && electron .",
    "dev": "npm run build && electron . --enable-logging",
    "release": "npm run build && electron-builder --win --publish never",
    "release:publish": "npm run build && electron-builder --win --publish always"
  },
  "dependencies": {
    "electron-updater": "^6.3.9"
  },
  "devDependencies": {
    "@types/node": "^22.7.4",
    "copyfiles": "^2.4.1",
    "electron": "^32.1.2",
    "electron-builder": "^25.1.7",
    "typescript": "^5.6.2"
  }
}
```

- [ ] **Step 3: Create `desktop/tsconfig.json` (main + preload)**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "node",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/main.ts", "src/preload.ts"],
  "exclude": ["src/renderer"]
}
```

- [ ] **Step 4: Create `desktop/tsconfig.renderer.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2020",
    "moduleResolution": "node",
    "outDir": "dist/renderer",
    "rootDir": "src/renderer",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "lib": ["ES2022", "DOM"],
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/renderer/**/*.ts"]
}
```

- [ ] **Step 5: Create minimal `desktop/src/main.ts`**

```typescript
import { app, BrowserWindow } from 'electron';
import path from 'node:path';

function createWindow(): void {
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 640,
    minHeight: 480,
    title: 'Daisy Helps',
    backgroundColor: '#fdf7ec',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

- [ ] **Step 6: Create minimal `desktop/src/preload.ts`**

```typescript
import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('daisyAPI', {
  // Filled in by later tasks.
});
```

- [ ] **Step 7: Create placeholder `desktop/src/renderer/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Daisy Helps</title>
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'self' wss://api.daisyhelps.com ws://localhost:8000; media-src 'self' blob:; script-src 'self'; style-src 'self' 'unsafe-inline';" />
    <style>
      body { font-family: -apple-system, system-ui, sans-serif; padding: 40px; }
    </style>
  </head>
  <body>
    <h1>Daisy Helps</h1>
    <p>Hello from Electron. Real UI lands in Task 3.</p>
  </body>
</html>
```

- [ ] **Step 8: Install deps and verify the window opens**

Run (from `desktop/`):
```powershell
cd desktop
npm install
npm start
```
Expected: An Electron window titled "Daisy Helps" opens, shows "Hello from Electron." No errors in the terminal. Close the window; the process exits.

- [ ] **Step 9: Commit**

```powershell
git add desktop/.gitignore desktop/package.json desktop/package-lock.json desktop/tsconfig.json desktop/tsconfig.renderer.json desktop/src/main.ts desktop/src/preload.ts desktop/src/renderer/index.html
git commit -m "desktop: scaffold Electron + TypeScript project with hello-world window"
```

---

## Task 2: Wire-message TypeScript types matching `docs/API.md`

Strict typing for every WebSocket message the renderer will send or receive. This is the renderer's contract with the backend — keep in lockstep with `docs/API.md`.

**Files:**
- Create: `desktop/src/renderer/types.ts`

- [ ] **Step 1: Create `desktop/src/renderer/types.ts`**

```typescript
// Wire types — keep in sync with docs/API.md.

export type Language = 'en' | 'es';
export type Status = 'idle' | 'listening' | 'thinking' | 'speaking';

// Client → server
export interface ConfigMsg { type: 'config'; language: Language; }
export interface AudioChunkClientMsg { type: 'audio_chunk'; data: string; sequence: number; }
export interface UserTextMsg { type: 'user_text'; text: string; }
export interface ScreenshotMsg { type: 'screenshot'; data: string; }
export interface InterruptMsg { type: 'interrupt'; }
export interface LanguageChangeMsg { type: 'language_change'; language: Language; }
export interface EndSessionMsg { type: 'end_session'; }
export type ClientMsg =
  | ConfigMsg | AudioChunkClientMsg | UserTextMsg | ScreenshotMsg
  | InterruptMsg | LanguageChangeMsg | EndSessionMsg;

// Server → client
export interface StatusMsg { type: 'status'; state: Status; }
export interface TranscriptMsg { type: 'transcript'; text: string; final: boolean; }
export interface DaisyTextMsg { type: 'daisy_text'; text: string; partial: boolean; }
export interface AudioChunkServerMsg { type: 'audio_chunk'; data: string; sequence: number; }
export interface AudioEndMsg { type: 'audio_end'; }
export interface ScreenshotRequestMsg { type: 'screenshot_request'; reason?: string; }
export interface ClickIndicatorMsg {
  type: 'click_indicator';
  x: number; y: number;
  ref_width: number; ref_height: number;
  label: string; confidence: number | null;
}
export interface ClearIndicatorMsg { type: 'clear_indicator'; }
export type ServerErrorCode =
  | 'bad_session_id' | 'bad_message' | 'not_yet_implemented'
  | 'stt_failed' | 'llm_failed' | 'tts_failed'
  | 'screenshot_invalid' | 'turn_failed';
export interface ErrorMsg { type: 'error'; code: ServerErrorCode; message: string; }
export type ServerMsg =
  | StatusMsg | TranscriptMsg | DaisyTextMsg
  | AudioChunkServerMsg | AudioEndMsg
  | ScreenshotRequestMsg | ClickIndicatorMsg | ClearIndicatorMsg
  | ErrorMsg;

// Preload-exposed API surface
export interface DaisyAPI {
  captureScreen(): Promise<{ pngBase64: string } | { error: string }>;
  onUpdateReady(cb: (info: { version: string }) => void): void;
  quitAndInstall(): void;
}

declare global {
  interface Window {
    daisyAPI: DaisyAPI;
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run (from `desktop/`):
```powershell
npm run build:renderer
```
Expected: `dist/renderer/types.js` exists, no TS errors.

- [ ] **Step 3: Commit**

```powershell
git add desktop/src/renderer/types.ts
git commit -m "desktop: add wire-message TypeScript types matching docs/API.md"
```

---

## Task 3: Build the renderer UI shell — HTML + CSS

Production UI optimized for elderly users: large fonts, high contrast, three big buttons (mic, show-screen, stop). The session ID is auto-generated; no connection inputs.

**Files:**
- Modify: `desktop/src/renderer/index.html` (replace placeholder)
- Create: `desktop/src/renderer/styles.css`

- [ ] **Step 1: Replace `desktop/src/renderer/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Daisy Helps</title>
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'self' wss://api.daisyhelps.com ws://localhost:8000; media-src 'self' blob:; img-src 'self' data: blob:; script-src 'self'; style-src 'self' 'unsafe-inline';" />
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <header class="topbar">
      <div class="brand">Daisy Helps</div>
      <div class="lang-toggle" id="lang-toggle">
        <button class="lang-btn active" data-lang="en">EN</button>
        <button class="lang-btn" data-lang="es">ES</button>
      </div>
    </header>

    <main class="stage">
      <div class="status-pill" id="status-pill">Connecting…</div>

      <div class="captions" id="captions" aria-live="polite"></div>

      <div class="actions">
        <button id="mic-btn" class="big-btn mic" disabled>
          <span class="icon">🎙</span>
          <span class="label">Start talking</span>
        </button>
        <button id="screen-btn" class="big-btn screen" disabled>
          <span class="icon">🖥</span>
          <span class="label">Show Daisy my screen</span>
        </button>
        <button id="stop-btn" class="big-btn stop" disabled>
          <span class="icon">✋</span>
          <span class="label">Stop Daisy</span>
        </button>
      </div>
    </main>

    <footer class="footer">
      <span id="update-badge" class="hidden">Update ready — restart to install</span>
      <span class="version">v0.1.0</span>
    </footer>

    <script type="module" src="app.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Create `desktop/src/renderer/styles.css`**

```css
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; height: 100%; }

body {
  font-family: -apple-system, "Segoe UI", system-ui, sans-serif;
  background: #fdf7ec;
  color: #2d2114;
  display: flex; flex-direction: column;
  min-height: 100vh;
  font-size: 18px;
}

.topbar {
  display: flex; justify-content: space-between; align-items: center;
  padding: 12px 24px; border-bottom: 1px solid #ebe0c8;
}
.brand { font-size: 22px; font-weight: 700; }
.lang-toggle { display: flex; gap: 4px; }
.lang-btn {
  font-size: 14px; padding: 6px 12px;
  background: transparent; border: 1px solid #ebe0c8; border-radius: 8px;
  cursor: pointer; color: #6b5a3e;
}
.lang-btn.active { background: #e8a838; color: #2d2114; border-color: #e8a838; }

.stage {
  flex: 1; display: flex; flex-direction: column; align-items: center;
  padding: 32px 24px; gap: 24px;
}

.status-pill {
  padding: 6px 16px; border-radius: 999px;
  background: #ebe0c8; color: #6b5a3e; font-size: 14px;
}
.status-pill.listening { background: #c8e6c9; color: #1b5e20; }
.status-pill.thinking { background: #fff3c4; color: #7a5d00; }
.status-pill.speaking { background: #bbdefb; color: #0d47a1; }

.captions {
  width: 100%; max-width: 720px; min-height: 120px;
  padding: 20px; border-radius: 12px;
  background: #ffffff; border: 1px solid #ebe0c8;
  font-size: 22px; line-height: 1.5;
  white-space: pre-wrap;
}

.actions { display: flex; flex-direction: column; gap: 16px; width: 100%; max-width: 480px; }
.big-btn {
  display: flex; align-items: center; justify-content: center; gap: 16px;
  padding: 24px; border-radius: 16px; border: none;
  font-size: 22px; font-weight: 600; cursor: pointer;
  transition: transform 0.05s, box-shadow 0.05s;
}
.big-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.big-btn .icon { font-size: 32px; }
.big-btn.mic { background: #e8a838; color: #2d2114; }
.big-btn.mic.active { background: #c8e6c9; color: #1b5e20; }
.big-btn.screen { background: #bbdefb; color: #0d47a1; }
.big-btn.stop { background: #ffcdd2; color: #b71c1c; }
.big-btn:not(:disabled):hover { box-shadow: 0 4px 12px rgba(0,0,0,0.08); }
.big-btn:not(:disabled):active { transform: translateY(1px); }

.footer {
  padding: 8px 24px; border-top: 1px solid #ebe0c8;
  display: flex; justify-content: space-between; align-items: center;
  font-size: 12px; color: #6b5a3e;
}
#update-badge { color: #1b5e20; font-weight: 600; }
.hidden { display: none; }
```

- [ ] **Step 3: Verify the placeholder app still launches**

Run (from `desktop/`):
```powershell
npm start
```
Expected: A window opens with the new layout — brand on top-left, EN/ES toggle on top-right, "Connecting…" status pill, empty captions area, three large buttons all disabled (since `app.ts` isn't wired yet), "v0.1.0" in the footer. No console errors yet — the missing `app.js` will be added next task; for now the UI loads but is non-interactive.

- [ ] **Step 4: Commit**

```powershell
git add desktop/src/renderer/index.html desktop/src/renderer/styles.css
git commit -m "desktop: build production UI shell (HTML + CSS) for elderly users"
```

---

## Task 4: Pure audio utilities — PCM encode/decode (TDD)

These are the only purely testable pieces of the renderer logic. Extract them so we can verify them in Node without an Electron window.

**Files:**
- Create: `desktop/src/renderer/audio-utils.ts`
- Create: `desktop/tests/audio-utils.test.mjs`
- Modify: `desktop/package.json` (add `test` script and `vitest` dep)

- [ ] **Step 1: Add vitest dep to `desktop/package.json`**

In `desktop/package.json`, add to `devDependencies`:
```json
"vitest": "^2.1.4"
```
And add to `scripts`:
```json
"test": "vitest run"
```

Run:
```powershell
cd desktop
npm install
```

- [ ] **Step 2: Write the failing test at `desktop/tests/audio-utils.test.mjs`**

```javascript
import { describe, it, expect } from 'vitest';
import { float32ToBase64Pcm16, base64Pcm16ToFloat32 } from '../src/renderer/audio-utils.ts';

describe('float32ToBase64Pcm16', () => {
  it('round-trips silence', () => {
    const input = new Float32Array(160);  // 10ms at 16kHz
    const b64 = float32ToBase64Pcm16(input);
    const out = base64Pcm16ToFloat32(b64);
    expect(out.length).toBe(input.length);
    for (let i = 0; i < out.length; i++) expect(out[i]).toBe(0);
  });

  it('clamps and quantizes a sine sample correctly', () => {
    const input = new Float32Array([0, 0.5, -0.5, 1.0, -1.0, 1.5, -1.5]);
    const b64 = float32ToBase64Pcm16(input);
    const out = base64Pcm16ToFloat32(b64);
    expect(out[0]).toBe(0);
    expect(out[1]).toBeCloseTo(0.5, 3);
    expect(out[2]).toBeCloseTo(-0.5, 3);
    expect(out[3]).toBeCloseTo(1.0, 3);
    expect(out[4]).toBeCloseTo(-1.0, 3);
    expect(out[5]).toBeCloseTo(1.0, 3);   // clamped
    expect(out[6]).toBeCloseTo(-1.0, 3);  // clamped
  });
});
```

- [ ] **Step 3: Run the test and verify it fails**

Run (from `desktop/`):
```powershell
npm test
```
Expected: FAIL with "Cannot find module '../src/renderer/audio-utils.ts'".

- [ ] **Step 4: Create `desktop/src/renderer/audio-utils.ts`**

```typescript
// PCM audio encoding utilities shared between mic capture and tests.

export function float32ToBase64Pcm16(input: Float32Array): string {
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

export function base64Pcm16ToFloat32(b64: string): Float32Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const int16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;
  return float32;
}
```

- [ ] **Step 5: Run the test and verify it passes**

Run (from `desktop/`):
```powershell
npm test
```
Expected: PASS, 2 tests, 0 failures.

- [ ] **Step 6: Commit**

```powershell
git add desktop/package.json desktop/package-lock.json desktop/src/renderer/audio-utils.ts desktop/tests/audio-utils.test.mjs
git commit -m "desktop: pure PCM encode/decode utilities with vitest coverage"
```

---

## Task 5: Renderer app — WebSocket, mic capture, audio playback, UI wiring

The heart of the client. Ports the proven logic from `test_harness/test_page.html` into a typed, production-shaped module.

**Files:**
- Create: `desktop/src/renderer/app.ts`

- [ ] **Step 1: Create `desktop/src/renderer/app.ts`**

```typescript
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

window.daisyAPI?.onUpdateReady?.((_info) => {
  updateBadge.classList.remove('hidden');
});

connect();
```

- [ ] **Step 2: Verify it compiles**

Run (from `desktop/`):
```powershell
npm run build
```
Expected: `dist/renderer/app.js`, `dist/renderer/audio-utils.js`, `dist/renderer/types.js`, `dist/renderer/index.html`, `dist/renderer/styles.css` all exist.

- [ ] **Step 3: Verify the launched app connects to the live backend**

Pre-req: `api.daisyhelps.com/healthz` returns `{"status":"ok"}` (or temporarily change `WS_BASE` to `ws://localhost:8000` and run `uvicorn backend.main:app --port 8000` in a second terminal).

Run (from `desktop/`):
```powershell
npm start
```

Expected:
- Status pill cycles "Connecting…" → "Ready"
- Three buttons enable (no longer grayed)
- Click "Start talking", grant mic permission, speak "Hello Daisy"
- Status cycles Listening → Thinking → Speaking
- Captions show your transcript briefly, then Daisy's reply word-by-word
- You hear Daisy's voice through the speakers
- Click "Stop Daisy" mid-response; audio cuts within ~200ms
- Click EN/ES toggle, speak again; voice switches language

If the screen-capture button is clicked, expect a console error `"window.daisyAPI.captureScreen is not a function"` — that's wired in Task 6.

- [ ] **Step 4: Commit**

```powershell
git add desktop/src/renderer/app.ts
git commit -m "desktop: WebSocket client, mic capture, audio playback, UI wiring"
```

---

## Task 6: Native screen capture via `desktopCapturer`

Replace the file-picker flow with a one-click OS-native screen grab. Multi-monitor users get a picker; single-monitor users get instant capture.

**Files:**
- Modify: `desktop/src/main.ts`
- Modify: `desktop/src/preload.ts`
- Create: `desktop/src/screen-picker.html` (used only on multi-monitor)

- [ ] **Step 1: Add IPC + desktopCapturer handler in `desktop/src/main.ts`**

Replace the entire `desktop/src/main.ts` with:

```typescript
import { app, BrowserWindow, desktopCapturer, ipcMain, screen, session } from 'electron';
import path from 'node:path';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 640,
    minHeight: 480,
    title: 'Daisy Helps',
    backgroundColor: '#fdf7ec',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  // Grant mic permission to the renderer once at startup
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    if (permission === 'media') return callback(true);
    callback(false);
  });

  // IPC: captureScreen
  ipcMain.handle('daisy:captureScreen', async () => {
    try {
      const displays = screen.getAllDisplays();
      const primary = screen.getPrimaryDisplay();
      const targetSize = primary.size;
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: targetSize.width, height: targetSize.height },
      });
      if (sources.length === 0) return { error: 'no screen sources available' };

      let chosen = sources[0];
      if (sources.length > 1 && displays.length > 1) {
        chosen = await pickScreen(sources);
      }
      const png = chosen.thumbnail.toPNG();
      return { pngBase64: png.toString('base64') };
    } catch (err) {
      return { error: String(err) };
    }
  });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// --- Multi-monitor picker ---

async function pickScreen(
  sources: Electron.DesktopCapturerSource[],
): Promise<Electron.DesktopCapturerSource> {
  return new Promise((resolve) => {
    const picker = new BrowserWindow({
      width: 720,
      height: 480,
      modal: true,
      parent: mainWindow ?? undefined,
      title: 'Choose a screen',
      backgroundColor: '#fdf7ec',
      // Picker uses require('electron') inline; needs nodeIntegration on.
      // The main renderer that talks to the network stays sandboxed.
      webPreferences: { contextIsolation: false, nodeIntegration: true },
    });
    picker.loadFile(path.join(__dirname, 'screen-picker.html'));
    picker.webContents.once('did-finish-load', () => {
      const payload = sources.map((s, i) => ({
        index: i,
        name: s.name,
        thumbnail: s.thumbnail.toDataURL(),
      }));
      picker.webContents.send('picker:sources', payload);
    });
    ipcMain.handleOnce('picker:choose', (_e, index: number) => {
      picker.close();
      resolve(sources[index]);
      return null;
    });
    picker.on('closed', () => {
      // Fallback: if user closes without choosing, resolve to first source
      resolve(sources[0]);
    });
  });
}
```

- [ ] **Step 2: Expose `captureScreen` from `desktop/src/preload.ts`**

Replace `desktop/src/preload.ts` with:

```typescript
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('daisyAPI', {
  captureScreen: () => ipcRenderer.invoke('daisy:captureScreen') as Promise<{ pngBase64: string } | { error: string }>,
  onUpdateReady: (cb: (info: { version: string }) => void) => {
    ipcRenderer.on('daisy:update-ready', (_e, info) => cb(info));
  },
  quitAndInstall: () => ipcRenderer.send('daisy:quit-and-install'),
});
```

- [ ] **Step 3: Create the multi-monitor picker page `desktop/src/screen-picker.html`**

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Choose a screen</title>
    <style>
      body { font-family: -apple-system, "Segoe UI", system-ui, sans-serif; background: #fdf7ec; padding: 16px; margin: 0; }
      h1 { font-size: 18px; margin: 0 0 12px; }
      .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
      .card { background: #fff; border: 2px solid #ebe0c8; border-radius: 8px; padding: 8px; cursor: pointer; text-align: center; }
      .card:hover { border-color: #e8a838; }
      img { width: 100%; height: auto; border-radius: 4px; display: block; }
      .name { font-size: 14px; margin-top: 6px; color: #2d2114; }
    </style>
  </head>
  <body>
    <h1>Choose which screen to show Daisy</h1>
    <div id="grid" class="grid"></div>
    <script>
      const { ipcRenderer } = require('electron');
      ipcRenderer.on('picker:sources', (_e, sources) => {
        const grid = document.getElementById('grid');
        sources.forEach((s) => {
          const card = document.createElement('div');
          card.className = 'card';
          card.innerHTML = `<img src="${s.thumbnail}" alt="${s.name}"/><div class="name">${s.name}</div>`;
          card.onclick = () => ipcRenderer.invoke('picker:choose', s.index);
          grid.appendChild(card);
        });
      });
    </script>
  </body>
</html>
```

Picker uses `nodeIntegration` implicitly via require — for v1 that's fine on a trusted local file. The renderer that talks to the network is sandboxed; this small picker is not.

- [ ] **Step 4: Make the build copy `screen-picker.html` into `dist/`**

Modify `desktop/package.json` `build:renderer` script:
```json
"build:renderer": "tsc -p tsconfig.renderer.json && copyfiles -u 2 \"src/renderer/**/*.{html,css}\" dist/renderer && copyfiles -u 1 \"src/screen-picker.html\" dist"
```

- [ ] **Step 5: Verify build + single-monitor capture**

Run (from `desktop/`):
```powershell
npm start
```
- Click "Show Daisy my screen" with no console error
- Within ~1s, captions show Daisy referencing your screen ("I see your email inbox…" or similar)
- If you have multiple monitors, the picker window appears; choose one; same result

If you have only one monitor, the picker code path is exercised on a second monitor connect — re-test then.

- [ ] **Step 6: Commit**

```powershell
git add desktop/src/main.ts desktop/src/preload.ts desktop/src/screen-picker.html desktop/package.json
git commit -m "desktop: native one-click screen capture via desktopCapturer"
```

---

## Task 7: System tray + minimize-to-tray on window close

**Files:**
- Modify: `desktop/src/main.ts`
- Create: `desktop/build/tray-icon.png` (16×16 and 32×32 multi-resolution; placeholder OK)

- [ ] **Step 1: Add a placeholder tray icon**

Create `desktop/build/tray-icon.png` as a 32×32 RGBA PNG. For v1, any solid-color daisy-yellow square works. If you have ImageMagick:
```powershell
magick -size 32x32 xc:"#e8a838" desktop/build/tray-icon.png
```
Otherwise, create one in any image editor and save as `desktop/build/tray-icon.png`. Real branded icon is a designer pass (tracked in TODO).

- [ ] **Step 2: Add tray to `desktop/src/main.ts`**

Add imports at the top:
```typescript
import { app, BrowserWindow, desktopCapturer, ipcMain, Menu, screen, session, Tray } from 'electron';
```

Add module-level state near `let mainWindow`:
```typescript
let tray: Tray | null = null;
let quittingForReal = false;
```

Add a `createTray()` function before `app.whenReady()`:
```typescript
function createTray(): void {
  tray = new Tray(path.join(__dirname, '..', 'build', 'tray-icon.png'));
  tray.setToolTip('Daisy Helps');
  const menu = Menu.buildFromTemplate([
    { label: 'Show Daisy', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { label: 'Hide Daisy', click: () => mainWindow?.hide() },
    { type: 'separator' },
    { label: 'Quit', click: () => { quittingForReal = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => {
    if (mainWindow?.isVisible()) mainWindow.hide();
    else { mainWindow?.show(); mainWindow?.focus(); }
  });
}
```

Update `createWindow()` so the close button hides instead of quitting:
```typescript
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 640,
    minHeight: 480,
    title: 'Daisy Helps',
    backgroundColor: '#fdf7ec',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.on('close', (e) => {
    if (!quittingForReal) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}
```

Call `createTray()` inside `app.whenReady().then(...)` right before `createWindow()`:
```typescript
app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler(/* unchanged */);
  ipcMain.handle('daisy:captureScreen', /* unchanged */);

  createTray();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
```

Remove the old `app.on('window-all-closed', ...)` block at the bottom — with tray-as-quit-target the app shouldn't quit just because the window closed:
```typescript
// (deleted: app.on('window-all-closed', ...))
```

Add a final cleanup so the tray icon doesn't leak on quit:
```typescript
app.on('before-quit', () => { quittingForReal = true; });
```

- [ ] **Step 3: Verify tray behavior**

Run (from `desktop/`):
```powershell
npm start
```
- Daisy icon appears in the Windows system tray (bottom-right notification area; may be hidden under the `^` arrow)
- Click X on the window → window hides, tray icon stays, app keeps running
- Click tray icon → window reappears
- Right-click tray → menu with Show / Hide / Quit
- Click Quit → app exits, tray icon disappears

- [ ] **Step 4: Commit**

```powershell
git add desktop/build/tray-icon.png desktop/src/main.ts
git commit -m "desktop: system tray with minimize-to-tray on window close"
```

---

## Task 8: Auto-update wiring with `electron-updater`

Wires the app to check GitHub Releases for newer versions. The update feed doesn't exist yet — Task 10 will create the first release. This task installs and verifies the code path doesn't crash on startup.

**Files:**
- Modify: `desktop/src/main.ts`

- [ ] **Step 1: Add updater wiring to `desktop/src/main.ts`**

Add import near the top:
```typescript
import { autoUpdater } from 'electron-updater';
```

Add a `setupAutoUpdate()` function before `app.whenReady()`:
```typescript
function setupAutoUpdate(): void {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-downloaded', (info) => {
    mainWindow?.webContents.send('daisy:update-ready', { version: info.version });
  });
  autoUpdater.on('error', (err) => {
    // Network failures are expected when offline; don't surface to users
    console.warn('[updater]', err.message);
  });

  // Initial check 30s after launch; then every 6 hours.
  setTimeout(() => { void autoUpdater.checkForUpdates(); }, 30_000);
  setInterval(() => { void autoUpdater.checkForUpdates(); }, 6 * 60 * 60 * 1000);
}
```

Call `setupAutoUpdate()` inside `app.whenReady().then(...)` after `createWindow()`:
```typescript
app.whenReady().then(() => {
  // ... existing setup ...
  createTray();
  createWindow();
  setupAutoUpdate();
  // ...
});
```

Add an IPC handler for the renderer to trigger install-on-quit:
```typescript
ipcMain.on('daisy:quit-and-install', () => {
  quittingForReal = true;
  autoUpdater.quitAndInstall();
});
```

Add it inside `app.whenReady().then(...)`, anywhere alongside the existing handlers.

- [ ] **Step 2: Wire the renderer badge click to install**

Modify `desktop/src/renderer/app.ts`. Replace the existing `window.daisyAPI?.onUpdateReady?.(...)` block at the bottom with:
```typescript
window.daisyAPI?.onUpdateReady?.((info) => {
  updateBadge.classList.remove('hidden');
  updateBadge.textContent = `Update v${info.version} ready — click to restart`;
  updateBadge.style.cursor = 'pointer';
  updateBadge.onclick = () => window.daisyAPI.quitAndInstall();
});
```

- [ ] **Step 3: Verify it doesn't crash and silently fails on no-feed**

Run (from `desktop/`):
```powershell
npm start
```
Wait 35 seconds. Expected: app stays running normally, terminal shows a `[updater]` warning that no update info was found (the feed URL points to a release that doesn't exist yet). No crash, no UI badge.

- [ ] **Step 4: Commit**

```powershell
git add desktop/src/main.ts desktop/src/renderer/app.ts
git commit -m "desktop: auto-update wiring against GitHub Releases (feed lands in Task 10)"
```

---

## Task 9: Build pipeline — `electron-builder.yml` + Windows installer

**Files:**
- Create: `desktop/electron-builder.yml`
- Create: `desktop/build/icon.ico` (256×256 multi-res; placeholder OK)
- Create: `desktop/build/installer.nsh` (NSIS hook, optional but included for clean uninstall)

- [ ] **Step 1: Create `desktop/build/icon.ico`**

Multi-resolution Windows icon. If you have ImageMagick:
```powershell
magick -size 256x256 xc:"#e8a838" desktop/build/icon-base.png
magick desktop/build/icon-base.png -define icon:auto-resize=256,128,64,48,32,16 desktop/build/icon.ico
Remove-Item desktop/build/icon-base.png
```
Otherwise, generate any 256×256 .ico in an image editor. Real branded icon → designer pass (tracked in TODO).

- [ ] **Step 2: Create `desktop/build/installer.nsh`**

```nsis
!macro customInstall
  ; Reserved for future install-time customization (file associations, etc.)
!macroend

!macro customUnInstall
  ; Remove any user-data caches we may write in future versions
  RMDir /r "$APPDATA\DaisyHelps\Cache"
!macroend
```

- [ ] **Step 3: Create `desktop/electron-builder.yml`**

```yaml
appId: com.daisyhelps.app
productName: DaisyHelps
copyright: Copyright © 2026 Daisy Helps
artifactName: DaisyHelps-Setup-${version}.${ext}

directories:
  output: release
  buildResources: build

files:
  - dist/**/*
  - package.json

win:
  target:
    - target: nsis
      arch: [x64]
  icon: build/icon.ico
  publisherName: Daisy Helps
  # Code signing intentionally omitted at v1 — users will see a SmartScreen
  # warning. Add `certificateFile` and `certificatePassword` here when an EV
  # cert is purchased.

nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
  createStartMenuShortcut: true
  shortcutName: Daisy Helps
  include: build/installer.nsh
  uninstallDisplayName: Daisy Helps ${version}

publish:
  provider: github
  owner: REPLACE_WITH_GITHUB_OWNER
  repo: REPLACE_WITH_GITHUB_REPO
  releaseType: release
```

Replace `REPLACE_WITH_GITHUB_OWNER` and `REPLACE_WITH_GITHUB_REPO` with the actual values for this repo. Get them with:
```powershell
git remote get-url origin
```
For example, if the remote is `https://github.com/devin-mccaw/daisyhelps.git`, owner is `devin-mccaw` and repo is `daisyhelps`.

- [ ] **Step 4: Build the installer locally**

Run (from `desktop/`):
```powershell
npm run release
```
Expected: After ~1-2 minutes, `desktop/release/DaisyHelps-Setup-0.1.0.exe` exists (~80-100MB). Also `desktop/release/latest.yml` exists — that's the auto-update feed file.

- [ ] **Step 5: Manually install and smoke-test**

```powershell
.\desktop\release\DaisyHelps-Setup-0.1.0.exe
```
- Click through the SmartScreen "Unknown publisher" warning ("More info" → "Run anyway")
- Walk the installer; pick install location; complete install
- Find "Daisy Helps" in Start Menu; launch
- Window opens, status pill goes "Ready"
- Speak "Hello Daisy" → voice reply
- Click "Show Daisy my screen" → screenshot sent, Daisy references it
- Close window → minimizes to tray; right-click tray → Quit
- In Control Panel → Programs and Features, confirm "Daisy Helps 0.1.0" is listed; right-click → Uninstall removes cleanly

- [ ] **Step 6: Commit**

```powershell
git add desktop/electron-builder.yml desktop/build/icon.ico desktop/build/installer.nsh
git commit -m "desktop: electron-builder config + Windows NSIS installer"
```

---

## Task 10: GitHub Actions — release workflow on `v*` tags

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Create `.github/workflows/release.yml`**

```yaml
name: release

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write

jobs:
  windows:
    runs-on: windows-latest
    defaults:
      run:
        working-directory: desktop
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: desktop/package-lock.json

      - name: Install
        run: npm ci

      - name: Build and publish
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: npm run release:publish
```

`GITHUB_TOKEN` is provided automatically by Actions and electron-builder reads `GH_TOKEN`. The token has write access to releases thanks to `permissions: contents: write` above.

- [ ] **Step 2: Verify the workflow file is valid YAML**

Run:
```powershell
gh workflow view release.yml 2>$null
```
If `gh` is installed and the workflow file exists locally, this just prints the file; failures here usually mean YAML indentation issues. Alternative: paste into a YAML validator.

- [ ] **Step 3: Dry-run with a beta tag**

```powershell
git add .github/workflows/release.yml
git commit -m "ci: GitHub Actions workflow to build Windows installer on v* tags"
git push
git tag v0.1.0-beta.1
git push origin v0.1.0-beta.1
```

Watch the Action at `https://github.com/<owner>/<repo>/actions`. Expected:
- Job `windows` runs on `windows-latest`, ~3-5 minutes
- Completes green
- A draft release `v0.1.0-beta.1` exists at `https://github.com/<owner>/<repo>/releases` with `DaisyHelps-Setup-0.1.0-beta.1.exe` and `latest.yml` attached

If the release was created in `draft: true` state, publish it manually from the GitHub UI so electron-updater can find it. (electron-builder's `releaseType: release` should publish directly; if not, add `releaseType: release` plus `--publish always` flag which is already in the npm script.)

- [ ] **Step 4: (Optional) Clean up the beta tag**

If everything works, delete the beta release + tag to keep history tidy:
```powershell
gh release delete v0.1.0-beta.1 --yes
git push --delete origin v0.1.0-beta.1
git tag -d v0.1.0-beta.1
```

- [ ] **Step 5: Commit (workflow file only; already done in Step 3)**

If you didn't commit in Step 3 yet:
```powershell
git add .github/workflows/release.yml
git commit -m "ci: GitHub Actions workflow to build Windows installer on v* tags"
```

---

## Task 11: GitHub Actions — PR CI for `desktop/`

Catches TypeScript breakage and missing deps before merge. Lightweight: build only.

**Files:**
- Create: `.github/workflows/desktop-ci.yml`

- [ ] **Step 1: Create `.github/workflows/desktop-ci.yml`**

```yaml
name: desktop-ci

on:
  pull_request:
    paths:
      - 'desktop/**'
      - '.github/workflows/desktop-ci.yml'

jobs:
  build:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: desktop
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: desktop/package-lock.json

      - name: Install
        run: npm ci

      - name: Build
        run: npm run build

      - name: Test
        run: npm test
```

- [ ] **Step 2: Commit**

```powershell
git add .github/workflows/desktop-ci.yml
git commit -m "ci: PR check for desktop/ — build + vitest"
```

The PR check fires only on PRs that touch `desktop/`; backend-only PRs are unaffected.

---

## Task 12: Landing page — HTML + CSS + redirect

**Files:**
- Create: `landing/index.html`
- Create: `landing/styles.css`
- Create: `landing/_redirects`
- Create: `landing/robots.txt`
- Create: `landing/sitemap.xml`
- Create: `landing/assets/.gitkeep`

- [ ] **Step 1: Create `landing/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Daisy Helps — A patient voice helper for your computer</title>
    <meta name="description" content="Daisy Helps is a friendly voice companion that walks you through computer tasks, one step at a time. Free download for Windows." />
    <meta property="og:title" content="Daisy Helps" />
    <meta property="og:description" content="A patient voice helper for your computer." />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="https://daisyhelps.com/" />
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <header>
      <div class="brand">Daisy Helps</div>
    </header>

    <main>
      <section class="hero">
        <h1>A patient voice helper for your computer.</h1>
        <p class="lede">Daisy listens, looks at your screen when you ask, and walks you through anything — one step at a time. She never clicks for you.</p>
        <a class="download" href="/download">Download for Windows</a>
        <p class="smartscreen">When Windows asks "Are you sure?", click <strong>More info</strong> then <strong>Run anyway</strong>. We're working on a signed installer.</p>
      </section>

      <section class="what">
        <h2>What Daisy does</h2>
        <ul>
          <li><strong>Listens to your voice.</strong> Just talk. Daisy hears you.</li>
          <li><strong>Sees your screen when you ask.</strong> Click "Show Daisy my screen" and she'll know what you're looking at.</li>
          <li><strong>Guides one step at a time.</strong> No jargon, no rushing.</li>
          <li><strong>Speaks English or Spanish.</strong> Switch with one tap.</li>
        </ul>
      </section>

      <section class="privacy">
        <h2>Your privacy</h2>
        <p>Daisy doesn't track you. The app sends your voice and (when you ask) a screen image to our servers to figure out the next step, then forgets the conversation when you close the window.</p>
      </section>

      <section class="help">
        <h2>Need help?</h2>
        <p>Email <a href="mailto:hello@daisyhelps.com">hello@daisyhelps.com</a>.</p>
      </section>
    </main>

    <footer>
      <span>© 2026 Daisy Helps</span>
      <span><a href="https://api.daisyhelps.com/healthz">status</a></span>
    </footer>
  </body>
</html>
```

- [ ] **Step 2: Create `landing/styles.css`**

```css
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }

body {
  font-family: -apple-system, "Segoe UI", system-ui, sans-serif;
  background: #fdf7ec;
  color: #2d2114;
  font-size: 18px;
  line-height: 1.6;
}

header {
  padding: 16px 24px;
  border-bottom: 1px solid #ebe0c8;
}
.brand { font-size: 24px; font-weight: 700; }

main {
  max-width: 720px;
  margin: 0 auto;
  padding: 32px 24px;
}

h1 { font-size: 36px; margin: 12px 0; line-height: 1.2; }
h2 { font-size: 22px; margin: 32px 0 8px; }

.lede { font-size: 20px; color: #4a3a20; }

.download {
  display: inline-block;
  margin-top: 16px;
  padding: 18px 32px;
  background: #e8a838;
  color: #2d2114;
  font-size: 22px;
  font-weight: 600;
  text-decoration: none;
  border-radius: 12px;
  border: none;
}
.download:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.08); }

.smartscreen {
  margin-top: 12px;
  font-size: 14px;
  color: #6b5a3e;
}

ul { padding-left: 20px; }
li { margin: 6px 0; }

a { color: #b56e00; }

footer {
  border-top: 1px solid #ebe0c8;
  padding: 16px 24px;
  display: flex;
  justify-content: space-between;
  font-size: 14px;
  color: #6b5a3e;
  max-width: 720px;
  margin: 32px auto 0;
}
```

- [ ] **Step 3: Create `landing/_redirects`**

```
/download  https://github.com/REPLACE_WITH_GITHUB_OWNER/REPLACE_WITH_GITHUB_REPO/releases/latest/download/DaisyHelps-Setup.exe  302
```

Replace the placeholders with the same owner/repo as in `desktop/electron-builder.yml`. Note Render's static site supports the Netlify-style `_redirects` file.

> ⚠️ The asset name `DaisyHelps-Setup.exe` is a static-name redirect target — the actual artifact is `DaisyHelps-Setup-x.y.z.exe`. We use GitHub's "latest" redirect feature, which canonicalizes asset names by stripping version-like suffixes is NOT a thing GitHub does. So we have two clean options:
> (a) After each release, manually upload an additional `DaisyHelps-Setup.exe` (no version) as a release asset, or
> (b) Use the GitHub Releases API in JS on the landing page to resolve the latest asset URL.
>
> For v1 simplicity, use option (a). Document this in `docs/RUNBOOK.md` (Task 18). The CI workflow in Task 10 can be extended later to auto-upload the no-version-suffix copy.

- [ ] **Step 4: Create `landing/robots.txt`**

```
User-agent: *
Allow: /
Sitemap: https://daisyhelps.com/sitemap.xml
```

- [ ] **Step 5: Create `landing/sitemap.xml`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://daisyhelps.com/</loc>
    <changefreq>monthly</changefreq>
  </url>
</urlset>
```

- [ ] **Step 6: Add `landing/assets/.gitkeep`**

Empty file so the directory is tracked.
```powershell
New-Item -ItemType File landing/assets/.gitkeep
```

- [ ] **Step 7: Local-preview the page**

```powershell
cd landing
python -m http.server 8080
# Open http://localhost:8080/ in a browser; verify layout
cd ..
```

Expected: hero with download CTA renders, links work (the `/download` redirect won't work locally without a reverse proxy — that's only live on Render).

- [ ] **Step 8: Commit**

```powershell
git add landing/index.html landing/styles.css landing/_redirects landing/robots.txt landing/sitemap.xml landing/assets/.gitkeep
git commit -m "landing: v1 static site for daisyhelps.com with Windows download CTA"
```

---

## Task 13: Render Static Site for `daisyhelps.com`

**Files:**
- Modify: `render.yaml`

- [ ] **Step 1: Extend `render.yaml` to add a static-site service**

Replace the entire `render.yaml` with:

```yaml
services:
  - type: web
    name: daisyhelps-backend
    runtime: python
    plan: starter
    pythonVersion: "3.11"
    buildCommand: pip install -r requirements.txt
    startCommand: uvicorn backend.main:app --host 0.0.0.0 --port $PORT
    healthCheckPath: /healthz
    envVars:
      - key: ANTHROPIC_API_KEY
        sync: false
      - key: GROQ_API_KEY
        sync: false
      - key: ELEVENLABS_API_KEY
        sync: false
      - key: ELEVENLABS_VOICE_ID_EN
        sync: false
      - key: ELEVENLABS_VOICE_ID_ES
        sync: false
      - key: LOG_LEVEL
        value: INFO

  - type: web
    name: daisyhelps-landing
    runtime: static
    buildCommand: ""
    staticPublishPath: ./landing
    routes:
      - type: redirect
        source: /download
        destination: https://github.com/REPLACE_WITH_GITHUB_OWNER/REPLACE_WITH_GITHUB_REPO/releases/latest/download/DaisyHelps-Setup.exe
    headers:
      - path: /*
        name: X-Frame-Options
        value: DENY
      - path: /*
        name: X-Content-Type-Options
        value: nosniff
```

Replace the two `REPLACE_WITH_*` placeholders with real values.

The Render `routes` block above replaces the `_redirects` file from the previous task — Render Static Sites supports either approach, and YAML keeps the config in one place. (Leave `_redirects` in the landing dir as a fallback in case someone runs the static folder via another host.)

- [ ] **Step 2: Push and create the new service in Render**

```powershell
git add render.yaml
git commit -m "landing: render.yaml — daisyhelps-landing static site"
git push
```

In the Render dashboard:
1. The existing Blueprint will detect the new service. If using New → Blueprint workflow, re-sync from GitHub.
2. The new `daisyhelps-landing` service builds and goes live at a `*.onrender.com` URL within ~1 minute.
3. In the service → Settings → Custom Domains, add `daisyhelps.com` and `www.daisyhelps.com`. Render gives you a CNAME / ALIAS target for each.

- [ ] **Step 3: Configure DNS at the registrar**

At the daisyhelps.com registrar, add records (Render will tell you the exact values):
- `daisyhelps.com` — ALIAS or ANAME to Render's apex target
- `www.daisyhelps.com` — CNAME to Render's www target

Wait ~5 minutes for DNS + Render-issued TLS cert.

- [ ] **Step 4: Verify live**

```powershell
curl https://daisyhelps.com/
curl -I https://daisyhelps.com/download
```

Expected:
- The first returns the HTML page (200)
- The second returns a 302 redirect to the GitHub Releases asset URL

- [ ] **Step 5: Commit (already committed in Step 2; nothing more)**

---

## Task 14: Doc update — `README.md`

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace `README.md` with a desktop-first framing**

```markdown
# Daisy Helps

A friendly voice companion that walks tech-novice users (especially the elderly) through computer tasks, one step at a time. Daisy listens by voice, sees the screen when asked, and **guides — she never clicks for you**.

**Download:** https://daisyhelps.com
**Backend status:** https://api.daisyhelps.com/healthz

This repo contains two deployables and one library of docs:

| Where | What |
|---|---|
| [`desktop/`](desktop/) | The Electron Windows app users download |
| [`landing/`](landing/) | The static landing page at daisyhelps.com |
| [`backend/`](backend/) | The FastAPI WebSocket server at api.daisyhelps.com |
| [`docs/`](docs/) | API contract, architecture, runbook, decisions, demo |

## Quick start

### Run the desktop app from source

```bash
cd desktop
npm install
npm start
```

The app connects to `wss://api.daisyhelps.com` by default. To point at a local backend, change `WS_BASE` in `desktop/src/renderer/app.ts`.

### Run the backend locally

```bash
python -m venv .venv
# PowerShell:  .venv\Scripts\Activate.ps1
# Bash:        source .venv/Scripts/activate
pip install -r requirements.txt
cp .env.example .env   # then fill in real keys
uvicorn backend.main:app --reload --port 8000
```

Open `http://localhost:8000/test` for the backend debug harness (used for backend development without the desktop app).

### Build a Windows installer

```bash
cd desktop
npm run release   # produces desktop/release/DaisyHelps-Setup-x.y.z.exe
```

For a public release that auto-updates installed users, push a `v*` git tag — see `docs/RUNBOOK.md`.

## Docs

- [API contract](docs/API.md) — the WebSocket protocol both clients (desktop app + debug harness) speak
- [Architecture](docs/ARCHITECTURE.md)
- [Runbook](docs/RUNBOOK.md) — local dev, env vars, building installers, releases, deployment
- [Decisions](docs/DECISIONS.md)
- [Demo script](docs/DEMO.md)
- [Desktop pivot spec](docs/superpowers/specs/2026-05-16-daisy-helps-desktop-pivot-design.md)
```

- [ ] **Step 2: Commit**

```powershell
git add README.md
git commit -m "docs: README — desktop-first framing, two deployables + docs"
```

---

## Task 15: Doc update — `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the "What this is" section**

In `CLAUDE.md`, replace the "What this is" section (currently the second section, ~5 paragraphs) with:

```markdown
## What this is

**Daisy Helps** — a voice AI companion that walks tech-novice users (especially the elderly) through computer tasks one step at a time. Daisy listens by voice, sees the screen when asked, and guides — she never takes actions for the user.

This repo holds three things:
1. **`backend/`** — FastAPI + WebSocket server deployed at `api.daisyhelps.com`. Single long-lived WS per client (`/ws/{session_id}`) driving a streaming pipeline: VAD → STT → LLM (Claude Haiku/Sonnet) → TTS. Multilingual (EN + ES). Per-turn cancellation enables sub-200ms interrupts. Session state is in-memory.
2. **`desktop/`** — Electron + TypeScript Windows app users download from `daisyhelps.com`. Ports the legacy `test_harness/test_page.html` into a production UI; adds native one-click screen capture via `desktopCapturer`, system-tray support, and auto-update from GitHub Releases.
3. **`landing/`** — Static single-page site served from a Render Static Site at `daisyhelps.com`. "Download for Windows" CTA redirects to the latest GitHub Release asset.

The backend is **feature-complete through Phase 5** (voice loop, vision, multi-turn, interrupts, language toggle, text fallback, click-indicator) and deployed. Phase 6 is the desktop + landing pivot — see `docs/superpowers/specs/2026-05-16-daisy-helps-desktop-pivot-design.md`.
```

- [ ] **Step 2: Add a "Desktop" section after "Build / run / test"**

Insert after the `## Build / run / test` section (before "What's been built"):

```markdown
## Desktop app — build / run

```powershell
# Setup (one-time)
cd desktop
npm install

# Run from source (connects to wss://api.daisyhelps.com)
npm start

# Build Windows installer locally
npm run release
# → desktop/release/DaisyHelps-Setup-x.y.z.exe

# Cut a public release (CI builds and publishes to GitHub Releases)
git tag v0.1.x
git push --tags
```

## Landing page — local preview

```powershell
cd landing
python -m http.server 8080
# Open http://localhost:8080/
```

Production deploy is automatic via the Render Blueprint in `render.yaml`.
```

- [ ] **Step 3: Update the "What's been built" table**

Add a row at the bottom of the phase table:

```markdown
| 6 — Desktop + landing | Electron Windows app under `desktop/`; landing site under `landing/`; CI release workflow; daisyhelps.com live | ✅ |
```

- [ ] **Step 4: Update the "Source of truth" list**

Add these bullets to the bullet list:
```markdown
- **Desktop client behavior** — `desktop/src/renderer/app.ts` (WebSocket client, mic, audio playback, UI state)
- **Desktop native bridge** — `desktop/src/main.ts` (screen capture, tray, auto-update); `desktop/src/preload.ts` (renderer-exposed API surface)
- **Landing page** — `landing/index.html`
```

- [ ] **Step 5: Update working conventions**

Add to the bulleted "Working conventions" list:
```markdown
- **Desktop commits use `desktop:` prefix**, landing uses `landing:`, CI uses `ci:`. Backend keeps `phase-N:` as before.
- **The desktop app speaks the same WebSocket contract as the test harness.** Don't change one without the other — `docs/API.md` is the single contract for both.
```

- [ ] **Step 6: Replace the "Production frontend" row in the deferred-features table**

In the table at the bottom of `CLAUDE.md`, find the row beginning with `| **Production frontend**` and replace it with:

```markdown
| **macOS / Linux installers** | electron-builder cross-target is already configured for Windows in `desktop/electron-builder.yml`. Adding macOS requires an Apple Developer cert ($99/yr) + signing + notarization; Linux just needs adding `target: AppImage` to the same file. The CI workflow needs a matrix expansion. |
| **Signed Windows installer** | Add `certificateFile` + `certificatePassword` (CI secret) to `desktop/electron-builder.yml` `win` block. EV cert recommended (~$300/yr) to skip SmartScreen entirely. |
```

- [ ] **Step 7: Add the desktop gotchas to "Known constraints / gotchas"**

Append to that section:

```markdown
- **Desktop app uses `ScriptProcessorNode`** for mic capture (same as the test harness). Future migration to `AudioWorklet` is queued.
- **Multi-monitor screen picker** uses `nodeIntegration: true` for the small picker window — needed for the `require('electron')` call. Renderer that talks to the network stays sandboxed.
- **Code signing deferred at v1** — Windows users see a SmartScreen "Unknown publisher" warning. Landing page documents how to click through.
- **Auto-update feed lives at GitHub Releases.** electron-updater reads `latest.yml` from `releases/latest/`. If a release is in "draft" state, auto-update won't see it — publish releases via the GitHub UI or rely on CI's `--publish always` to publish directly.
- **The `landing/_redirects` file and `render.yaml`'s `routes` block both define the `/download` redirect.** Render reads `routes`; the `_redirects` file is a fallback for non-Render hosts.
```

- [ ] **Step 8: Commit**

```powershell
git add CLAUDE.md
git commit -m "docs: CLAUDE.md — add desktop + landing, phase 6, deferred-features rework"
```

---

## Task 16: Doc update — `TODO.md`

**Files:**
- Modify: `TODO.md`

- [ ] **Step 1: Replace `TODO.md` with a Phase 6 punch list**

```markdown
# TODO

State of the Daisy Helps repo. Phase 6 — the desktop + landing pivot — is in progress; backend Phase 5 (deployed) is complete.

**Last updated:** 2026-05-16 (Phase 6 in progress)

---

## Status at a glance

| Area | State |
|---|---|
| Phase 0 — Scaffold | ✅ |
| Phase 1 — Voice loop | ✅ |
| Phase 2 — Vision | ✅ |
| Phase 3 — Multi-turn + interrupts | ✅ |
| Phase 4 — Language toggle + text fallback | ✅ |
| Phase 5 — Backend deploy + click-indicator | ✅ |
| **Phase 6 — Desktop app + landing page** | 🚧 in progress |

`backend/readiness.py` will bump to `phase: 6, phase_name: "desktop-launch"` after the first public release (v0.1.0).

**Tests:** `pytest -q` — 29 unit tests on the backend. `cd desktop && npm test` — vitest on the audio utilities.

---

## Phase 6 punch list

Following the plan at `docs/superpowers/plans/2026-05-16-daisy-helps-desktop.md`:

### Code

- [ ] Task 1: Scaffold `desktop/` Electron + TypeScript project
- [ ] Task 2: Wire-message TypeScript types
- [ ] Task 3: Renderer UI shell (HTML + CSS)
- [ ] Task 4: PCM encode/decode utilities (TDD)
- [ ] Task 5: Renderer app — WebSocket + mic + audio playback + UI wiring
- [ ] Task 6: Native screen capture via `desktopCapturer`
- [ ] Task 7: System tray + minimize-to-tray
- [ ] Task 8: Auto-update wiring (electron-updater)
- [ ] Task 9: Build pipeline (electron-builder Windows NSIS)
- [ ] Task 10: GitHub Actions release workflow on `v*` tags
- [ ] Task 11: GitHub Actions PR CI for `desktop/`
- [ ] Task 12: Landing page (`landing/index.html` + assets)
- [ ] Task 13: Render Static Site + daisyhelps.com DNS

### Docs

- [ ] Task 14: `README.md`
- [ ] Task 15: `CLAUDE.md`
- [ ] Task 16: `TODO.md` (this file)
- [ ] Task 17: `docs/ARCHITECTURE.md`
- [ ] Task 18: `docs/RUNBOOK.md`
- [ ] Task 19: `docs/DEMO.md`
- [ ] Task 20: `docs/DECISIONS.md`
- [ ] Task 21: `docs/API.md`

### Release

- [ ] Task 22: Cut v0.1.0, verify daisyhelps.com download works end-to-end, bump `readiness.py` to phase 6

---

## User-action items (require dashboard / registrar access)

1. **GitHub Releases** — make sure the repo is configured so the `GITHUB_TOKEN` in CI has write access (default for `pull_request` → `push` workflows from the repo itself).
2. **Render dashboard** — after `render.yaml` is updated (Task 13), re-sync the Blueprint to create the `daisyhelps-landing` static service. Add `daisyhelps.com` and `www.daisyhelps.com` as custom domains.
3. **DNS** — at the daisyhelps.com registrar, add the Render-supplied ALIAS/CNAME records.
4. **Designer pass on icons** — `desktop/build/icon.ico` and `desktop/build/tray-icon.png` are flat-color placeholders. Replace with branded versions before any marketing push.

---

## Backwards-compatible deferred items (carry forward from Phase 5)

- **Persona / prompt iteration** — run the demo through the installed desktop app 5+ times; tighten `backend/prompts.py`.
- **AudioWorklet migration** in `desktop/src/renderer/app.ts` (currently uses deprecated `ScriptProcessorNode`, same as the test harness).
- **Migrate `datetime.utcnow()` → `datetime.now(timezone.utc)`** in `backend/session.py`.
- **macOS / Linux installers** — see `CLAUDE.md` deferred-features table.
- **EV code-signing cert** for the Windows installer — see `CLAUDE.md`.

---

## Where to look for what

| For | Read |
|---|---|
| Desktop pivot design | `docs/superpowers/specs/2026-05-16-daisy-helps-desktop-pivot-design.md` |
| Desktop implementation plan | `docs/superpowers/plans/2026-05-16-daisy-helps-desktop.md` |
| WebSocket protocol contract | `docs/API.md` |
| System architecture | `docs/ARCHITECTURE.md` |
| Local dev + env vars + deploy | `docs/RUNBOOK.md` |
| Why decisions were made | `docs/DECISIONS.md` |
| The demo script | `docs/DEMO.md` |
| Feature readiness flags | `backend/readiness.py` (or `GET /api/status`) |
| Daisy's voice (system prompt) | `backend/prompts.py` |
```

- [ ] **Step 2: Commit**

```powershell
git add TODO.md
git commit -m "docs: TODO.md — Phase 6 punch list (desktop + landing)"
```

---

## Task 17: Doc update — `docs/ARCHITECTURE.md`

**Files:**
- Modify: `docs/ARCHITECTURE.md`

- [ ] **Step 1: Insert a "Clients" section before "Components"**

In `docs/ARCHITECTURE.md`, after the `## Overview` paragraph and before `## Components`, insert:

```markdown
## Clients

Two clients speak the WebSocket protocol in `docs/API.md`:

| Client | Where | When to use |
|---|---|---|
| **Desktop app** (Electron) | `desktop/` | Production. What users download from daisyhelps.com. |
| **Backend debug harness** | `test_harness/test_page.html` | Backend development. Served at `GET /test`. Use this to exercise the backend without launching the Electron app. |

The desktop app adds native capabilities the browser harness cannot offer:
- **Screen capture** via Electron's `desktopCapturer` — single button click, sourced from the OS, no file picker.
- **Persistent mic permission** granted at install time — no per-session browser prompt.
- **System tray** — Daisy stays one click away while the user works in another window.
- **Auto-update** from GitHub Releases via `electron-updater`.

Both clients speak the identical wire protocol. A wire-protocol change requires updating both (and `docs/API.md`).

```

- [ ] **Step 2: Update the data-flow diagram in the existing "Data flow" section**

Replace the existing data-flow code block with this (adds the client-side capture):

```markdown
## Data flow

```
desktop renderer or test harness
   ├─ mic 16kHz PCM ──ws audio_chunk──▶ VADBuffer.ingest → utterance bytes → STT.transcribe →
   ├─ desktopCapturer or file picker ──ws screenshot──▶ session.set_screenshot
   ▼
transcript msg →
LLM (Sonnet if has_image else Haiku) → text deltas →
  ├─ daisy_text(partial=true) per delta
  └─ TTS sentence-buffered stream →
       └─ audio_chunk msgs → audio_end → daisy_text(partial=false) full text
       (renderer queues PCM and plays at 24kHz)
```
```

- [ ] **Step 3: Commit**

```powershell
git add docs/ARCHITECTURE.md
git commit -m "docs: ARCHITECTURE — add Clients section + desktop in data-flow diagram"
```

---

## Task 18: Doc update — `docs/RUNBOOK.md`

**Files:**
- Modify: `docs/RUNBOOK.md` (add new sections; existing backend content is preserved)

- [ ] **Step 1: Read the existing file to understand its current structure**

```powershell
# Cat first 40 lines to confirm where to insert
Get-Content docs/RUNBOOK.md -TotalCount 40
```

The new sections go AT THE TOP (so desktop ops is the first thing a new contributor sees, since most contributors will be touching the desktop app, not the backend).

- [ ] **Step 2: Prepend new sections to `docs/RUNBOOK.md`**

Insert at the very top of the file, before whatever currently sits there:

```markdown
# Runbook

This document covers desktop, landing, backend, and release operations.

---

## Desktop app — development

```powershell
cd desktop
npm install   # one-time
npm start     # launches Electron pointing at wss://api.daisyhelps.com
```

To point at a local backend, edit `WS_BASE` in `desktop/src/renderer/app.ts` to `ws://localhost:8000` and re-run `npm start`.

Run tests:
```powershell
cd desktop
npm test      # vitest run
```

## Desktop app — building a Windows installer locally

```powershell
cd desktop
npm run release
# → desktop/release/DaisyHelps-Setup-x.y.z.exe (~80MB)
# → desktop/release/latest.yml  (auto-update feed)
```

The first install on a fresh machine triggers Windows SmartScreen "Unknown publisher" — click "More info" → "Run anyway". This is expected until we ship a signed installer (deferred — see `CLAUDE.md`).

## Cutting a public desktop release

1. Bump the version in `desktop/package.json` (e.g., `"version": "0.1.1"`).
2. Commit: `git add desktop/package.json && git commit -m "desktop: bump to 0.1.1"`.
3. Tag: `git tag v0.1.1 && git push origin v0.1.1`.
4. CI (`.github/workflows/release.yml`) builds the installer on `windows-latest`, creates a GitHub Release, and uploads `DaisyHelps-Setup-0.1.1.exe` and `latest.yml`.
5. In the GitHub release UI, drag a copy of the `.exe` renamed to `DaisyHelps-Setup.exe` (no version) into the release assets — this is the stable URL that `daisyhelps.com/download` redirects to. *(Until we automate this in the CI workflow.)*
6. Within 6 hours, running v0.1.0 installs receive the update via electron-updater and show the "Update ready" badge.

## Landing page — local preview

```powershell
cd landing
python -m http.server 8080
# Open http://localhost:8080/
```

Note: the `/download` redirect only works through a host that reads `_redirects` (Render Static, Netlify) — not through plain `python -m http.server`. Local preview confirms layout; download flow is tested in production.

## Landing page — deployment

Production deploy is automatic via the Render Blueprint in `render.yaml`. Pushing changes to `landing/` on the main branch triggers a Render rebuild within ~1 minute.

To set up the service for the first time:
1. In the Render dashboard, sync the Blueprint from GitHub. The `daisyhelps-landing` service is created automatically.
2. In the service → Settings → Custom Domains, add `daisyhelps.com` and `www.daisyhelps.com`. Render returns CNAME/ALIAS targets.
3. At the registrar, add the records. Wait ~5 min for DNS + TLS.

---

## Backend ops

```
```

(Then leave the rest of the existing file content as-is, under the new `## Backend ops` heading.)

- [ ] **Step 3: Commit**

```powershell
git add docs/RUNBOOK.md
git commit -m "docs: RUNBOOK — desktop dev, build, release, landing-page sections"
```

---

## Task 19: Doc update — `docs/DEMO.md`

**Files:**
- Modify: `docs/DEMO.md` (update the opening flow; rest stays)

- [ ] **Step 1: Read the current opening of `docs/DEMO.md`**

```powershell
Get-Content docs/DEMO.md -TotalCount 30
```

- [ ] **Step 2: Replace the opening flow to start from the installed app**

In `docs/DEMO.md`, find the first numbered list / setup section (whatever it currently says about opening `localhost:8000/test` or `api.daisyhelps.com/test`) and replace with:

```markdown
## Setup (before the demo)

1. Download Daisy Helps from `https://daisyhelps.com/download`. The installer is `DaisyHelps-Setup-x.y.z.exe`. Click through any SmartScreen warning.
2. Launch from Start Menu → "Daisy Helps".
3. Confirm the window opens, status pill reads "Ready" within ~2s (Render cold-start warming).
4. Optional warm-up: in another tab visit `https://api.daisyhelps.com/healthz` — should return `{"status":"ok"}` instantly.

## Demo flow — "Help me join a Zoom call with my doctor"

(Then keep the existing demo steps. The only change is the user is talking to the installed desktop app instead of a browser tab, and instead of "open the file picker and select the screenshot" the user clicks the "Show Daisy my screen" button.)
```

If the existing demo says "open file picker" or "select screenshot", replace those phrases with "click 'Show Daisy my screen'".

- [ ] **Step 3: Commit**

```powershell
git add docs/DEMO.md
git commit -m "docs: DEMO — start from installed desktop app, native screen-share"
```

---

## Task 20: Doc update — `docs/DECISIONS.md`

**Files:**
- Modify: `docs/DECISIONS.md` (append)

- [ ] **Step 1: Append five new decision entries**

Append to the end of `docs/DECISIONS.md`:

```markdown

## Desktop framework: Electron over Tauri / PyWebView
**Context:** Need a desktop wrapper for the existing HTML/JS UI with native mic + screen capture.
**Decision:** Electron with TypeScript.
**Rationale:** Mature `desktopCapturer` API matches our exact need (one-line screen-to-PNG). `electron-updater` against GitHub Releases gives auto-update for free. Bundled Chromium = identical rendering between dev and prod. Team is JS-fluent.
**Alternatives considered:** Tauri (~10× smaller installer but mic/screen plugins less mature, plus Rust learning curve). PyWebView (would let us reuse Python skills but loses auto-update story and is overkill given keys stay server-side).

## API keys: server-side, no BYOK
**Context:** Elderly target users won't have Anthropic / Groq / ElevenLabs accounts.
**Decision:** Keys stay in Render backend env vars; desktop app is a thin client.
**Rationale:** Zero-config install is critical for the demographic. Server-side keys also keep usage observable in one place for cost monitoring.
**Alternatives considered:** BYOK with first-launch wizard (kills the demographic). Hybrid auth-proxy with short-lived tokens (engineering complexity not justified at this scale).
**Cost implication:** API spend scales with installs. Acceptable for early stage; revisit at >1000 active users.

## Windows-only at v1; macOS / Linux deferred
**Context:** Target users predominantly on Windows. macOS requires Apple Developer Program ($99/yr) + signing + notarization.
**Decision:** Ship Windows installer first. Architecture is cross-target-ready in `desktop/electron-builder.yml`.
**Rationale:** Smallest scope that reaches the target audience. Mac/Linux additions are config-only later.
**Alternatives considered:** Day-one Mac (real audience but signing setup eats a sprint). Day-one Linux (easy build, near-zero target audience).

## Installer hosting: GitHub Releases (not S3, not Render)
**Context:** Need a stable URL and an auto-update feed.
**Decision:** GitHub Releases hosts `.exe` and `latest.yml`. `daisyhelps.com/download` redirects to the latest release asset.
**Rationale:** Free, durable, electron-updater natively reads the GH Releases format. Decouples release artifact from marketing site.
**Alternatives considered:** S3/CloudFront (more setup, costs money). Render Static (works but loses electron-updater integration). api.daisyhelps.com (couples releases to backend deploys).

## Code signing deferred at v1
**Context:** Unsigned Windows installers trigger SmartScreen "Unknown publisher" warning.
**Decision:** Ship unsigned at v1; landing page documents the warning.
**Rationale:** EV code-signing certs are ~$300/yr and require corporate ID verification. Not justified before product-market fit. Warning is annoying but doesn't block install.
**How to swap:** Buy EV cert, add four lines to `desktop/electron-builder.yml`, set two CI secrets (`WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`), retag a release.
```

- [ ] **Step 2: Commit**

```powershell
git add docs/DECISIONS.md
git commit -m "docs: DECISIONS — Electron, server-side keys, Windows-only, GH Releases, unsigned at v1"
```

---

## Task 21: Doc update — `docs/API.md`

**Files:**
- Modify: `docs/API.md`

- [ ] **Step 1: Add a one-line note near the top**

In `docs/API.md`, just below the first paragraph (the `> This document is the contract for the frontend...` blockquote), insert:

```markdown

> Two clients speak this protocol: the production Electron app (`desktop/`) and the browser test harness (`test_harness/test_page.html`). Changes here must be applied to both.

```

- [ ] **Step 2: Commit**

```powershell
git add docs/API.md
git commit -m "docs: API — note both desktop app + test harness speak this protocol"
```

---

## Task 22: Cut v0.1.0 release + bump backend readiness to phase 6

The last task. Triggers the full Phase 6 launch: tag → CI builds installer → GitHub Release published → daisyhelps.com download link goes live → backend readiness reflects the launch.

**Files:**
- Modify: `backend/readiness.py`

- [ ] **Step 1: Confirm all prior tasks landed**

Run:
```powershell
git status
git log --oneline -25
```

Expected: clean working tree, last ~22 commits are the Phase 6 work. If anything is uncommitted or a task was skipped, stop and finish it before proceeding.

- [ ] **Step 2: Smoke-test from the installed app, not source**

```powershell
cd desktop
npm run release
.\release\DaisyHelps-Setup-0.1.0.exe
# Walk through SmartScreen → install → launch → run the Zoom-with-doctor demo from docs/DEMO.md
# Validate: window opens, mic works, screen capture works, voice reply plays, interrupt works, language toggle works
```

If anything fails, fix it in the appropriate file, commit, and re-run this step.

- [ ] **Step 3: Tag v0.1.0 and push**

```powershell
git tag v0.1.0
git push origin v0.1.0
```

Watch the CI run at `https://github.com/<owner>/<repo>/actions`. Within ~5 minutes:
- The `release` workflow completes green
- A GitHub Release `v0.1.0` exists with `DaisyHelps-Setup-0.1.0.exe` + `latest.yml` attached
- (Manual) drag a copy of the `.exe` renamed to `DaisyHelps-Setup.exe` (no version) into the release assets, so `daisyhelps.com/download` redirects work

- [ ] **Step 4: End-to-end verify the public flow**

From a different machine (or a clean browser profile + Downloads folder):
```
1. Visit https://daisyhelps.com
2. Click "Download for Windows"
3. Confirm DaisyHelps-Setup.exe downloads (not the versioned one — the stable name)
4. Run it; install; launch
5. Run the Zoom-with-doctor demo to completion in under 5 minutes
```

- [ ] **Step 5: Bump `backend/readiness.py` to phase 6**

Edit `backend/readiness.py`. Change:
```python
    "phase": 5,
    "phase_name": "click-indicator",
```
to:
```python
    "phase": 6,
    "phase_name": "desktop-launch",
```

- [ ] **Step 6: Commit and push the readiness bump**

```powershell
git add backend/readiness.py
git commit -m "phase-6: desktop launched + landing live + v0.1.0 public"
git push
```

Render auto-deploys the backend on push to main; `GET https://api.daisyhelps.com/api/status` will reflect phase 6 within a minute.

- [ ] **Step 7: Update `TODO.md` to mark Phase 6 complete**

In `TODO.md`, change the Phase 6 row in "Status at a glance":
```markdown
| **Phase 6 — Desktop app + landing page** | ✅ live (v0.1.0 released, daisyhelps.com serves install) |
```

And check off the remaining boxes in the Phase 6 punch list. Then:

```powershell
git add TODO.md
git commit -m "docs: TODO — mark Phase 6 complete"
git push
```

---

## Done criteria (from the spec)

After Task 22 completes, all of these should be true:

- [x] `daisyhelps.com` resolves to the landing page with a visible "Download for Windows" button
- [x] Clicking the button downloads `DaisyHelps-Setup-x.y.z.exe` from GitHub Releases
- [x] On a fresh Windows 10/11 machine, double-clicking the installer completes install
- [x] Launching the app shows Daisy's window and connects to `wss://api.daisyhelps.com/ws/{uuid}` without configuration
- [x] Microphone permission is granted at install; no in-app permission prompt
- [x] Clicking "Show Daisy my screen" sends a real PNG of the user's screen; Daisy's reply references what she sees
- [x] Cutting a `v0.1.1` tag triggers a CI build, attaches `.exe` + `latest.yml` to a new GitHub Release, and running v0.1.0 installs offer the update within 6 hours
- [x] All eight docs are updated and committed
- [x] `pytest -q` still passes (29 tests; backend untouched)
- [x] Zoom-with-doctor demo runs end-to-end on the installed desktop app in under 5 minutes
