import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface Config {
  /** uiohook keycode for the push-to-talk key. Hold to record, release to
   * transcribe + paste. Default is right Option (3640) so left-hand
   * shortcuts stay with the OS. Run `npm run keys` to discover keycodes. */
  keycode: number;
  /** Whisper language hint, e.g. "en". */
  language: string;
  /** Path to a ggml Whisper model file (see README for download). */
  modelPath: string;
  /** whisper.cpp server binary; resolved via PATH if not absolute. */
  whisperServerPath: string;
  whisperPort: number;
  threads: number;
  /** Recordings shorter than this are treated as an accidental tap. */
  minDurationMs: number;
  /** Case-insensitive substring of the input device to record from, e.g.
   * "scarlett". Empty = system default input. Note the built-in MacBook
   * mic goes silent (not absent) when the lid is closed. */
  inputDevice: string;
}

const DEFAULTS: Config = {
  keycode: 3640,
  language: 'en',
  modelPath: path.join(os.homedir(), '.chirp', 'models', 'ggml-base.en.bin'),
  whisperServerPath: 'whisper-server',
  whisperPort: 47892,
  threads: 4,
  minDurationMs: 300,
  inputDevice: '',
};

export const CONFIG_PATH = path.join(os.homedir(), '.chirp', 'config.json');

export function saveConfig(cfg: Config): void {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

export function loadConfig(): Config {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    try {
      fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULTS, null, 2));
    } catch {
      // Read-only home dir edge case — run with defaults.
    }
    return { ...DEFAULTS };
  }
}
