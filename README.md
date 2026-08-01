# chirp 🐤

Personal push-to-talk dictation. Hold a key, speak, release — the transcript
is pasted into whatever input has focus, in any app. Everything runs locally.

A minimal re-imagining of [voicebox](https://github.com/jamiepine/voicebox)'s
dictation feature, without the rest of the voice studio.

## How it works

```
key down ──► snapshot frontmost app          (paste/darwin.ts captureFocus)
         ──► start mic capture               (renderer/recorder.ts, 16kHz WAV)
key up   ──► whisper.cpp transcribes         (transcribe.ts → whisper-server)
         ──► re-activate the snapshotted app
         ──► save clipboard → stage text → synthetic ⌘V → restore clipboard
```

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

Hold **right Option**, speak, release. A 🔴 in the menu bar means recording,
💭 means transcribing, ⚠️ means check the terminal for an error.

## Config

Click the 🐤 tray icon to pick the **microphone** and **push-to-talk key**
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

## Windows (later)

The OS-specific glue lives behind `src/main/paste/` and the uiohook key hook
is already cross-platform. `paste/win32.ts` has a basic SendKeys
implementation plus TODOs mapping each gap to the voicebox Rust module that
solves it properly (SendInput, AttachThreadInput focus dance, tray icon).

## Known limitations

- Clipboard restore covers text/HTML/RTF/images — copied *files* won't
  survive a dictation (voicebox snapshots every pasteboard format; Electron's
  clipboard API can't).
- Recording starts ~100–200ms after key-down (mic stream is acquired per
  recording so the orange mic indicator isn't permanently on).
- No visual overlay near the cursor — the menu bar emoji is the only
  indicator.
