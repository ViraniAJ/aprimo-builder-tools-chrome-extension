// Builds the React tools ported into the extension (tools-src/*) into extension/app/<tool>/.
//   npm run build:tools
// Bulk Versioning: esbuild bundles tools-src/bulk-versioning/src/main.tsx; Tailwind builds its stylesheet.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'tools-src/bulk-versioning');
const out = path.join(root, 'extension/app/bulk');

await build({
  entryPoints: [path.join(src, 'src/main.tsx')],
  bundle: true, format: 'iife', platform: 'browser', target: 'chrome111', jsx: 'automatic', minify: true,
  tsconfig: path.join(src, 'tsconfig.json'), outfile: path.join(out, 'bulk-versioning.js'), logLevel: 'warning',
  legalComments: 'eof', define: { 'process.env.NODE_ENV': '"production"' },
});
execFileSync(path.join(root, 'node_modules/.bin/tailwindcss'),
  ['-i', path.join(src, 'src/styles.css'), '-o', path.join(out, 'bulk-versioning.css'), '--minify'], { stdio: 'inherit' });
console.log('Built extension/app/bulk/bulk-versioning.{js,css}');
