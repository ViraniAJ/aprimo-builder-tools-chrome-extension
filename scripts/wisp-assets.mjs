// Puts the files Aprimo Wisp runs locally into the extension (kept out of git; release.sh runs this):
//   extension/vendor/ort/       ONNX Runtime Web (WebAssembly) for the embedding model and Whisper
//   extension/models/Xenova/all-MiniLM-L6-v2/   the embedding model (q8, about 23 MB)
//   extension/vendor/webllm/    optional: offline-model libraries (--webllm), so nothing is loaded from GitHub
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ext = path.join(root, 'extension');
const exists = (p) => fs.access(p).then(() => true, () => false);

async function download(url, dest) {
  if (await exists(dest)) return false;
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
  return true;
}

// ONNX Runtime Web files transformers.js asks for at runtime.
const ortDist = path.join(root, 'node_modules/onnxruntime-web/dist');
await fs.mkdir(path.join(ext, 'vendor/ort'), { recursive: true });
for (const f of ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.jsep.wasm', 'ort-wasm-simd-threaded.jsep.mjs']) {
  await fs.copyFile(path.join(ortDist, f), path.join(ext, 'vendor/ort', f));
}
console.log('vendor/ort: copied ONNX Runtime Web');

const model = 'Xenova/all-MiniLM-L6-v2';
for (const f of ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'onnx/model_quantized.onnx']) {
  const got = await download(`https://huggingface.co/${model}/resolve/main/${f}`, path.join(ext, 'models', model, f));
  if (got) console.log(`models/${model}/${f}: downloaded`);
}

if (process.argv.includes('--webllm')) {
  const { prebuiltAppConfig } = await import('@mlc-ai/web-llm');
  for (const id of ['Qwen2.5-1.5B-Instruct-q4f16_1-MLC', 'Llama-3.2-1B-Instruct-q4f16_1-MLC']) {
    const m = prebuiltAppConfig.model_list.find((x) => x.model_id === id);
    if (!m) { console.warn(`no WebLLM entry for ${id}`); continue; }
    const name = m.model_lib.split('/').pop();
    if (await download(m.model_lib, path.join(ext, 'vendor/webllm', name))) console.log(`vendor/webllm/${name}: downloaded`);
  }
}

let total = 0;
async function size(p) { for (const e of await fs.readdir(p, { withFileTypes: true })) { const q = path.join(p, e.name); e.isDirectory() ? await size(q) : (total += (await fs.stat(q)).size); } }
for (const d of ['vendor', 'models']) if (await exists(path.join(ext, d))) await size(path.join(ext, d));
console.log(`Local AI assets: ${(total / 1e6).toFixed(1)} MB`);
