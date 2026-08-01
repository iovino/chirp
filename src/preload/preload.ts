import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('chirp', {
  onStart: (cb: (inputDevice: string) => void) =>
    ipcRenderer.on('rec:start', (_e, inputDevice: string) => cb(inputDevice)),
  onStop: (cb: () => void) => ipcRenderer.on('rec:stop', cb),
  sendAudio: (wav: ArrayBuffer) =>
    ipcRenderer.send('rec:audio', new Uint8Array(wav)),
  sendError: (message: string) => ipcRenderer.send('rec:error', message),
  sendInfo: (message: string) => ipcRenderer.send('rec:info', message),
});
