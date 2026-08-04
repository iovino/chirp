// One preload for all three renderers (recorder, widget, settings) — each
// window just uses the slice of the bridge it needs. Renderer-side types
// for this API live in src/renderer/global.d.ts.

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('chirp', {
  // recorder (hidden capture window)
  onStart: (cb: (inputDevice: string) => void) =>
    ipcRenderer.on('rec:start', (_e, inputDevice: string) => cb(inputDevice)),
  onStop: (cb: () => void) => ipcRenderer.on('rec:stop', cb),
  sendAudio: (wav: ArrayBuffer) =>
    ipcRenderer.send('rec:audio', new Uint8Array(wav)),
  sendError: (message: string) => ipcRenderer.send('rec:error', message),
  sendInfo: (message: string) => ipcRenderer.send('rec:info', message),

  // widget
  onWidgetUpdate: (cb: (msg: unknown) => void) =>
    ipcRenderer.on('widget:update', (_e, msg: unknown) => cb(msg)),
  setWidgetMouse: (interactive: boolean) =>
    ipcRenderer.send('widget:mouse', interactive),
  openSettings: () => ipcRenderer.send('ui:open-settings'),
  copyText: (text: string) => ipcRenderer.send('ui:copy', text),

  // settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  applySettings: (patch: unknown) => ipcRenderer.invoke('settings:set', patch),
  captureKey: () => ipcRenderer.invoke('settings:capture-key'),
  onSettingsChanged: (cb: (snap: unknown) => void) =>
    ipcRenderer.on('settings:changed', (_e, snap: unknown) => cb(snap)),
  openPath: (which: 'config' | 'log') => ipcRenderer.send('ui:open-path', which),
  quitApp: () => ipcRenderer.send('ui:quit'),
});
