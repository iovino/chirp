// Windows paste pipeline — functional skeleton, not yet hardened.
//
// TODO when Windows becomes real (voicebox's Rust modules are the map):
// - Focus capture/re-activation: GetForegroundWindow + SetForegroundWindow
//   bracketed by AttachThreadInput (focus_capture.rs win module). Needs a
//   small native addon or a PowerShell + user32 P/Invoke script.
// - Paste synthesis: SendInput Ctrl+V (synthetic_keys.rs) instead of
//   WScript SendKeys, which is flaky with some elevated/UWP targets.
// - Clipboard snapshot: Electron's API covers text/html/rtf/image, which
//   is probably fine; full-format fidelity needs EnumClipboardFormats
//   (clipboard.rs win module).

import { clipboard } from 'electron';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { FocusSnapshot, PasteBackend } from './types';

const run = promisify(execFile);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CONSUME_MS = 400;

export const win32Paste: PasteBackend = {
  async captureFocus(): Promise<FocusSnapshot | null> {
    return null; // TODO: GetForegroundWindow — see header.
  },

  async paste(text: string, _focus: FocusSnapshot | null): Promise<void> {
    const previous = clipboard.readText();
    clipboard.writeText(text);
    try {
      await run('powershell', [
        '-NoProfile',
        '-Command',
        '$w = New-Object -ComObject wscript.shell; $w.SendKeys("^v")',
      ]);
    } finally {
      await sleep(CONSUME_MS);
      if (clipboard.readText() === text && previous) {
        clipboard.writeText(previous);
      }
    }
  },
};
