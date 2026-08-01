// DictationEngine — the platform-agnostic core of chirp, extracted from
// index.ts so UI surfaces (widget, settings, tray) are swappable views.
//
// Flow per dictation:
//   key down  → snapshot frontmost app, start mic capture     → 'state' recording
//   key up    → stop capture → whisper transcribe             → 'state' processing
//             → paste into captured app                       → 'result' {pasted:true}
//             → …or, with no focus target / failed paste, the
//               transcript stays on the clipboard             → 'result' {pasted:false}
//
// UI layers subscribe to events and issue commands (setKeycode, …); they
// never reach into the pipeline. This is also the seam where a future
// cloud transcriber or an onboarding/install flow plugs in.

import { clipboard } from 'electron';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Config, saveConfig } from './config';
import { Hotkey } from './hotkey';
import { Recorder } from './recorder';
import { Transcriber } from './transcribe';
import { getPasteBackend, FocusSnapshot } from './paste';

export type EngineState = 'idle' | 'recording' | 'processing';

export interface DictationResult {
  text: string;
  /** false → the transcript was left on the clipboard instead of pasted
   * (no focused target at record time, or the synthetic paste failed). */
  pasted: boolean;
}

export interface EngineEvents {
  state: [EngineState];
  result: [DictationResult];
  error: [string];
}

export const MODELS_DIR = path.join(os.homedir(), '.chirp', 'models');

export class DictationEngine extends EventEmitter<EngineEvents> {
  readonly cfg: Config;

  private recorder = new Recorder();
  private transcriber: Transcriber;
  private hotkey: Hotkey;
  private paste = getPasteBackend();
  private state: EngineState = 'idle';
  private focusPromise: Promise<FocusSnapshot | null> = Promise.resolve(null);
  private startedAt = 0;

  constructor(cfg: Config, logKeys = false) {
    super();
    this.cfg = cfg;
    this.transcriber = new Transcriber(cfg);
    this.hotkey = new Hotkey(cfg.keycode, logKeys);
  }

  async init(): Promise<void> {
    await this.recorder.init();
    this.transcriber.start();
    this.hotkey.on('start', () => this.onKeyDown());
    this.hotkey.on('stop', () => void this.onKeyUp());
    this.hotkey.start();
  }

  stop(): void {
    this.hotkey.stop();
    this.transcriber.stop();
  }

  getState(): EngineState {
    return this.state;
  }

  // ---- settings commands (UI → engine) ---------------------------------

  setKeycode(code: number): void {
    this.cfg.keycode = code;
    saveConfig(this.cfg);
    this.hotkey.setKeycode(code);
  }

  setInputDevice(label: string): void {
    this.cfg.inputDevice = label;
    saveConfig(this.cfg);
  }

  setModel(modelPath: string): void {
    this.cfg.modelPath = modelPath;
    saveConfig(this.cfg);
    this.transcriber.restart();
  }

  /** Live-enumerate audio inputs via the recorder renderer (only place
   * with access to navigator.mediaDevices). */
  async listInputDevices(): Promise<string[]> {
    try {
      const labels: string[] = await this.recorder.webContents!.executeJavaScript(
        `navigator.mediaDevices.enumerateDevices()
           .then(ds => ds.filter(d => d.kind === 'audioinput').map(d => d.label))`
      );
      return labels.filter(Boolean);
    } catch (err) {
      console.warn('[chirp] device enumeration failed:', err);
      return [];
    }
  }

  listModels(): string[] {
    try {
      return fs
        .readdirSync(MODELS_DIR)
        .filter((f) => f.endsWith('.bin'))
        .sort();
    } catch {
      return [];
    }
  }

  // ---- dictation pipeline ----------------------------------------------

  private setState(state: EngineState): void {
    this.state = state;
    this.emit('state', state);
  }

  private onKeyDown(): void {
    if (this.state !== 'idle') return;
    this.setState('recording');
    this.startedAt = Date.now();
    // Runs concurrently with the recording, so its ~50ms osascript cost
    // never shows up as latency.
    this.focusPromise = this.paste.captureFocus();
    this.recorder.start(this.cfg.inputDevice);
  }

  private async onKeyUp(): Promise<void> {
    if (this.state !== 'recording') return;
    this.setState('processing');
    try {
      const duration = Date.now() - this.startedAt;
      const wav = await this.recorder.stop();
      // Peak sample amplitude (0-32767): ~0 means the mic delivered
      // silence and the problem is capture, not transcription.
      let peak = 0;
      for (let i = 44; i + 1 < wav.length; i += 2) {
        const v = Math.abs(wav.readInt16LE(i));
        if (v > peak) peak = v;
      }
      fs.writeFileSync(path.join(os.homedir(), '.chirp', 'last.wav'), wav);
      console.log(
        `[chirp] recorded ${duration}ms, wav ${wav.length} bytes, peak=${peak} (saved to ~/.chirp/last.wav)`
      );
      if (peak === 0) {
        console.warn(
          '[chirp] mic delivered pure silence. If your MacBook lid is closed the ' +
            'built-in mic is disabled — set "inputDevice" in ~/.chirp/config.json ' +
            'to a substring of another mic\'s name, or change the system default input.'
        );
      }
      if (duration >= this.cfg.minDurationMs) {
        const text = await this.transcriber.transcribe(wav);
        console.log(`[chirp] transcript: ${JSON.stringify(text)}`);
        if (text) {
          await this.deliver(text);
        }
      } else {
        console.log('[chirp] too short — ignored as accidental tap');
      }
    } catch (err) {
      console.error('[chirp]', err);
      this.emit('error', err instanceof Error ? err.message : String(err));
    } finally {
      this.setState('idle');
    }
  }

  /** Paste into the captured target, or fall back to leaving the text on
   * the clipboard so it is never lost. NOTE(windows): win32 captureFocus
   * returns null until implemented, so Windows currently always takes the
   * clipboard path — implementing focus capture re-enables paste there. */
  private async deliver(text: string): Promise<void> {
    const focus = await this.focusPromise;
    if (focus) {
      try {
        console.log(`[chirp] pasting into pid=${focus.pid}`);
        await this.paste.paste(text, focus);
        console.log('[chirp] paste complete');
        this.emit('result', { text, pasted: true });
        return;
      } catch (err) {
        console.warn('[chirp] paste failed — leaving transcript on clipboard:', err);
      }
    } else {
      console.log('[chirp] no focus target — leaving transcript on clipboard');
    }
    clipboard.writeText(text);
    this.emit('result', { text, pasted: false });
  }
}
