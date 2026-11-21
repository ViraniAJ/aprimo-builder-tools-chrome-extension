// Checks the bundled knowledge index: it loads, matches the runtime model, and finds the expected page for each
// question in knowledge/golden.json (recall@5, target ≥ 0.85).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline, env } from '@huggingface/transformers';
import { decodeIndex, dotInt8 } from '../../tools-src/aprimo-wisp/src/kb/int8.ts';
import { BM25, rrf } from '../../tools-src/aprimo-wisp/src/kb/bm25.ts';
import { EMBED_MODEL, EMBED_DTYPE, EMBED_DIMS } from '../../tools-src/aprimo-wisp/src/kb/types.ts';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const kb = path.join(root, 'extension/kb');
const manifest = JSON.parse(await fs.readFile(path.join(kb, 'kb-manifest.json'), 'utf8'));
if (manifest.model !== EMBED_MODEL || manifest.dtype !== EMBED_DTYPE) throw new Error('Index model does not match the runtime model.');
const chunks = JSON.parse(await fs.readFile(path.join(kb, 'chunks.json'), 'utf8'));
const buf = await fs.readFile(path.join(kb, 'index.bin'));
const idx = decodeIndex(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
if (idx.count !== chunks.length) throw new Error(`index has ${idx.count} vectors for ${chunks.length} chunks`);
env.cacheDir = path.join(root, 'knowledge/.cache/models');
const embed = await pipeline('feature-extraction', EMBED_MODEL, { dtype: EMBED_DTYPE });
const bm = new BM25();
chunks.forEach((c) => bm.add(`${c.title}\n${c.text}`));
const golden = JSON.parse(await fs.readFile(path.join(root, 'knowledge/golden.json'), 'utf8'));
let hits = 0;
for (const g of golden) {
  const t = await embed([g.q], { pooling: 'mean', normalize: true });
  const q = t.data.slice(0, EMBED_DIMS);
  const vec = new Float32Array(chunks.length);
  for (let i = 0; i < chunks.length; i++) vec[i] = dotInt8(q, idx.mat, i, EMBED_DIMS, idx.scales[i]);
  const top = rrf([vec, bm.scores(g.q)], 60, 5, 0);
  const ok = top.some((i) => `${chunks[i].url} ${chunks[i].title}`.toLowerCase().includes(g.expect.toLowerCase()));
  hits += ok ? 1 : 0;
  console.log(`${ok ? '✓' : '✗'} ${g.q}\n    ${top.slice(0, 3).map((i) => chunks[i].title).join(' | ')}`);
}
const recall = hits / golden.length;
console.log(`\nrecall@5 = ${recall.toFixed(2)} (${hits}/${golden.length}) over ${chunks.length} chunks, built ${manifest.builtAt}`);
if (recall < 0.85) process.exitCode = 1;
