import type { PasteBackend } from './types';
import { darwinPaste } from './darwin';
import { win32Paste } from './win32';

export type { FocusSnapshot, PasteBackend } from './types';

export function getPasteBackend(): PasteBackend {
  switch (process.platform) {
    case 'darwin':
      return darwinPaste;
    case 'win32':
      return win32Paste;
    default:
      throw new Error(`chirp does not support platform: ${process.platform}`);
  }
}
