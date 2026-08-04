// Push-to-talk hotkey via a global keyboard hook (uiohook-napi wraps
// libuiohook: CGEventTap on macOS, WH_KEYBOARD_LL on Windows — same hook,
// both platforms). macOS requires Accessibility + Input Monitoring for the
// process that owns the hook (in dev that's the Electron binary).
//
// Keeping this deliberately simpler than voicebox's chord engine: one
// configurable key, key-down starts, key-up stops. OS auto-repeat delivers
// extra keydowns while held, so `held` gates the start event.

import { EventEmitter } from 'events';
import { uIOhook, UiohookKey } from 'uiohook-napi';

const mac = process.platform === 'darwin';

// UiohookKey names left/right modifier pairs "Alt"/"AltRight" and knows
// nothing about macOS naming, so those get friendly overrides.
const NAME_OVERRIDES: Record<number, string> = {
  [UiohookKey.Alt]: mac ? 'left Option' : 'left Alt',
  [UiohookKey.AltRight]: mac ? 'right Option' : 'right Alt',
  [UiohookKey.Meta]: mac ? 'left Cmd' : 'left Win',
  [UiohookKey.MetaRight]: mac ? 'right Cmd' : 'right Win',
  [UiohookKey.Ctrl]: 'left Ctrl',
  [UiohookKey.CtrlRight]: 'right Ctrl',
  [UiohookKey.Shift]: 'left Shift',
  [UiohookKey.ShiftRight]: 'right Shift',
};

// keycode → display name ("ArrowLeft" → "Arrow Left"), plus the set of keys
// that insert a character when pressed — legal to bind, but holding one to
// dictate also types into the focused app, so the UI warns about them.
const BASE_NAMES: Record<number, string> = {};
const PRINTABLE = new Set<number>([
  UiohookKey.Space,
  UiohookKey.Tab,
  UiohookKey.Enter,
  UiohookKey.NumpadEnter,
]);
for (const [name, code] of Object.entries(UiohookKey) as [string, number][]) {
  BASE_NAMES[code] = name.replace(/(?<=[a-z])(?=[A-Z0-9])/g, ' ');
  if (
    /^[A-Z0-9]$/.test(name) || // letters and digit row
    /^Numpad(\d|Multiply|Add|Subtract|Decimal|Divide)$/.test(name) ||
    /^(Semicolon|Equal|Comma|Minus|Period|Slash|Backquote|BracketLeft|BracketRight|Backslash|Quote)$/.test(name)
  ) {
    PRINTABLE.add(code);
  }
}

/** Friendly label for a keycode, for the settings window and widget. */
export function keyName(keycode: number): string {
  return NAME_OVERRIDES[keycode] ?? BASE_NAMES[keycode] ?? `keycode ${keycode}`;
}

/** True if holding this key to dictate would also type into the focused
 * app (the global hook is listen-only — it cannot swallow events). */
export function isPrintable(keycode: number): boolean {
  return PRINTABLE.has(keycode);
}

export interface HotkeyEvents {
  start: [];
  stop: [];
}

export class Hotkey extends EventEmitter<HotkeyEvents> {
  private held = false;
  private started = false;
  private capture: {
    resolve: (keycode: number | null) => void;
    timer: NodeJS.Timeout;
  } | null = null;

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

  /** Capture the next keydown anywhere on the system (the settings "press a
   * key to bind it" flow). Resolves with its keycode, or null on Escape or
   * timeout. While pending, keydowns are diverted here instead of starting
   * a dictation. */
  captureNext(timeoutMs = 10_000): Promise<number | null> {
    this.finishCapture(null); // at most one pending capture
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.finishCapture(null), timeoutMs);
      this.capture = { resolve, timer };
    });
  }

  private finishCapture(keycode: number | null): void {
    if (!this.capture) return;
    clearTimeout(this.capture.timer);
    const { resolve } = this.capture;
    this.capture = null;
    resolve(keycode);
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    uIOhook.on('keydown', (e) => {
      if (this.logKeys) console.log(`[keys] keydown keycode=${e.keycode}`);
      if (this.capture) {
        this.finishCapture(e.keycode === UiohookKey.Escape ? null : e.keycode);
        return;
      }
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
