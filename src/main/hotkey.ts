// Push-to-talk hotkey via a global keyboard hook (uiohook-napi wraps
// libuiohook: CGEventTap on macOS, WH_KEYBOARD_LL on Windows — same hook,
// both platforms). macOS requires Accessibility + Input Monitoring for the
// process that owns the hook (in dev that's the Electron binary).
//
// Keeping this deliberately simpler than voicebox's chord engine: one
// configurable key, key-down starts, key-up stops. OS auto-repeat delivers
// extra keydowns while held, so `held` gates the start event.

import { EventEmitter } from 'events';
import { uIOhook } from 'uiohook-napi';

// libuiohook VC_* codes for keys worth binding. uiohook-napi's UiohookKey
// export doesn't cover the right-hand modifier variants, so they're pinned
// here. Run `npm run keys` and press keys to find any other code.
export const Keycodes = {
  RightAlt: 3640, // right Option on macOS, right Alt on Windows
  RightMeta: 3676, // right Cmd on macOS, right Win on Windows
  LeftAlt: 56, // left Option on macOS, left Alt on Windows
  LeftMeta: 3675, // left Cmd on macOS, left Win on Windows
} as const;

/** Friendly label for a keycode, for the tray menu. */
export function keyName(keycode: number): string {
  const mac = process.platform === 'darwin';
  const names: Record<number, string> = {
    [Keycodes.RightAlt]: mac ? 'right Option' : 'right Alt',
    [Keycodes.RightMeta]: mac ? 'right Cmd' : 'right Win',
    [Keycodes.LeftAlt]: mac ? 'left Option' : 'left Alt',
    [Keycodes.LeftMeta]: mac ? 'left Cmd' : 'left Win',
  };
  return names[keycode] ?? `keycode ${keycode}`;
}

export interface HotkeyEvents {
  start: [];
  stop: [];
}

export class Hotkey extends EventEmitter<HotkeyEvents> {
  private held = false;
  private started = false;

  constructor(
    private keycode: number,
    private logKeys = false
  ) {
    super();
  }

  /** Rebind at runtime — the hook handlers read `this.keycode` per event. */
  setKeycode(keycode: number): void {
    this.keycode = keycode;
    this.held = false;
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    uIOhook.on('keydown', (e) => {
      if (this.logKeys) console.log(`[keys] keydown keycode=${e.keycode}`);
      if (e.keycode === this.keycode && !this.held) {
        this.held = true;
        if (!this.logKeys) this.emit('start');
      }
    });

    uIOhook.on('keyup', (e) => {
      if (e.keycode === this.keycode && this.held) {
        this.held = false;
        if (!this.logKeys) this.emit('stop');
      }
    });

    uIOhook.start();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    uIOhook.stop();
  }
}
