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
  label: string | null; confidence: number | null;
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
  quitApp(): void;
  overlayShow(): void;
  overlayHide(): void;
  overlayState(state: string): void;
  onOverlayState(cb: (state: string) => void): void;
  overlayClick(): void;
  onOverlayClick(cb: () => void): void;
  overlayDragStart(): void;
  overlayDragMove(dx: number, dy: number): void;
  overlayDragEnd(): void;
  showIndicator(args: { x: number; y: number; refW: number; refH: number; label?: string }): void;
  clearIndicator(): void;
  onShowIndicator(cb: (args: { x: number; y: number; label?: string }) => void): void;
  indicatorSetPassthrough(passthrough: boolean): void;
  subtitleShow(text: string): void;
  subtitleClear(): void;
  subtitleErrorShow(text: string): void;
  onShowSubtitleError(cb: (text: string) => void): void;
  onShowSubtitle(cb: (text: string) => void): void;
  onClearSubtitle(cb: () => void): void;
  subtitleEnabledGet(): Promise<boolean>;
  subtitleEnabledSet(enabled: boolean): void;
  onSubtitleEnabledChanged(cb: (enabled: boolean) => void): void;
  subtitleSetPassthrough(passthrough: boolean): void;
  shareScreenRememberedGet(): Promise<boolean>;
  shareScreenRememberedSet(enabled: boolean): void;
  onShareScreenRememberedChanged(cb: (enabled: boolean) => void): void;
  hideMainWindow(): void;
  onOverlayAttentionPulse(cb: () => void): void;
}

declare global {
  interface Window {
    daisyAPI: DaisyAPI;
  }
}
