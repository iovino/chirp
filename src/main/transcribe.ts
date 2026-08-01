// Whisper STT via a long-lived whisper.cpp `whisper-server` child process.
// The server keeps the model warm between dictations, so per-utterance
// latency is just inference — no model reload like the CLI would cost.

import { spawn, ChildProcess } from 'child_process';
import type { Config } from './config';

export class Transcriber {
  private proc: ChildProcess | null = null;
  private url: string;

  constructor(private cfg: Config) {
    this.url = `http://127.0.0.1:${cfg.whisperPort}/inference`;
  }

  start(): void {
    if (this.proc) return;
    this.proc = spawn(
      this.cfg.whisperServerPath,
      [
        '-m', this.cfg.modelPath,
        '--host', '127.0.0.1',
        '--port', String(this.cfg.whisperPort),
        '-l', this.cfg.language,
        '-t', String(this.cfg.threads),
      ],
      { stdio: 'ignore' }
    );
    this.proc.on('error', (err) => {
      console.error(
        `[chirp] failed to launch ${this.cfg.whisperServerPath}: ${err.message}\n` +
          '        Is whisper.cpp installed? (brew install whisper-cpp)'
      );
      this.proc = null;
    });
    this.proc.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        console.error(
          `[chirp] whisper-server exited with code ${code} — check that the model file exists: ${this.cfg.modelPath}`
        );
      }
      this.proc = null;
    });
  }

  stop(): void {
    this.proc?.kill();
    this.proc = null;
  }

  /** Relaunch the server, picking up a changed cfg.modelPath. The first
   * transcription after a switch waits on the retry loop while the new
   * model loads. */
  restart(): void {
    this.stop();
    this.start();
  }

  /** Transcribe a 16kHz mono WAV. Returns "" for silence/blank audio. */
  async transcribe(wav: Buffer): Promise<string> {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'audio.wav');
    form.append('response_format', 'json');
    form.append('temperature', '0.0');

    const res = await this.fetchWithRetry(form);
    const json = (await res.json()) as { text?: string; error?: string };
    if (json.error) throw new Error(`whisper-server: ${json.error}`);

    return (json.text ?? '')
      .replace(/\[(BLANK_AUDIO|MUSIC|NOISE)\]/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // First request after launch races model load; retry connection refusals
  // for up to ~30s before giving up.
  private async fetchWithRetry(form: FormData): Promise<Response> {
    const deadline = Date.now() + 30_000;
    for (;;) {
      try {
        const res = await fetch(this.url, { method: 'POST', body: form });
        if (!res.ok) throw new Error(`whisper-server HTTP ${res.status}`);
        return res;
      } catch (err) {
        const connRefused =
          err instanceof TypeError || String(err).includes('ECONNREFUSED');
        if (!connRefused || Date.now() > deadline) throw err;
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  }
}
