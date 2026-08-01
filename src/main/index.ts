// chirp — hold a key, speak, release; the transcript is pasted into
// whatever input has focus.
//
// Flow per dictation (mirrors voicebox's pipeline, minus everything else):
//   key down  → snapshot frontmost app, start mic capture, tray shows 🔴
//   key up    → stop capture → whisper.cpp transcribe → re-activate the
//               captured app → clipboard-stage → synthetic paste → restore

import {
  app,
  Menu,
  Tray,
  nativeImage,
  shell,
  systemPreferences,
} from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { initLogging, LOG_PATH } from './log';
import { loadConfig, saveConfig, CONFIG_PATH } from './config';
import { Hotkey, Keycodes, keyName } from './hotkey';
import { Recorder } from './recorder';
import { Transcriber } from './transcribe';
import { getPasteBackend, FocusSnapshot } from './paste';

initLogging();
const cfg = loadConfig();
const logKeys = process.argv.includes('--log-keys');

const IDLE_TITLE = '🐤';
const RECORDING_TITLE = '🔴';
const BUSY_TITLE = '💭';
const ERROR_TITLE = '⚠️';

let tray: Tray | null = null;
let state: 'idle' | 'recording' | 'processing' = 'idle';

function setTitle(title: string): void {
  tray?.setTitle(title);
}

function flashError(err: unknown): void {
  console.error('[chirp]', err);
  setTitle(ERROR_TITLE);
  setTimeout(() => {
    if (state === 'idle') setTitle(IDLE_TITLE);
  }, 2000);
}

