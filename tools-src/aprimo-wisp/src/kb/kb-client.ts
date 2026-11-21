// Talks to the knowledge worker from an extension page (side panel or settings).
import type { Chunk, KnowledgeDoc } from "./types";

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; progress?: (p: { done: number; total: number }) => void }>();
let ready: Promise<{ bundled: { count: number; builtAt?: string }; user: number }> | null = null;

function call<T>(op: string, args?: unknown, progress?: (p: { done: number; total: number }) => void): Promise<T> {
  if (!worker) {
    worker = new Worker(chrome.runtime.getURL("app/wisp/kb-worker.js"), { type: "module" });
    worker.onmessage = (ev) => {
      const { id, result, error, progress: p } = ev.data ?? {};
      const h = pending.get(id);
      if (!h) return;
      if (p) return h.progress?.(p);
      pending.delete(id);
      error ? h.reject(new Error(error)) : h.resolve(result);
    };
  }
  const id = ++seq;
  return new Promise<T>((resolve, reject) => { pending.set(id, { resolve, reject, progress }); worker!.postMessage({ id, op, args }); });
}

export function initKB() {
  ready ??= call("init", { base: chrome.runtime.getURL("") });
  return ready;
}
export async function searchKB(query: string, k = 6, sources?: string[]) { await initKB(); return call<(Chunk & { score: number })[]>("search", { query, k, sources }); }
export async function addDocs(docs: KnowledgeDoc[], progress?: (p: { done: number; total: number }) => void) { await initKB(); return call<{ user: number }>("addDocs", { docs }, progress); }
export async function removeDoc(id: string) { await initKB(); return call("removeDoc", { id }); }
export async function listDocs() { await initKB(); return call<any[]>("listDocs"); }
export async function exportDocs(ids?: string[]) { await initKB(); return call<KnowledgeDoc[]>("exportDocs", { ids }); }
export async function kbStats() { await initKB(); return call<{ bundled: { count: number; builtAt?: string }; user: number }>("stats"); }
