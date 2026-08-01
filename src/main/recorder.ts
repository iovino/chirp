// Main-process handle to the hidden recorder window. Mic capture has to
// happen in a renderer (getUserMedia) — same approach as voicebox's dictate
// pill, minus the visible UI. The window is created once at startup and
// never shown.

import { BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';

const STOP_TIMEOUT_MS = 10_000;

export class Recorder {
  private window: BrowserWindow | null = null;
  private pending: {
    resolve: (wav: Buffer) => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
  } | null = null;

  async init(): Promise<void> {
    this.window = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'preload.js'),
        // The window is never shown; without this Chromium throttles the
        // hidden renderer, which can starve ScriptProcessor callbacks.
        backgroundThrottling: false,
      },
    });

    ipcMain.on('rec:audio', (_e, data: Uint8Array) => {
      this.settle((p) => p.resolve(Buffer.from(data)));
    });
    ipcMain.on('rec:error', (_e, message: string) => {
      this.settle((p) => p.reject(new Error(message)));
    });
    ipcMain.on('rec:info', (_e, message: string) => {
      console.log(`[chirp] ${message}`);
    });

    await this.window.loadFile(
      path.join(__dirname, '..', 'renderer', 'recorder.html')
    );
  }

  /** Renderer webContents, for main-initiated queries (device listing). */
  get webContents(): Electron.WebContents | null {
    return this.window?.webContents ?? null;
  }

  start(inputDevice: string): void {
    this.window?.webContents.send('rec:start', inputDevice);
  }

  /** Stop recording and resolve with a 16kHz mono WAV. */
  stop(): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      if (!this.window) return reject(new Error('recorder not initialized'));
      if (this.pending) return reject(new Error('a stop is already in flight'));
      const timer = setTimeout(() => {
        this.settle((p) => p.reject(new Error('recorder timed out')));
      }, STOP_TIMEOUT_MS);
      this.pending = { resolve, reject, timer };
      this.window.webContents.send('rec:stop');
    });
  }

  private settle(fn: (p: NonNullable<typeof this.pending>) => void): void {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    const p = this.pending;
    this.pending = null;
    fn(p);
  }
}
