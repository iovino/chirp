// Ambient types for the preload bridge, shared by every renderer script.
// Renderer .ts files are plain (non-module) scripts, so they all share this
// global scope — declare the bridge once here, never per-file.
//
// These shapes mirror the main-process definitions (WidgetMessage in
// ui/widget.ts, SettingsSnapshot/Patch in ui/settings.ts); keep them in
// sync by hand — renderer scripts can't import across the process boundary.

type ChirpWidgetMessage =
  | { kind: 'state'; state: 'idle' | 'recording' | 'processing' }
  | { kind: 'result'; text: string; pasted: boolean }
  | { kind: 'error'; message: string };

interface ChirpSettingsSnapshot {
  version: string;
  keycode: number;
  keyLabel: string;
  keyIsPrintable: boolean;
  inputDevice: string;
  devices: string[];
  modelPath: string;
  models: { file: string; label: string; path: string }[];
}

interface ChirpSettingsPatch {
  inputDevice?: string;
  modelPath?: string;
}

interface ChirpApi {
  // recorder (hidden capture window)
  onStart(cb: (inputDevice: string) => void): void;
  onStop(cb: () => void): void;
  sendAudio(wav: ArrayBuffer): void;
  sendError(message: string): void;
  sendInfo(message: string): void;

  // widget
  onWidgetUpdate(cb: (msg: ChirpWidgetMessage) => void): void;
  setWidgetMouse(interactive: boolean): void;
  openSettings(): void;
  copyText(text: string): void;

  // settings (also used by the widget for the key label)
  getSettings(): Promise<ChirpSettingsSnapshot>;
  applySettings(patch: ChirpSettingsPatch): Promise<ChirpSettingsSnapshot>;
  /** Enter capture mode; resolves once a key is bound or capture is
   * canceled (Escape / timeout), with the resulting snapshot. */
  captureKey(): Promise<ChirpSettingsSnapshot>;
  onSettingsChanged(cb: (snap: ChirpSettingsSnapshot) => void): void;
  openPath(which: 'config' | 'log'): void;
  quitApp(): void;
}

interface Window {
  chirp: ChirpApi;
}
