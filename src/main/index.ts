// chirp — hold a key, speak, release; the transcript is pasted into
// whatever input has focus.
//
// This file is just the composition root. The pipeline lives in
// DictationEngine (engine.ts); the UI surfaces — floating widget, settings
// window, and a minimal tray — are thin views wired to engine events here.

import { app, clipboard, ipcMain, Menu, shell, systemPreferences, Tray, nativeImage } from 'electron';
import * as path from 'path';
import { initLogging, LOG_PATH } from './log';
import { loadConfig, CONFIG_PATH } from './config';
import { DictationEngine } from './engine';
import { WidgetWindow } from './ui/widget';
import { SettingsWindow } from './ui/settings';

initLogging();
const cfg = loadConfig();
const logKeys = process.argv.includes('--log-keys');

async function main(): Promise<void> {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  await app.whenReady();
  app.dock?.hide();
  // Tray app: keep running when the settings window closes.
  app.on('window-all-closed', () => {});

  if (process.platform === 'darwin') {
    const micGranted = await systemPreferences.askForMediaAccess('microphone');
    console.log(
      `[chirp] started — key=${cfg.keycode}, mic=${micGranted ? 'granted' : 'DENIED'}, ` +
        `accessibility=${systemPreferences.isTrustedAccessibilityClient(false) ? 'trusted' : 'NOT TRUSTED'}`
    );
  }

  const engine = new DictationEngine(cfg, logKeys);
  await engine.init();
  app.on('will-quit', () => engine.stop());

  if (logKeys) {
    console.log('[keys] press keys to see their uiohook keycodes; Ctrl+C to exit');
  }

  const settings = new SettingsWindow(engine);
  settings.init();

  const widget = new WidgetWindow();
  await widget.init(engine);

  // Small cross-window actions that don't belong to a single view.
  ipcMain.on('ui:open-settings', () => settings.show());
  ipcMain.on('ui:copy', (_e, text: string) => clipboard.writeText(text));
  ipcMain.on('ui:open-path', (_e, which: 'config' | 'log') => {
    void shell.openPath(which === 'config' ? CONFIG_PATH : LOG_PATH);
  });
  ipcMain.on('ui:quit', () => app.quit());

  // Escape-hatch tray: the widget is the UI; this exists so settings/quit
  // stay reachable even if the widget's hover opt-in ever breaks. The
  // "…Template" filename marks it as a macOS template image, so the bird
  // renders white on a dark menu bar and black on a light one.
  let trayIcon = nativeImage.createFromPath(
    path.join(__dirname, '..', '..', 'assets', 'birdTemplate.png')
  );
  if (process.platform === 'win32') {
    // No template-image behavior here, and the black glyph vanishes on the
    // dark taskbar — repaint it white (premultiplied: channels = alpha).
    const size = trayIcon.getSize();
    const bgra = trayIcon.toBitmap();
    for (let i = 0; i < bgra.length; i += 4) {
      bgra[i] = bgra[i + 1] = bgra[i + 2] = bgra[i + 3];
    }
    trayIcon = nativeImage.createFromBitmap(bgra, size);
  }
  const tray = new Tray(trayIcon);
  tray.setToolTip('chirp');
  const trayMenu = Menu.buildFromTemplate([
    { label: 'Settings…', click: () => settings.show() },
    { type: 'separator' },
    { label: 'Quit', role: 'quit' },
  ]);
  tray.on('click', () => tray.popUpContextMenu(trayMenu));
  tray.on('right-click', () => tray.popUpContextMenu(trayMenu));
}

main().catch((err) => {
  console.error('[chirp] fatal:', err);
  app.quit();
});
