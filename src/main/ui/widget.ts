// Floating status widget — a small always-on-top pill at the bottom-center
// of the screen (VoiceBox / Wispr Flow style). Critical constraint: it must
// NEVER take focus, because the paste pipeline targets whatever app has
// focus. Hence focusable:false + showInactive().
//
// The window is a fixed transparent box larger than the pill (room for the
// transcript bubble). Transparent pixels in Electron still swallow clicks,
// so the window defaults to click-through (setIgnoreMouseEvents with
// forward:true keeps hover events flowing) and the renderer toggles
// interactivity on when the pointer is over the pill/bubble ('widget:mouse').

import { BrowserWindow, screen } from 'electron';
import * as path from 'path';
import type { DictationEngine } from '../engine';

const WIDTH = 480;
const HEIGHT = 220;
const BOTTOM_MARGIN = 24;

export type WidgetMessage =
  | { kind: 'state'; state: 'idle' | 'recording' | 'processing' }
  | { kind: 'result'; text: string; pasted: boolean }
  | { kind: 'error'; message: string };

export class WidgetWindow {
  private window: BrowserWindow | null = null;

  async init(engine: DictationEngine): Promise<void> {
    this.window = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      closable: false,
      focusable: false,
      skipTaskbar: true,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '..', '..', 'preload', 'preload.js'),
        backgroundThrottling: false,
      },
    });
    // 'screen-saver' floats above full-screen apps, matching Wispr Flow.
    this.window.setAlwaysOnTop(true, 'screen-saver');
    this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    // Default click-through; the renderer opts back in over the pill.
    this.window.setIgnoreMouseEvents(true, { forward: true });

    this.window.webContents.ipc.on('widget:mouse', (_e, interactive: boolean) => {
      this.window?.setIgnoreMouseEvents(!interactive, { forward: true });
    });

    engine.on('state', (state) => this.send({ kind: 'state', state }));
    engine.on('result', (r) => this.send({ kind: 'result', ...r }));
    engine.on('error', (message) => this.send({ kind: 'error', message }));

    await this.window.loadFile(
      path.join(__dirname, '..', '..', 'renderer', 'widget.html')
    );
    this.position();
    screen.on('display-metrics-changed', () => this.position());
    this.window.showInactive();
  }

  private position(): void {
    if (!this.window) return;
    const { workArea } = screen.getPrimaryDisplay();
    this.window.setBounds({
      x: workArea.x + Math.round((workArea.width - WIDTH) / 2),
      y: workArea.y + workArea.height - HEIGHT - BOTTOM_MARGIN,
      width: WIDTH,
      height: HEIGHT,
    });
  }

  private send(msg: WidgetMessage): void {
    this.window?.webContents.send('widget:update', msg);
  }
}
