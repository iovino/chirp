// Mirror console output to ~/.chirp/chirp.log so failures can be diagnosed
// after the fact — in dev the terminal scrolls away, and a packaged app has
// no terminal at all.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export const LOG_PATH = path.join(os.homedir(), '.chirp', 'chirp.log');

export function initLogging(): void {
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  const stream = fs.createWriteStream(LOG_PATH, { flags: 'a' });

  for (const level of ['log', 'warn', 'error'] as const) {
    const orig = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      orig(...args);
      const line = args
        .map((a) =>
          a instanceof Error
            ? (a.stack ?? a.message)
            : typeof a === 'string'
              ? a
              : JSON.stringify(a)
        )
        .join(' ');
      stream.write(`${new Date().toISOString()} [${level}] ${line}\n`);
    };
  }
}
