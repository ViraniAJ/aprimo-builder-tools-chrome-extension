// Builds the knowledge index bundled with Aprimo Wisp: extension/kb/{index.bin,chunks.json,kb-manifest.json}.
//   npm run kb:build            (uses knowledge/.cache for pages fetched before; --fresh refetches)
// Sources come from knowledge/sources.json. Pages become Markdown (Readability + Turndown), are split at headings
// and embedded with the same model and precision the extension uses at runtime (all-MiniLM-L6-v2, q8).
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { pipeline, env } from '@huggingface/transformers';
import { chunkDoc, embedText } from '../../tools-src/aprimo-wisp/src/kb/chunk.ts';
import { quantize, encodeIndex } from '../../tools-src/aprimo-wisp/src/kb/int8.ts';
import { parseCaptions } from '../../tools-src/aprimo-wisp/src/kb/transcript.ts';
import { EMBED_MODEL, EMBED_DTYPE, EMBED_DIMS } from '../../tools-src/aprimo-wisp/src/kb/types.ts';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cacheDir = path.join(root, 'knowledge/.cache');
const outDir = path.join(root, 'extension/kb');
const fresh = process.argv.includes('--fresh');
const UA = 'AprimoWispKnowledgeBuilder/1.0 (+https://github.com/ViraniAJ/aprimo-builder-tools-chrome-extension)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
turndown.remove(['script', 'style', 'noscript', 'iframe', 'svg', 'nav', 'footer']);
turndown.addRule('anchorLinks', {
  // Docusaurus and similar sites add a "#" permalink inside every heading; drop it.
  filter: (node) => node.nodeName === 'A' && ((node.getAttribute('class') || '').includes('hash-link') || /^Direct link/i.test(node.getAttribute('title') || node.getAttribute('aria-label') || '') || ((node.getAttribute('href') || '').startsWith('#') && !(node.textContent || '').replace(/[\u200b\s#]/g, ''))),
  replacement: () => '',
});

async function cachedFetch(url, { text = true } = {}) {
  await fs.mkdir(cacheDir, { recursive: true });
  const file = path.join(cacheDir, crypto.createHash('sha1').update(url).digest('hex'));
  if (!fresh) { try { return text ? await fs.readFile(file, 'utf8') : await fs.readFile(file); } catch {} }
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const body = text ? await res.text() : Buffer.from(await res.arrayBuffer());
  await fs.writeFile(file, body);
  await sleep(500); // be gentle
  return body;
}

function toMarkdown(html, url) {
  const { document } = parseHTML(html);
  const title = (document.querySelector('h1')?.textContent || document.title || url).trim();
  const main = document.querySelector('article .markdown, article, main, [role=main]');
  let content = main?.innerHTML || '';
  try {
    const art = new Readability(document.cloneNode(true), { charThreshold: 200 }).parse();
    if (art?.content && (!content || art.textContent.length > (main?.textContent?.length || 0) * 0.6)) content = art.content;
  } catch {}
  if (!content) content = document.body?.innerHTML || '';
  let md = turndown.turndown(content).replace(/\[\u200b?\]\(#[^)]*\)/g, '').replace(/\[([^\]]*)\]\(#[^)]*"Direct link to[^)]*\)/g, '$1').replace(/\[([^\]]+)\]\(#[^)]*\)/g, '$1').replace(/\n{3,}/g, '\n\n').trim();
  if (!md.startsWith('#')) md = `# ${title}\n\n${md}`;
  return { title, markdown: md };
}

function openapiDocs(spec, url) {
  const docs = [];
  const schemas = spec.components?.schemas ?? {};
  for (const [p, ops] of Object.entries(spec.paths ?? {})) {
    for (const [method, op] of Object.entries(ops)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
      const params = (op.parameters ?? []).map((x) => `- \`${x.name}\` (${x.in}${x.required ? ', required' : ''}): ${x.description ?? ''}${x.schema?.enum ? ` One of: ${x.schema.enum.join(', ')}.` : ''}`).join('\n');
      const resp = Object.entries(op.responses ?? {}).map(([code, r]) => `- ${code}: ${r.description ?? ''}`).join('\n');
      const ref = JSON.stringify(op.responses?.['200'] ?? {}).match(/#\/components\/schemas\/(\w+)/)?.[1];
      const fields = ref && schemas[ref]?.properties ? Object.entries(schemas[ref].properties).map(([k, v]) => `- \`${k}\`: ${v.description ?? v.type ?? ''}`).join('\n') : '';
      const text = `# ${method.toUpperCase()} /api/core${p}\n\n${op.summary ?? ''}\n\n${op.description ?? ''}\n\n## Parameters\n\n${params || 'None.'}\n\n## Responses\n\n${resp}${fields ? `\n\n## ${ref} fields\n\n${fields}` : ''}`;
      docs.push({ id: `openapi:${method}:${p}`, source: 'dev', title: `DAM API: ${method.toUpperCase()} ${p}`, url, text });
    }
  }
  return docs;
}

async function fromSource(src) {
  if (src.type === 'sitemap') {
    const xml = await cachedFetch(src.url);
    const inc = (src.include ?? []).map((r) => new RegExp(r));
    const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim()).filter((u) => !inc.length || inc.some((r) => r.test(u))).slice(0, src.maxPages ?? 400);
    const docs = [];
    for (const u of urls) {
      try { const { title, markdown } = toMarkdown(await cachedFetch(u), u); if (markdown.length > 200) docs.push({ id: `${src.id}:${u}`, source: src.id, title, url: u, text: markdown }); }
      catch (e) { console.warn('  skip', u, e.message); }
    }
    console.log(`  sitemap ${src.url}: ${docs.length} pages`);
    return docs;
  }
  if (src.type === 'openapi-page') {
    const html = await cachedFetch(src.url);
    const link = html.match(/href="([^"]+openapi[^"]*\.json)"/i)?.[1];
    if (!link) { console.warn('  no OpenAPI link found on', src.url); return []; }
    const specUrl = new URL(link, src.url).href;
    const docs = openapiDocs(JSON.parse(await cachedFetch(specUrl)), specUrl);
    console.log(`  OpenAPI ${specUrl}: ${docs.length} operations`);
    return docs;
  }
  if (src.type === 'urls') {
    const docs = [];
    for (const u of src.urls ?? []) {
      try { const { title, markdown } = toMarkdown(await cachedFetch(u), u); docs.push({ id: `${src.id}:${u}`, source: src.id, title, url: u, text: markdown }); }
      catch (e) { console.warn('  skip', u, e.message); }
    }
    return docs;
  }
  if (src.type === 'files') {
    const dir = path.join(root, src.dir);
    const docs = [];
    for (const name of await fs.readdir(dir).catch(() => [])) {
      const file = path.join(dir, name);
      const lower = name.toLowerCase();
      if (name.startsWith('.')) continue;
      const base = { id: `file:${name}`, source: 'file', title: name.replace(/\.[^.]+$/, ''), url: `file:${name}` };
      if (lower.endsWith('.json')) {
        const j = JSON.parse(await fs.readFile(file, 'utf8'));
        docs.push(...(Array.isArray(j) ? j : j.docs ?? [j]).filter((d) => d?.id && d?.title));
      } else if (lower.endsWith('.pdf')) {
        const { extractText, getDocumentProxy } = await import('unpdf');
        const pdf = await getDocumentProxy(new Uint8Array(await fs.readFile(file)));
        const { text } = await extractText(pdf, { mergePages: false });
        docs.push({ ...base, text: `# ${base.title}\n\n${text.map((t, i) => `## Page ${i + 1}\n\n${t}`).join('\n\n')}` });
      } else if (lower.endsWith('.html') || lower.endsWith('.htm')) {
        const { title, markdown } = toMarkdown(await fs.readFile(file, 'utf8'), base.url); docs.push({ ...base, title, text: markdown });
      } else if (lower.endsWith('.vtt') || lower.endsWith('.srt')) {
        const segments = parseCaptions(await fs.readFile(file, 'utf8'));
        docs.push({ ...base, source: 'video', text: segments.map((s) => s.text).join(' '), video: { url: '', segments } });
      } else if (/\.(md|markdown|txt)$/.test(lower)) {
        docs.push({ ...base, text: await fs.readFile(file, 'utf8') });
      }
    }
    console.log(`  files in ${src.dir}: ${docs.length}`);
    return docs;
  }
  console.warn('  unknown source type', src.type);
  return [];
}

const cfg = JSON.parse(await fs.readFile(path.join(root, 'knowledge/sources.json'), 'utf8'));
console.log('Collecting sources…');
const docs = [];
for (const src of cfg.sources) docs.push(...(await fromSource(src)));
const chunks = docs.flatMap((d) => chunkDoc(d));
console.log(`${docs.length} documents → ${chunks.length} chunks. Embedding with ${EMBED_MODEL} (${EMBED_DTYPE})…`);

env.cacheDir = path.join(root, 'knowledge/.cache/models');
const embed = await pipeline('feature-extraction', EMBED_MODEL, { dtype: EMBED_DTYPE });
const rows = [];
for (let i = 0; i < chunks.length; i += 32) {
  const batch = chunks.slice(i, i + 32).map(embedText);
  const t = await embed(batch, { pooling: 'mean', normalize: true });
  for (let j = 0; j < t.dims[0]; j++) rows.push(quantize(t.data.slice(j * EMBED_DIMS, (j + 1) * EMBED_DIMS)));
  process.stdout.write(`\r  ${Math.min(i + 32, chunks.length)}/${chunks.length}`);
}
process.stdout.write('\n');

await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(path.join(outDir, 'index.bin'), encodeIndex(rows, EMBED_DIMS));
await fs.writeFile(path.join(outDir, 'chunks.json'), JSON.stringify(chunks));
const manifest = { model: EMBED_MODEL, dtype: EMBED_DTYPE, dims: EMBED_DIMS, count: chunks.length, docs: docs.length, builtAt: new Date().toISOString(),
  sources: cfg.sources.map((s) => s.url ?? s.dir ?? s.type) };
await fs.writeFile(path.join(outDir, 'kb-manifest.json'), JSON.stringify(manifest, null, 2));
const size = (await fs.stat(path.join(outDir, 'chunks.json'))).size + (await fs.stat(path.join(outDir, 'index.bin'))).size;
console.log(`Wrote extension/kb/ (${chunks.length} chunks, ${(size / 1e6).toFixed(1)} MB).`);
