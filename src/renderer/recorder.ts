// Hidden-window mic capture. Records 16kHz mono PCM via Web Audio and
// returns a WAV buffer to the main process on stop.
//
// NOTE: this file must stay a plain script (no import/export) — it is
// loaded directly by recorder.html without a bundler, and a top-level
// import would make tsc emit CommonJS `require` calls the browser can't run.
//
// The mic stream is acquired per-recording and released on stop so macOS's
// orange mic indicator only shows while the key is held. Costs ~100-200ms
// at the front of each recording, which push-to-talk reaction time absorbs.
//
// Bridge types (window.chirp) are declared in global.d.ts.

/** Whisper wants 16kHz mono. */
const TARGET_RATE = 16_000;

let audioCtx: AudioContext | null = null;
let stream: MediaStream | null = null;
let source: MediaStreamAudioSourceNode | null = null;
let processor: ScriptProcessorNode | null = null;
let chunks: Float32Array[] = [];
let captureRate = TARGET_RATE;
let recording = false;

/** Resolve a config `inputDevice` substring to a deviceId, or null for the
 * system default. */
async function pickDeviceId(substr: string): Promise<string | null> {
  if (!substr) return null;
  const devices = await navigator.mediaDevices.enumerateDevices();
  const wanted = substr.toLowerCase();
  const match = devices.find(
    (d) => d.kind === 'audioinput' && d.label.toLowerCase().includes(wanted)
  );
  if (!match) {
    window.chirp.sendInfo(
      `input device matching "${substr}" not found — using system default. ` +
        `Available: ${devices
          .filter((d) => d.kind === 'audioinput')
          .map((d) => JSON.stringify(d.label))
          .join(', ')}`
    );
    return null;
  }
  return match.deviceId;
}

async function startRecording(inputDevice: string): Promise<void> {
  if (recording) return;
  recording = true;
  chunks = [];

  const deviceId = await pickDeviceId(inputDevice);
  stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  window.chirp.sendInfo(
    `recording from ${JSON.stringify(stream.getAudioTracks()[0]?.label ?? 'unknown')}`
  );

  // Capture at the context's native rate (usually the mic's 48kHz) and
  // downsample on stop. Forcing the context to 16kHz here silences the
  // capture: Chromium's MediaStreamAudioSourceNode outputs zeros when the
  // context rate doesn't match the stream's native rate.
  audioCtx = new AudioContext();
  if (audioCtx.state === 'suspended') await audioCtx.resume();
  captureRate = audioCtx.sampleRate;
  source = audioCtx.createMediaStreamSource(stream);
  processor = audioCtx.createScriptProcessor(4096, 1, 1);
  processor.onaudioprocess = (e) => {
    if (recording) chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  };

  // ScriptProcessor only fires while connected to the destination; the
  // zero-gain node keeps the mic from echoing out of the speakers.
  const mute = audioCtx.createGain();
  mute.gain.value = 0;
  source.connect(processor);
  processor.connect(mute);
  mute.connect(audioCtx.destination);
}

async function stopRecording(): Promise<ArrayBuffer> {
  recording = false;

  processor?.disconnect();
  source?.disconnect();
  stream?.getTracks().forEach((t) => t.stop());
  await audioCtx?.close();
  processor = null;
  source = null;
  stream = null;
  audioCtx = null;

  const total = chunks.reduce((n, c) => n + c.length, 0);
  const samples = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    samples.set(c, offset);
    offset += c.length;
  }
  chunks = [];

  return encodeWav(resample(samples, captureRate, TARGET_RATE), TARGET_RATE);
}

/** Linear-interpolation resampler. No low-pass filter — the aliasing this
 * lets through is inaudible to Whisper for speech. */
function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = pos - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}

/** Float32 samples → 16-bit PCM mono WAV. */
function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeString = (pos: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(pos + i, s.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let pos = 44;
  for (let i = 0; i < samples.length; i++, pos += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(pos, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return buffer;
}

window.chirp.onStart((inputDevice) => {
  startRecording(inputDevice).catch((err) => {
    recording = false;
    window.chirp.sendError(`mic capture failed: ${err?.message ?? err}`);
  });
});

window.chirp.onStop(() => {
  stopRecording()
    .then((wav) => window.chirp.sendAudio(wav))
    .catch((err) =>
      window.chirp.sendError(`recording stop failed: ${err?.message ?? err}`)
    );
});
