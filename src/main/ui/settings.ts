// Settings window — a normal, focusable window (unlike the widget) opened
// from the widget's gear or the tray. Owns the settings IPC surface:
// renderers pull a snapshot with settings:get, mutate with settings:set,
// and every window gets a 'settings:changed' push so labels stay current.

import { app, BrowserWindow, ipcMain, webContents } from 'electron';
import * as path from 'path';
import type { DictationEngine } from '../engine';
import { MODELS_DIR } from '../engine';
import { isPrintable, keyName } from '../hotkey';

export interface SettingsSnapshot {
  version: string;
  keycode: number;
  keyLabel: string;
  /** True when the bound key types a character while held (the hook can't
   * swallow events) — the settings UI shows a warning. */
  keyIsPrintable: boolean;
  inputDevice: string;
  devices: string[];
  modelPath: string;
  models: { file: string; label: string; path: string }[];
}

export interface SettingsPatch {
  inputDevice?: string;
  modelPath?: string;
}

export class SettingsWindow {
  private window: BrowserWindow | null = null;

  constructor(private engine: DictationEngine) {}

  init(): void {
    ipcMain.handle('settings:get', () => this.snapshot());
    ipcMain.handle('settings:capture-key', async () => {
      const code = await this.engine.captureKeycode();
      if (code === null) return this.snapshot(); // Escape or timeout
      this.engine.setKeycode(code);
      console.log(`[chirp] push-to-talk key → ${keyName(code)}`);
      return this.broadcast();
    });
    ipcMain.handle('settings:set', async (_e, patch: SettingsPatch) => {
      if (typeof patch.inputDevice === 'string') {
        this.engine.setInputDevice(patch.inputDevice);
        console.log(
          `[chirp] input device → ${patch.inputDevice ? JSON.stringify(patch.inputDevice) : 'system default'}`
        );
      }
      if (typeof patch.modelPath === 'string') {
        this.engine.setModel(patch.modelPath);
        console.log(`[chirp] model → ${path.basename(patch.modelPath)} (loading on next dictation)`);
      }
      return this.broadcast();
    });
  }

  /** Push the current snapshot to every renderer (widget shows the key
   * label too) and return it. */
  private async broadcast(): Promise<SettingsSnapshot> {
    const snap = await this.snapshot();
    for (const wc of webContents.getAllWebContents()) {
      wc.send('settings:changed', snap);
    }
    return snap;
  }

  show(): void {
    if (this.window) {
      this.window.show();
      this.window.focus();
      return;
    }
    this.window = new BrowserWindow({
      width: 420,
      height: 560,
      title: 'chirp settings',
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '..', '..', 'preload', 'preload.js'),
      },
    });
    this.window.on('closed', () => (this.window = null));
    void this.window
      .loadFile(path.join(__dirname, '..', '..', 'renderer', 'settings.html'))
      .then(() => this.window?.show());
  }

  private async snapshot(): Promise<SettingsSnapshot> {
    const cfg = this.engine.cfg;
    return {
      version: app.getVersion(),
      keycode: cfg.keycode,
      keyLabel: keyName(cfg.keycode),
      keyIsPrintable: isPrintable(cfg.keycode),
      inputDevice: cfg.inputDevice,
      devices: await this.engine.listInputDevices(),
      modelPath: cfg.modelPath,
      models: this.engine.listModels().map((file) => ({
        file,
        label: file.replace(/^ggml-/, '').replace(/\.bin$/, ''),
        path: path.join(MODELS_DIR, file),
      })),
    };
  }
}
