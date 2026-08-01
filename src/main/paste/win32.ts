// Windows paste pipeline, mirroring darwin.ts:
//
//   re-activate captured window → settle → save clipboard → stage text →
//   SendInput Ctrl+V → wait for the target to consume → conditional restore.
//
// The user32 calls (GetForegroundWindow snapshot, SetForegroundWindow
// bracketed by AttachThreadInput, SendInput Ctrl+V — voicebox's
// focus_capture.rs / synthetic_keys.rs, minus the native build) run inside
// a persistent PowerShell worker: Add-Type compiles the C# helper once at
// worker start, then each op is a stdin line → stdout line round-trip, so
// per-dictation cost is milliseconds instead of a ~1s process spawn.

import { clipboard, NativeImage } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { FocusSnapshot, PasteBackend } from './types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Give the target time to repaint/refocus after SetForegroundWindow
 * (slept inside the worker, between activate and Ctrl+V). */
const SETTLE_MS = 120;
/** How long the staged text lives on the clipboard before restore. */
const CONSUME_MS = 400;
/** Per-op deadline; a hung worker is killed and respawned on next use. */
const OP_TIMEOUT_MS = 3000;

// Single-quoted PowerShell here-string, so no $-interpolation inside the
// C# source. Protocol: one request line in → exactly one response line out.
//   focus              → "<hwnd> <pid>"
//   paste <hwnd> <ms>  → "ok" | "err <message>"
const WORKER_PS1 = `
$src = @'
using System;
using System.Runtime.InteropServices;
namespace Chirp {
  public static class Native {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll", SetLastError = true)] public static extern uint SendInput(uint n, INPUT[] inputs, int size);

    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
    // Union: MOUSEINPUT is the largest member and sets sizeof(INPUT).
    [StructLayout(LayoutKind.Explicit)]
    public struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT { public uint type; public InputUnion u; }

    const uint INPUT_KEYBOARD = 1;
    const uint KEYEVENTF_KEYUP = 2;
    const ushort VK_CONTROL = 0x11;
    const ushort VK_V = 0x56;

    static INPUT Key(ushort vk, bool up) {
      INPUT i = new INPUT();
      i.type = INPUT_KEYBOARD;
      i.u.ki.wVk = vk;
      if (up) i.u.ki.dwFlags = KEYEVENTF_KEYUP;
      return i;
    }

    public static string Snapshot() {
      IntPtr h = GetForegroundWindow();
      uint pid;
      GetWindowThreadProcessId(h, out pid);
      return h.ToInt64() + " " + pid;
    }

    public static string PasteInto(long hwnd, int settleMs) {
      IntPtr target = new IntPtr(hwnd);
      if (hwnd != 0 && IsWindow(target) && GetForegroundWindow() != target) {
        // Windows refuses SetForegroundWindow from a background process
        // unless its thread input is attached to the target's thread.
        uint self = GetCurrentThreadId();
        uint pid;
        uint targetThread = GetWindowThreadProcessId(target, out pid);
        AttachThreadInput(self, targetThread, true);
        SetForegroundWindow(target);
        AttachThreadInput(self, targetThread, false);
        System.Threading.Thread.Sleep(settleMs);
      }
      INPUT[] seq = new INPUT[] { Key(VK_CONTROL, false), Key(VK_V, false), Key(VK_V, true), Key(VK_CONTROL, true) };
      uint sent = SendInput((uint)seq.Length, seq, Marshal.SizeOf(typeof(INPUT)));
      if (sent != seq.Length) return "err SendInput sent " + sent + "/" + seq.Length;
      return "ok";
    }
  }
}
'@
Add-Type -TypeDefinition $src
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $parts = $line.Split(' ')
  try {
    switch ($parts[0]) {
      'focus' { [Console]::Out.WriteLine([Chirp.Native]::Snapshot()) }
      'paste' { [Console]::Out.WriteLine([Chirp.Native]::PasteInto([int64]$parts[1], [int]$parts[2])) }
      default { [Console]::Out.WriteLine('err unknown command') }
    }
  } catch {
    [Console]::Out.WriteLine('err ' + $_.Exception.Message)
  }
}
`;

class PasteWorker {
  private proc: ChildProcess | null = null;
  private buffer = '';
  private pending: {
    resolve: (line: string) => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
  }[] = [];

  private ensure(): ChildProcess {
    if (this.proc) return this.proc;

    const script = path.join(os.tmpdir(), 'chirp-paste-worker.ps1');
    fs.writeFileSync(script, WORKER_PS1);
    const proc = spawn(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
    );

    proc.stdout!.setEncoding('utf8');
    proc.stdout!.on('data', (chunk: string) => {
      this.buffer += chunk;
      let nl: number;
      while ((nl = this.buffer.indexOf('\n')) !== -1) {
        const line = this.buffer.slice(0, nl).replace(/\r$/, '');
        this.buffer = this.buffer.slice(nl + 1);
        this.settle((p) => p.resolve(line));
      }
    });
    proc.stderr!.setEncoding('utf8');
    proc.stderr!.on('data', (chunk: string) =>
      console.warn('[chirp] paste worker stderr:', chunk.trim())
    );
    proc.on('exit', () => {
      if (this.proc === proc) this.proc = null;
      while (this.pending.length) {
        this.settle((p) => p.reject(new Error('paste worker exited')));
      }
    });
    proc.on('error', () => proc.emit('exit'));

    this.proc = proc;
    return proc;
  }

  request(cmd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = this.ensure();
      const timer = setTimeout(() => {
        this.settle((p) => p.reject(new Error(`paste worker timed out on: ${cmd}`)));
        proc.kill(); // hung — 'exit' handler clears this.proc for a respawn
      }, OP_TIMEOUT_MS);
      this.pending.push({ resolve, reject, timer });
      proc.stdin!.write(cmd + '\n');
    });
  }

  // Responses arrive in request order; settle the queue head.
  private settle(fn: (p: PasteWorker['pending'][number]) => void): void {
    const p = this.pending.shift();
    if (!p) return;
    clearTimeout(p.timer);
    fn(p);
  }
}

const worker = new PasteWorker();

interface ClipboardSnapshot {
  text: string;
  html: string;
  rtf: string;
  image: NativeImage;
}

export const win32Paste: PasteBackend = {
  async captureFocus(): Promise<FocusSnapshot | null> {
    try {
      const [hwndStr, pidStr] = (await worker.request('focus')).split(' ');
      const hwnd = Number(hwndStr);
      const pid = Number(pidStr);
      if (!Number.isFinite(hwnd) || hwnd === 0) return null;
      return { pid, hwnd };
    } catch (err) {
      console.warn('[chirp] focus snapshot failed:', err);
      return null;
    }
  },

  async paste(text: string, focus: FocusSnapshot | null): Promise<void> {
    const snapshot: ClipboardSnapshot = {
      text: clipboard.readText(),
      html: clipboard.readHTML(),
      rtf: clipboard.readRTF(),
      image: clipboard.readImage(),
    };

    clipboard.writeText(text);
    try {
      const res = await worker.request(`paste ${focus?.hwnd ?? 0} ${SETTLE_MS}`);
      if (res !== 'ok') throw new Error(`synthetic Ctrl+V failed: ${res}`);
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
