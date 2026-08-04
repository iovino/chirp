// Settings renderer — press-to-bind row for the key, radio lists for
// mic/model, rendered from the settings snapshot and re-rendered on every
// 'settings:changed' push.
//
// NOTE: this file must stay a plain script (no import/export) — it is
// loaded directly by settings.html without a bundler. Shared bridge types
// live in global.d.ts.

function radioRow(
  group: string,
  label: string,
  checked: boolean,
  onPick: () => void
): HTMLLabelElement {
  const row = document.createElement('label');
  row.className = 'row';
  const input = document.createElement('input');
  input.type = 'radio';
  input.name = group;
  input.checked = checked;
  input.addEventListener('change', () => input.checked && onPick());
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = label;
  name.title = label;
  row.append(input, name);
  return row;
}

function fill(sectionId: string, rows: HTMLElement[], emptyText: string): void {
  const section = document.getElementById(sectionId)!;
  section.replaceChildren(...rows);
  if (rows.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = emptyText;
    section.append(empty);
  }
}

// True while the main process is waiting for the user to press a key.
let capturingKey = false;

function keyRows(snap: ChirpSettingsSnapshot): HTMLElement[] {
  const row = document.createElement('div');
  row.className = 'row static';
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = capturingKey
    ? 'press any key… (Esc cancels)'
    : snap.keyLabel;
  const change = document.createElement('button');
  change.textContent = 'Change…';
  change.disabled = capturingKey;
  change.addEventListener('click', () => {
    capturingKey = true;
    render(snap);
    void window.chirp.captureKey().then((next) => {
      capturingKey = false;
      render(next);
    });
  });
  row.append(name, change);

  const rows = [row];
  if (snap.keyIsPrintable && !capturingKey) {
    const warn = document.createElement('div');
    warn.className = 'warn';
    warn.textContent =
      `⚠ "${snap.keyLabel}" types a character, so holding it to dictate will ` +
      'also type into the focused app. A modifier or function key works better.';
    rows.push(warn);
  }
  return rows;
}

function render(snap: ChirpSettingsSnapshot): void {
  fill('keys', keyRows(snap), 'no key bound');

  const micRows = [
    radioRow('mic', 'System default', snap.inputDevice === '', () =>
      void window.chirp.applySettings({ inputDevice: '' })
    ),
    ...snap.devices.map((label) =>
      radioRow(
        'mic',
        label,
        snap.inputDevice !== '' &&
          label.toLowerCase().includes(snap.inputDevice.toLowerCase()),
        () => void window.chirp.applySettings({ inputDevice: label })
      )
    ),
  ];
  fill('mics', micRows, 'no microphones found');

  fill(
    'models',
    snap.models.map((m) =>
      radioRow('model', m.label, m.path === snap.modelPath, () =>
        void window.chirp.applySettings({ modelPath: m.path })
      )
    ),
    'no models found in ~/.chirp/models'
  );

  document.getElementById('version')!.textContent = `chirp v${snap.version}`;
}

window.chirp.getSettings().then(render);
window.chirp.onSettingsChanged(render);

document.getElementById('open-config')!.addEventListener('click', () =>
  window.chirp.openPath('config')
);
document.getElementById('open-log')!.addEventListener('click', () =>
  window.chirp.openPath('log')
);
document.getElementById('quit')!.addEventListener('click', () => window.chirp.quitApp());
