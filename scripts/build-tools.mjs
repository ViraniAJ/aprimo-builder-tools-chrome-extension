// Builds the React tools ported into the extension (tools-src/*) into extension/.
//   npm run build:tools
// Bulk Versioning: tools-src/bulk-versioning → extension/app/bulk/bulk-versioning.{js,css}
// Aprimo Wisp:     tools-src/aprimo-wisp     → extension/app/wisp/*.js, wisp.css and extension/content/wisp-agent.js
// Run `npm run wisp:assets` once as well: it copies the ONNX runtime and the embedding model Wisp loads at run time.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const tailwind = path.join(root, 'node_modules/.bin/tailwindcss');
const only = process.argv.slice(2); // e.g. `node scripts/build-tools.mjs wisp`
const want = (name) => !only.length || only.includes(name);
const common = {
  bundle: true, platform: 'browser', target: 'chrome116', jsx: 'automatic', minify: true, logLevel: 'warning',
  legalComments: 'eof', define: { 'process.env.NODE_ENV': '"production"' },
};

if (want('bulk')) {
  const src = path.join(root, 'tools-src/bulk-versioning');
  const out = path.join(root, 'extension/app/bulk');
  await build({ ...common, target: 'chrome111', entryPoints: [path.join(src, 'src/main.tsx')], format: 'iife', tsconfig: path.join(src, 'tsconfig.json'), outfile: path.join(out, 'bulk-versioning.js') });
  execFileSync(tailwind, ['-i', path.join(src, 'src/styles.css'), '-o', path.join(out, 'bulk-versioning.css'), '--minify'], { stdio: 'inherit' });
  console.log('Built extension/app/bulk/bulk-versioning.{js,css}');
}

if (want('wisp')) {
  const src = path.join(root, 'tools-src/aprimo-wisp/src');
  const out = path.join(root, 'extension/app/wisp');
  const tsconfig = path.join(root, 'tools-src/aprimo-wisp/tsconfig.json');
  rmSync(path.join(out, 'chunks'), { recursive: true, force: true });
  // Pages are ES modules split into shared chunks, so WebLLM and the PDF reader load only when used.
  const pages = { panel: 'panel/main.tsx', bar: 'panel/bar.tsx', settings: 'settings/main.tsx', 'mic-permission': 'pages/mic-permission.ts', video: 'pages/video.ts' };
  // Workers are ES modules: transformers.js and ONNX Runtime import their wasm glue at run time.
  const worker = (entry, file) => ({ ...common, tsconfig, format: 'esm', entryPoints: [path.join(src, entry)], outfile: path.join(out, file) });
  await Promise.all([
    build({ ...common, tsconfig, format: 'esm', splitting: true, entryPoints: Object.fromEntries(Object.entries(pages).map(([k, v]) => [k, path.join(src, v)])), outdir: out, chunkNames: 'chunks/[name]-[hash]' }),
    build(worker('kb/kb-worker.ts', 'kb-worker.js')),
    build(worker('llm/llm-worker.ts', 'llm-worker.js')),
    build(worker('voice/asr-worker.ts', 'asr-worker.js')),
    // The page agent is a classic content script.
    build({ ...common, tsconfig, format: 'iife', entryPoints: [path.join(src, 'agent/main.ts')], outfile: path.join(root, 'extension/content/wisp-agent.js') }),
  ]);
  execFileSync(tailwind, ['-i', path.join(src, 'ui/styles.css'), '-o', path.join(out, 'wisp.css'), '--minify'], { stdio: 'inherit' });
  console.log('Built extension/app/wisp/*.{js,css} and extension/content/wisp-agent.js');
}
