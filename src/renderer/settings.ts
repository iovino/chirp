// Settings renderer — radio lists for key/mic/model, rendered from the
// settings snapshot and re-rendered on every 'settings:changed' push.
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

function render(snap: ChirpSettingsSnapshot): void {
  fill(
    'keys',
    snap.keyOptions.map((k) =>
      radioRow('key', k.label, k.code === snap.keycode, () =>
        void window.chirp.applySettings({ keycode: k.code })
      )
    ),
    'no keys available'
  );

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
