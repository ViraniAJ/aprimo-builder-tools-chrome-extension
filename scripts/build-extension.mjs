// Copies the shared UI files from public/ into extension/app/.
// extension/app/client.js is extension-specific and is not touched.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const shared = ['index.html', 'app.js', 'describe.js', 'styles.css'];
const dest = path.join(root, 'extension', 'app');
fs.mkdirSync(dest, { recursive: true });
for (const f of shared) {
  fs.copyFileSync(path.join(root, 'public', f), path.join(dest, f));
  console.log(`copied public/${f} -> extension/app/${f}`);
}
