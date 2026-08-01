// Copies renderer HTML into dist/. A node script instead of `mkdir -p && cp`
// so the build also works under cmd.exe on Windows.
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'src', 'renderer');
const dst = path.join(__dirname, '..', 'dist', 'renderer');

fs.mkdirSync(dst, { recursive: true });
for (const f of fs.readdirSync(src)) {
  if (f.endsWith('.html')) {
    fs.copyFileSync(path.join(src, f), path.join(dst, f));
  }
}
