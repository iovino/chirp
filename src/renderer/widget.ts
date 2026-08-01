// Floating widget renderer. Shows the dictation state pill, a success
// toast, and — when a transcript couldn't be pasted — a persistent bubble
// with a copy button.
//
// NOTE: this file must stay a plain script (no import/export) — it is
// loaded directly by widget.html without a bundler. Shared bridge types
// live in global.d.ts.
//
// The window is click-through by default (transparent pixels would
// otherwise swallow clicks meant for apps underneath); we flip
// interactivity on while the pointer is over a `.hit` element.

const pillEl = document.getElementById('pill') as HTMLDivElement;
const labelEl = document.getElementById('label') as HTMLDivElement;
const toastEl = document.getElementById('toast') as HTMLDivElement;
const toastMsgEl = toastEl.querySelector('.msg') as HTMLSpanElement;
const bubbleEl = document.getElementById('bubble') as HTMLDivElement;
const bubbleTextEl = bubbleEl.querySelector('.text') as HTMLDivElement;

const TOAST_MS = 2500;
const ERROR_MS = 4000;

let idleLabel = 'chirp';
let bubbleText = '';
let toastTimer: number | undefined;
let errorTimer: number | undefined;

function setPill(state: 'idle' | 'recording' | 'processing', label: string): void {
  pillEl.classList.remove('idle', 'recording', 'processing', 'error');
  pillEl.classList.add(state);
  labelEl.textContent = label;
}

function showToast(message: string): void {
  clearTimeout(toastTimer);
  toastMsgEl.textContent = message;
  toastEl.classList.add('show');
  toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), TOAST_MS);
}

function showBubble(text: string): void {
  bubbleText = text;
  bubbleTextEl.textContent = text;
  bubbleEl.classList.add('show');
}

function hideBubble(): void {
  bubbleEl.classList.remove('show');
}

window.chirp.onWidgetUpdate((msg) => {
  switch (msg.kind) {
    case 'state':
      clearTimeout(errorTimer);
      if (msg.state === 'recording') {
        // A fresh dictation supersedes any leftover result UI.
        hideBubble();
        toastEl.classList.remove('show');
        setPill('recording', 'Listening…');
      } else if (msg.state === 'processing') {
        setPill('processing', 'Transcribing…');
      } else {
        setPill('idle', idleLabel);
      }
      break;
    case 'result':
      if (msg.pasted) {
        showToast(msg.text);
      } else {
        showBubble(msg.text);
      }
      break;
    case 'error':
      setPill('idle', msg.message);
      pillEl.classList.add('error');
      clearTimeout(errorTimer);
      errorTimer = window.setTimeout(() => setPill('idle', idleLabel), ERROR_MS);
      break;
  }
});

document.getElementById('gear')!.addEventListener('click', () => {
  window.chirp.openSettings();
});
document.getElementById('copy')!.addEventListener('click', () => {
  window.chirp.copyText(bubbleText);
  showToast('Copied to clipboard');
  hideBubble();
});
document.getElementById('dismiss')!.addEventListener('click', hideBubble);

// ---- click-through management ----
let interactive = false;
function setInteractive(on: boolean): void {
  if (on === interactive) return;
  interactive = on;
  window.chirp.setWidgetMouse(on);
}
document.addEventListener('mousemove', (e) => {
  setInteractive(!!(e.target as Element | null)?.closest?.('.hit'));
});
document.addEventListener('mouseleave', () => setInteractive(false));

// ---- idle label shows the configured push-to-talk key ----
function refreshIdleLabel(snap: { keyLabel: string }): void {
  idleLabel = `hold ${snap.keyLabel} to dictate`;
  if (pillEl.classList.contains('idle') && !pillEl.classList.contains('error')) {
    labelEl.textContent = idleLabel;
  }
}
window.chirp.getSettings().then(refreshIdleLabel);
window.chirp.onSettingsChanged(refreshIdleLabel);