async function main(): Promise<void> {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  await app.whenReady();
  app.dock?.hide();

  if (process.platform === 'darwin') {
    const micGranted = await systemPreferences.askForMediaAccess('microphone');
    console.log(
      `[chirp] started — key=${cfg.keycode}, mic=${micGranted ? 'granted' : 'DENIED'}, ` +
        `accessibility=${systemPreferences.isTrustedAccessibilityClient(false) ? 'trusted' : 'NOT TRUSTED'}`
    );
  }

  const recorder = new Recorder();
  await recorder.init();

  /** Live-enumerate audio inputs via the recorder renderer (only place
   * with access to navigator.mediaDevices). */
  async function listInputDevices(): Promise<string[]> {
    try {
      const labels: string[] = await recorder.webContents!.executeJavaScript(
        `navigator.mediaDevices.enumerateDevices()
           .then(ds => ds.filter(d => d.kind === 'audioinput').map(d => d.label))`
      );
      return labels.filter(Boolean);
    } catch (err) {
      console.warn('[chirp] device enumeration failed:', err);
      return [];
    }
  }

  const MODELS_DIR = path.join(os.homedir(), '.chirp', 'models');

  function listModels(): string[] {
    try {
      return fs
        .readdirSync(MODELS_DIR)
        .filter((f) => f.endsWith('.bin'))
        .sort();
    } catch {
      return [];
    }
  }

  function buildMenu(devices: string[]): Menu {
    const deviceItems: Electron.MenuItemConstructorOptions[] = [
      {
        label: 'System default',
        type: 'radio',
        checked: cfg.inputDevice === '',
        click: () => {
          cfg.inputDevice = '';
          saveConfig(cfg);
          console.log('[chirp] input device → system default');
        },
      },
      ...devices.map((label): Electron.MenuItemConstructorOptions => ({
        label,
        type: 'radio',
        checked:
          cfg.inputDevice !== '' &&
          label.toLowerCase().includes(cfg.inputDevice.toLowerCase()),
        click: () => {
          cfg.inputDevice = label;
          saveConfig(cfg);
          console.log(`[chirp] input device → ${JSON.stringify(label)}`);
        },
      })),
    ];

    const keyItems: Electron.MenuItemConstructorOptions[] = (
      Object.values(Keycodes) as number[]
    ).map((code) => ({
      label: keyName(code),
      type: 'radio',
      checked: cfg.keycode === code,
      click: () => {
        cfg.keycode = code;
        saveConfig(cfg);
        hotkey.setKeycode(code);
        console.log(`[chirp] push-to-talk key → ${keyName(code)}`);
      },
    }));

    const models = listModels();
    const modelItems: Electron.MenuItemConstructorOptions[] = models.length
      ? models.map((file) => ({
          label: file.replace(/^ggml-/, '').replace(/\.bin$/, ''),
          type: 'radio' as const,
          checked: path.join(MODELS_DIR, file) === cfg.modelPath,
          click: () => {
            cfg.modelPath = path.join(MODELS_DIR, file);
            saveConfig(cfg);
            transcriber.restart();
            console.log(`[chirp] model → ${file} (loading on next dictation)`);
          },
        }))
      : [{ label: `no models in ${MODELS_DIR}`, enabled: false }];

    return Menu.buildFromTemplate([
      { label: `chirp — hold ${keyName(cfg.keycode)} to dictate`, enabled: false },
      { type: 'separator' },
      { label: 'Microphone', submenu: deviceItems },
      { label: 'Push-to-talk key', submenu: keyItems },
      { label: 'Model', submenu: modelItems },
      { type: 'separator' },
      { label: 'Open config file', click: () => void shell.openPath(CONFIG_PATH) },
      { label: 'Open log file', click: () => void shell.openPath(LOG_PATH) },
      { type: 'separator' },
      { label: 'Quit', role: 'quit' },
    ]);
  }

  // Tray: empty icon + emoji title renders as a text-only menu bar item on
  // macOS. No setContextMenu — the menu is rebuilt on each click so the
  // device list and radio states are always current.
  // TODO(windows): a real .ico is required for the tray to show.
  tray = new Tray(nativeImage.createEmpty());
  setTitle(IDLE_TITLE);
  const showMenu = async () => {
    tray?.popUpContextMenu(buildMenu(await listInputDevices()));
  };
  tray.on('click', showMenu);
  tray.on('right-click', showMenu);

  const transcriber = new Transcriber(cfg);
  transcriber.start();
  app.on('will-quit', () => transcriber.stop());

  const paste = getPasteBackend();
  const hotkey = new Hotkey(cfg.keycode, logKeys);

  if (logKeys) {
    console.log('[keys] press keys to see their uiohook keycodes; Ctrl+C to exit');
  }

  let focusPromise: Promise<FocusSnapshot | null> = Promise.resolve(null);
  let startedAt = 0;

  hotkey.on('start', () => {
    if (state !== 'idle') return;
    state = 'recording';
    startedAt = Date.now();
    // Runs concurrently with the recording, so its ~50ms osascript cost
    // never shows up as latency.
    focusPromise = paste.captureFocus();
    recorder.start(cfg.inputDevice);
    setTitle(RECORDING_TITLE);
  });

  hotkey.on('stop', async () => {
    if (state !== 'recording') return;
    state = 'processing';
    setTitle(BUSY_TITLE);
    try {
      const duration = Date.now() - startedAt;
      const wav = await recorder.stop();
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
      if (duration >= cfg.minDurationMs) {
        const text = await transcriber.transcribe(wav);
        console.log(`[chirp] transcript: ${JSON.stringify(text)}`);
        if (text) {
          const focus = await focusPromise;
          console.log(`[chirp] pasting into pid=${focus?.pid ?? 'current focus'}`);
          await paste.paste(text, focus);
          console.log('[chirp] paste complete');
        }
      } else {
        console.log('[chirp] too short — ignored as accidental tap');
      }
      setTitle(IDLE_TITLE);
    } catch (err) {
      flashError(err);
    } finally {
      state = 'idle';
    }
  });

  hotkey.start();
  app.on('will-quit', () => hotkey.stop());
}

main().catch((err) => {
  console.error('[chirp] fatal:', err);
  app.quit();
});
