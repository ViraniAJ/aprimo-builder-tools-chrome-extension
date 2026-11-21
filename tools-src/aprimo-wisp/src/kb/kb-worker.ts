/// <reference lib="webworker" />
// Knowledge worker: embeds with all-MiniLM-L6-v2 (bundled in the extension, no remote code) and searches the bundled
// index plus the user's own documents with vectors + BM25 fused by rank.
import { env, pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";
import { BM25, rrf } from "./bm25";
import { chunkDoc, embedText } from "./chunk";
import { decodeIndex, dotInt8, quantize } from "./int8";
import { openDB, reqP, tx } from "./idb";
import { EMBED_DIMS, EMBED_DTYPE, EMBED_MODEL, type Chunk, type KnowledgeDoc } from "./types";

declare const self: DedicatedWorkerGlobalScope;

interface Entry { chunk: Chunk; q: Int8Array; scale: number; user: boolean }
let base = "";
let embedder: FeatureExtractionPipeline | null = null;
let bundled: Entry[] = [];
let user: Entry[] = [];
let bm25: BM25 | null = null;
let bundledInfo: { count: number; builtAt?: string; model?: string } = { count: 0 };

async function getEmbedder(): Promise<FeatureExtractionPipeline> {
  if (embedder) return embedder;
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = `${base}models/`;
  env.useBrowserCache = false;
  const onnx = env.backends.onnx as any;
  onnx.wasm.wasmPaths = `${base}vendor/ort/`;
  onnx.wasm.numThreads = 1; // no cross-origin isolation in extension pages
  embedder = (await (pipeline as any)("feature-extraction", EMBED_MODEL, { dtype: EMBED_DTYPE, device: "wasm" })) as FeatureExtractionPipeline;
  return embedder;
}

async function embed(texts: string[]): Promise<Float32Array[]> {
  const e = await getEmbedder();
  const out: Float32Array[] = [];
  for (let i = 0; i < texts.length; i += 16) {
    const t = await e(texts.slice(i, i + 16), { pooling: "mean", normalize: true });
    const data = t.data as Float32Array;
    for (let j = 0; j < t.dims[0]; j++) out.push(data.slice(j * EMBED_DIMS, (j + 1) * EMBED_DIMS));
  }
  return out;
}

async function loadBundled() {
  try {
    const [manifest, chunks, bin] = await Promise.all([
      fetch(`${base}kb/kb-manifest.json`).then((r) => r.json()),
      fetch(`${base}kb/chunks.json`).then((r) => r.json()) as Promise<Chunk[]>,
      fetch(`${base}kb/index.bin`).then((r) => r.arrayBuffer()),
    ]);
    if (manifest.model !== EMBED_MODEL || manifest.dtype !== EMBED_DTYPE) throw new Error(`Index was built with ${manifest.model}/${manifest.dtype}; rebuild it with npm run kb:build.`);
    const idx = decodeIndex(bin);
    bundled = chunks.map((chunk, i) => ({ chunk, q: idx.mat.slice(i * idx.dims, (i + 1) * idx.dims), scale: idx.scales[i], user: false }));
    bundledInfo = { count: bundled.length, builtAt: manifest.builtAt, model: manifest.model };
  } catch (e) {
    bundled = [];
    bundledInfo = { count: 0 };
    console.warn("[wisp] bundled knowledge not loaded:", (e as Error).message);
  }
}

async function loadUser() {
  const db = await openDB();
  const rows = await tx(db, ["chunks"], "readonly", (t) => reqP(t.objectStore("chunks").getAll()));
  user = (rows as any[]).map((r) => ({ chunk: r.chunk as Chunk, q: new Int8Array(r.q), scale: r.scale, user: true }));
}

function rebuildBM25() {
  bm25 = new BM25();
  for (const e of [...bundled, ...user]) bm25.add(`${e.chunk.title}\n${e.chunk.text}`);
}

const all = () => [...bundled, ...user];

async function search(query: string, k: number, sources?: string[]) {
  const entries = all();
  if (!entries.length) return [];
  const [qv] = await embed([query]);
  const vec = new Float32Array(entries.length);
  entries.forEach((e, i) => (vec[i] = dotInt8(qv, e.q, 0, EMBED_DIMS, e.scale)));
  if (!bm25 || bm25.size !== entries.length) rebuildBM25();
  const kw = bm25!.scores(query);
  if (sources?.length) entries.forEach((e, i) => { if (!sources.includes(e.chunk.src)) { vec[i] = -1; kw[i] = 0; } });
  const top = rrf([vec, kw], 60, k, 0);
  return top.map((i) => ({ ...entries[i].chunk, score: vec[i] }));
}

async function addDocs(docs: KnowledgeDoc[], report: (done: number, total: number) => void) {
  const db = await openDB();
  let done = 0;
  for (const doc of docs) {
    // Replace any earlier copy of the same document.
    await removeDoc(doc.id, db);
    const chunks = chunkDoc(doc);
    const vecs = await embed(chunks.map(embedText));
    await tx(db, ["docs", "chunks"], "readwrite", (t) => {
      const { text, ...meta } = doc;
      t.objectStore("docs").put({ ...meta, textLength: text.length, chunkCount: chunks.length, addedAt: doc.addedAt ?? Date.now(), text: text.slice(0, 200000) });
      chunks.forEach((chunk, i) => { const { q, scale } = quantize(vecs[i]); t.objectStore("chunks").add({ docId: doc.id, chunk, q: q.buffer, scale }); });
    });
    report(++done, docs.length);
  }
  await loadUser();
  rebuildBM25();
}

async function removeDoc(id: string, db?: IDBDatabase) {
  const d = db ?? (await openDB());
  await tx(d, ["docs", "chunks"], "readwrite", async (t) => {
    t.objectStore("docs").delete(id);
    const keys = await reqP(t.objectStore("chunks").index("docId").getAllKeys(id));
    for (const k of keys) t.objectStore("chunks").delete(k);
  });
}

async function listDocs() {
  const db = await openDB();
  const docs = await tx(db, ["docs"], "readonly", (t) => reqP(t.objectStore("docs").getAll()));
  return (docs as any[]).map(({ text, ...m }) => m);
}

async function exportDocs(ids?: string[]) {
  const db = await openDB();
  const docs = (await tx(db, ["docs"], "readonly", (t) => reqP(t.objectStore("docs").getAll()))) as any[];
  return docs.filter((d) => !ids || ids.includes(d.id));
}

self.onmessage = async (ev: MessageEvent) => {
  const { id, op, args } = ev.data ?? {};
  const reply = (result: unknown, error?: string) => self.postMessage({ id, result, error });
  try {
    switch (op) {
      case "init":
        base = args.base;
        await loadBundled();
        await loadUser();
        rebuildBM25();
        return reply({ bundled: bundledInfo, user: user.length });
      case "search":
        return reply(await search(args.query, args.k ?? 6, args.sources));
      case "addDocs":
        await addDocs(args.docs, (done, total) => self.postMessage({ id, progress: { done, total } }));
        return reply({ user: user.length });
      case "removeDoc":
        await removeDoc(args.id);
        await loadUser();
        rebuildBM25();
        return reply({ user: user.length });
      case "listDocs":
        return reply(await listDocs());
      case "exportDocs":
        return reply(await exportDocs(args?.ids));
      case "stats":
        return reply({ bundled: bundledInfo, user: user.length });
      case "embed":
        return reply((await embed(args.texts)).map((v) => Array.from(v)));
      default:
        return reply(null, `unknown op ${op}`);
    }
  } catch (e) {
    reply(null, (e as Error)?.message ?? String(e));
  }
};
