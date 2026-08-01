// macOS paste pipeline, a slimmed-down port of voicebox's
// clipboard.rs + synthetic_keys.rs + focus_capture.rs:
//
//   activate captured app → settle → save clipboard → stage text →
//   synthetic ⌘V → wait for the target to consume → conditional restore.
//
// Differences from voicebox, deliberate for a personal tool:
// - Clipboard snapshot covers text/html/rtf/image via Electron's clipboard
//   API instead of every NSPasteboard UTI — file references and exotic
//   formats won't survive the round-trip.
// - ⌘V is synthesized through `osascript` (System Events keystroke) instead
//   of CGEventPost FFI. Same Accessibility permission requirement, zero
//   native code.
// - "Did someone else write to the clipboard during the paste window?" is
//   detected by comparing readText() to our staged text rather than
//   NSPasteboard.changeCount (Electron doesn't expose it). If the clipboard
//   no longer holds our text, the newer content wins and we skip restore.

import { clipboard, NativeImage } from 'electron';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { FocusSnapshot, PasteBackend } from './types';

const run = promisify(execFile);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Give AppKit time to re-order windows and restore the last-focused field
 * after activation (voicebox's POST_ACTIVATE_SETTLE_MS). */
const SETTLE_MS = 120;
/** How long the staged text lives on the clipboard before restore
 * (voicebox's PASTE_CONSUME_MS). */
const CONSUME_MS = 400;

interface ClipboardSnapshot {
  text: string;
  html: string;
  rtf: string;
  image: NativeImage;
}

async function osascript(script: string): Promise<string> {
  const { stdout } = await run('osascript', ['-e', script]);
  return stdout.trim();
}

export const darwinPaste: PasteBackend = {
  async captureFocus(): Promise<FocusSnapshot | null> {
    try {
      const out = await osascript(
        'tell application "System Events" to get unix id of first application process whose frontmost is true'
      );
      const pid = parseInt(out, 10);
      return Number.isFinite(pid) ? { pid } : null;
    } catch {
      return null;
    }
  },

  async paste(text: string, focus: FocusSnapshot | null): Promise<void> {
    if (focus) {
      try {
        await osascript(
          `tell application "System Events" to set frontmost of (first application process whose unix id is ${focus.pid}) to true`
        );
        await sleep(SETTLE_MS);
      } catch (err) {
        // Target app quit since record-start — fall through and paste into
        // whatever is focused now rather than dropping the transcript.
        console.warn('[chirp] could not re-activate target app:', err);
      }
    }

    const snapshot: ClipboardSnapshot = {
      text: clipboard.readText(),
      html: clipboard.readHTML(),
      rtf: clipboard.readRTF(),
      image: clipboard.readImage(),
    };

    clipboard.writeText(text);
    try {
      await osascript(
        'tell application "System Events" to keystroke "v" using command down'
      );
    } catch (err) {
      throw new Error(
        `Synthetic ⌘V failed — grant Accessibility to the app running chirp ` +
          `(System Settings → Privacy & Security → Accessibility). ${err}`
      );
    } finally {
      await sleep(CONSUME_MS);
      if (clipboard.readText() === text) {
        restore(snapshot);
      } else {
        console.warn(
          '[chirp] clipboard changed during paste window — keeping newer content'
        );
      }
    }
  },
};

function restore(snapshot: ClipboardSnapshot): void {
  const data: Electron.Data = {};
  if (snapshot.text) data.text = snapshot.text;
  if (snapshot.html) data.html = snapshot.html;
  if (snapshot.rtf) data.rtf = snapshot.rtf;
  if (!snapshot.image.isEmpty()) data.image = snapshot.image;

  if (Object.keys(data).length > 0) {
    clipboard.write(data);
  } else {
    clipboard.clear();
  }
}
