// The offline model: WebLLM running on the GPU in a Web Worker. Weights download once (Cache Storage) on opt-in.
// The model library (.wasm) is loaded from the extension when `npm run wisp:assets` bundled it, otherwise from
// WebLLM's default host.
import { CreateWebWorkerMLCEngine, prebuiltAppConfig, type AppConfig, type InitProgressReport, type WebWorkerMLCEngine } from "@mlc-ai/web-llm";
import type { ChatRequest, StreamOptions, TextStream } from "./types";

let engine: WebWorkerMLCEngine | null = null;
let loadedModel = "";
let loading: Promise<WebWorkerMLCEngine> | null = null;

export { gpuSummary, webgpuAvailable } from "./gpu";

async function appConfigFor(modelId: string): Promise<AppConfig> {
  const base = prebuiltAppConfig.model_list.find((m) => m.model_id === modelId);
  if (!base) throw new Error(`Unknown offline model ${modelId}.`);
  const libName = base.model_lib.split("/").pop()!;
  const local = chrome.runtime.getURL(`vendor/webllm/${libName}`);
  let model_lib = base.model_lib;
  try {
    const r = await fetch(local, { method: "HEAD" });
    if (r.ok) model_lib = local;
  } catch { /* not bundled */ }
  return { ...prebuiltAppConfig, model_list: [{ ...base, model_lib }] };
}

export async function loadLocalModel(modelId: string, onProgress?: (p: InitProgressReport) => void): Promise<WebWorkerMLCEngine> {
  if (engine && loadedModel === modelId) return engine;
  if (loading) return loading;
  loading = (async () => {
    const worker = new Worker(chrome.runtime.getURL("app/wisp/llm-worker.js"), { type: "module" });
    const e = await CreateWebWorkerMLCEngine(worker, modelId, { appConfig: await appConfigFor(modelId), initProgressCallback: onProgress });
    engine = e;
    loadedModel = modelId;
    return e;
  })();
  try { return await loading; } finally { loading = null; }
}

export async function isLocalModelCached(modelId: string): Promise<boolean> {
  try {
    const { hasModelInCache } = await import("@mlc-ai/web-llm");
    return await hasModelInCache(modelId, await appConfigFor(modelId));
  } catch { return false; }
}

export async function deleteLocalModel(modelId: string): Promise<void> {
  const { deleteModelAllInfoInCache } = await import("@mlc-ai/web-llm");
  await deleteModelAllInfoInCache(modelId, await appConfigFor(modelId));
  if (loadedModel === modelId) { engine = null; loadedModel = ""; }
}

export async function* streamLocal(modelId: string, req: ChatRequest, opts: StreamOptions = {}): TextStream {
  const e = await loadLocalModel(modelId);
  const chunks = await e.chat.completions.create({
    stream: true,
    temperature: 0.2,
    max_tokens: Math.min(req.maxTokens, 400),
    messages: [{ role: "system", content: req.system }, ...(req.history ?? []), { role: "user", content: req.user }],
  });
  for await (const c of chunks) {
    if (opts.signal?.aborted) { e.interruptGenerate(); return; }
    const piece = c.choices?.[0]?.delta?.content;
    if (piece) yield piece;
  }
}
