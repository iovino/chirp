# chirp 🐤

Personal push-to-talk dictation. Hold a key, speak, release — the transcript
is pasted into whatever input has focus, in any app. Everything runs locally.

A minimal re-imagining of [voicebox](https://github.com/jamiepine/voicebox)'s
dictation feature, without the rest of the voice studio.

## How it works

```
key down ──► snapshot frontmost app          (paste/<platform>.ts captureFocus)
         ──► start mic capture               (renderer/recorder.ts, 16kHz WAV)
key up   ──► whisper.cpp transcribes         (transcribe.ts → whisper-server)
         ──► re-activate the snapshotted app
         ──► save clipboard → stage text → synthetic ⌘V → restore clipboard
         ──► …or, if there was no paste target (or the paste failed), the
             transcript stays on the clipboard and the widget offers a Copy button
```

The whole pipeline lives in `src/main/engine.ts` (`DictationEngine`), which
emits `state`/`result`/`error` events and takes settings commands. The UI —
floating widget, settings window, tray — consists of thin views on those
events; OS-specific glue is isolated behind `src/main/paste/`.

The clipboard save/paste/conditional-restore dance and the focus snapshot are
ports of voicebox's `clipboard.rs`, `synthetic_keys.rs`, and
`focus_capture.rs` (MIT).

## Setup (macOS)

```sh
# 1. Dependencies
npm install
brew install whisper-cpp

# 2. Whisper model (~140MB; see other sizes below)
mkdir -p ~/.chirp/models
curl -L -o ~/.chirp/models/ggml-base.en.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin

# 3. Run
npm start
```

### Permissions

On first run, macOS will ask for / require three grants. In dev they attach
to the **Electron** binary (`node_modules/electron/dist/Electron.app`) — or
to your terminal app, depending on how you launch:

| Permission | Why | Where |
|---|---|---|
| Microphone | recording | prompted automatically |
| Accessibility | synthetic ⌘V + frontmost-app queries | System Settings → Privacy & Security → Accessibility |
| Input Monitoring | the global key hook | System Settings → Privacy & Security → Input Monitoring |

If the hotkey does nothing, it's Input Monitoring. If it records but nothing
pastes, it's Accessibility. Restart chirp after granting.

## Usage

Hold **right Option**, speak, release. A small pill widget at the
bottom-center of the screen shows what's happening: red bars while
listening, blue shimmer while transcribing. After a dictation, a toast
shows what was pasted. If there was nothing to paste into (or the paste
failed), the transcript is copied to the clipboard instead and a bubble
with the text and a **Copy** button stays on screen until dismissed.

The widget never takes focus, so it can't steal the paste target. A small
white bird in the menu bar is the escape hatch — Settings and Quit stay
reachable there even if the widget is ever unclickable.

## Config

Hover the widget and click the **⚙ gear** (or use the tray icon →
Settings…) to pick the **push-to-talk key**, **microphone**, and **model**
(choices persist to config), or to open the config/log files.

Everything else lives in `~/.chirp/config.json` (created on first run):

- `keycode` — push-to-talk key. Default `3640` (right Option); `3676` is
  right Cmd. Find any key's code with `npm run keys`.
- `modelPath` — swap models freely: `ggml-small.en.bin` is noticeably more
  accurate, `ggml-large-v3-turbo.bin` is the best that still feels instant
  on Apple Silicon. Download from
  [huggingface.co/ggerganov/whisper.cpp](https://huggingface.co/ggerganov/whisper.cpp/tree/main).
- `language` — Whisper language hint (use a non-`.en` model for non-English).
- `inputDevice` — case-insensitive substring of the mic to record from
  (empty = system default). **Gotcha:** with the MacBook lid closed the
  built-in mic still appears as default but delivers pure silence — pin an
  external mic here if you dock clamshell-style.

## Windows (port in progress)

Already cross-platform: the engine, the uiohook key hook, the getUserMedia
recorder, and the widget/settings UI (all web tech). What Windows still
needs:

**Dev setup** — `npm install && npm start` should work as-is (the build
script is plain node). whisper.cpp has no brew equivalent: download a
release from
[github.com/ggml-org/whisper.cpp/releases](https://github.com/ggml-org/whisper.cpp/releases)
(or build it), then either put `whisper-server.exe` on PATH or set
`whisperServerPath` in `%USERPROFILE%\.chirp\config.json`. Models go in
`%USERPROFILE%\.chirp\models\`. No Accessibility/Input Monitoring
equivalents exist — only the mic permission prompt.

**Known gaps** (voicebox's Rust modules are the reference for each):

- `paste/win32.ts` `captureFocus` returns `null`, so today every dictation
  takes the clipboard-fallback path (transcript on clipboard + widget Copy
  bubble) — usable, but no auto-paste. Fix: `GetForegroundWindow` /
  `SetForegroundWindow` + `AttachThreadInput` (`focus_capture.rs`); a small
  FFI layer like [koffi](https://koffi.dev) avoids a native build toolchain.
- Paste synthesis is WScript `SendKeys` — flaky with elevated/UWP targets;
  replace with `SendInput` Ctrl+V (`synthetic_keys.rs`).
- The tray uses a macOS template PNG; Windows needs an `.ico` (and the
  adaptive template-color behavior is macOS-only).
- Untested: widget `focusable:false` + click-through behavior on Windows,
  right-Alt keycode (3640) on Windows keyboards — `npm run keys` to verify.

## Known limitations

- Clipboard restore covers text/HTML/RTF/images — copied *files* won't
  survive a dictation (voicebox snapshots every pasteboard format; Electron's
  clipboard API can't).
- Recording starts ~100–200ms after key-down (mic stream is acquired per
  recording so the orange mic indicator isn't permanently on).
- The widget is pinned to the bottom-center of the primary display; it
  doesn't follow the cursor across monitors yet.
