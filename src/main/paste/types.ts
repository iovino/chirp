/** Which app owned focus when the hotkey went down. Captured at
 * record-start so the paste lands in the right app even if focus drifts
 * during the transcription window (voicebox's focus_capture.rs trick). */
export interface FocusSnapshot {
  pid: number;
  /** win32 only: HWND of the foreground window, for SetForegroundWindow. */
  hwnd?: number;
}

export interface PasteBackend {
  /** Snapshot the frontmost app. Never throws — null means "paste into
   * whatever is focused at paste time". */
  captureFocus(): Promise<FocusSnapshot | null>;
  /** Deliver text into the focused input: re-activate the captured app,
   * stage text on the clipboard, synthesize the paste accelerator, then
   * restore the user's original clipboard. */
  paste(text: string, focus: FocusSnapshot | null): Promise<void>;
}
