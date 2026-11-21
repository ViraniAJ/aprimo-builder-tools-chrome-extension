// Picks the provider for a question and returns its text stream, following Wisp's routing:
// NVIDIA races Super VL against Nano (drawings go to Step 5; a second opinion swaps the first two); Anthropic and
// Custom ask one model; the offline model answers when the chosen provider has no key, the network is down, or the
// cloud call fails. Also: Wisp's spoken error messages, Find Models, and the connection test.
import { NIM_DRAWING, NIM_STRONG, PROVIDERS, modelInfo, nimModelsFor, providerDisplayName, type CoordinateSpace, type ProviderId } from "../core/catalog";
import { getKey, type WispSettings } from "../core/settings";
import { streamAnthropic } from "./anthropic";
import { streamOpenAICompat } from "./openai-compat";
import { race } from "./race";
import { ProviderError, type ChatRequest, type TextStream } from "./types";

/** The offline model, loaded only when it's used (WebLLM is large). */
async function* streamLocal(modelId: string, req: ChatRequest, opts: { signal?: AbortSignal }): TextStream {
  const m = await import("./webllm");
  yield* m.streamLocal(modelId, req, opts);
}

export interface Answer { stream: TextStream; provider: ProviderId; model: string; space: CoordinateSpace; local: boolean }

export async function canUseCloud(s: WispSettings): Promise<{ ok: boolean; reason?: "local" | "offline" | "noKey" | "noModel" | "privacy" }> {
  if (s.provider === "local") return { ok: false, reason: "local" };
  if (!s.privacyAccepted) return { ok: false, reason: "privacy" };
  if (!navigator.onLine) return { ok: false, reason: "offline" };
  if (PROVIDERS[s.provider].keyRequired && !(await getKey(s.provider))) return { ok: false, reason: "noKey" };
  if (s.provider === "openai-compatible" && !s.providers[s.provider].model) return { ok: false, reason: "noModel" };
  return { ok: true };
}

/** Wisp's spoken error messages (TurnPipeline). */
export function spokenError(e: unknown): string {
  const err = e as ProviderError & { name?: string };
  const m = String(err?.message ?? e);
  if (err?.name === "AbortError") return "";
  switch ((err as ProviderError).kind) {
    case "noKey": return "I need a key for my AI first. Open Wisp settings, choose AI, and paste it in.";
    case "privacy": return "Open Wisp settings and read what leaves your computer first. Then I can ask the AI.";
    case "noModel": return "Choose an AI model in Wisp settings, under AI.";
    case "badURL": return "Something is wrong with Wisp's AI settings. Open Wisp settings, choose AI, and pick your provider again.";
    case "degenerate": return "I got a garbled answer. Try asking again.";
    case "timeout": return "That's taking too long. Try asking again.";
    case "network": return "I lost the connection. Check your internet and try again.";
  }
  const status = (err as ProviderError).status ?? 0;
  if (status === 401 || status === 403) return "The AI service didn't accept your key. Open Wisp settings, choose AI, and paste a new one.";
  if (status === 404) return "The AI service doesn't know that model. Open Wisp settings, choose AI, and check the model.";
  if (status === 429) return "The AI service is busy right now. Try again in a moment.";
  if (status >= 400) return "The AI service had a problem. Try again in a moment.";
  if (/failed to fetch|networkerror|load failed/i.test(m)) return "I lost the connection. Check your internet and try again.";
  if (/no answer within|timed? ?out/i.test(m)) return "That's taking too long. Try asking again.";
  return "The AI service had a problem. Try again in a moment.";
}

function streamFor(s: WispSettings, provider: ProviderId, model: string, key: string, req: ChatRequest): (sig: AbortSignal) => TextStream {
  const p = s.providers[provider];
  if (provider === "anthropic") return (sig) => streamAnthropic({ baseURL: p.baseURL, apiKey: key, model }, req, { signal: sig });
  return (sig) => streamOpenAICompat({ baseURL: p.baseURL, apiKey: key, model, extraBody: modelInfo(model).extraBody }, req, { signal: sig });
}

export function spaceFor(s: WispSettings, model: string): CoordinateSpace {
  if (s.provider === "openai-compatible") return s.providers["openai-compatible"].coordinateSpace ?? "pixels";
  return modelInfo(model).coordinateSpace ?? "pixels";
}

export async function ask(s: WispSettings, question: string, buildReq: (local: boolean, space: CoordinateSpace) => ChatRequest, signal: AbortSignal, o: { secondOpinion?: boolean; models?: string[] } = {}): Promise<Answer> {
  const cloud = await canUseCloud(s);
  const localModel = s.providers.local.model || s.localModelInstalled;
  const useLocal = !cloud.ok && (s.provider === "local" || (s.autoLocalFallback && !!s.localModelInstalled && cloud.reason !== "privacy"));
  if (useLocal) return { stream: streamLocal(localModel, buildReq(true, "pixels"), { signal }), provider: "local", model: localModel, space: "pixels", local: true };
  if (!cloud.ok) throw new ProviderError(cloud.reason ?? "noKey", 0, false, (cloud.reason === "offline" ? "network" : cloud.reason) as ProviderError["kind"]);

  const p = s.providers[s.provider];
  try { new URL(p.baseURL); } catch { throw new ProviderError("bad base URL", 0, false, "badURL"); }
  const key = await getKey(s.provider);
  const first = Math.min(s.timeoutSeconds, 20) * 1000;
  try {
    const ids = o.models ?? (s.provider === "nvidia-nim" ? nimModelsFor(question, p.model, p.fallbacks, s.smartRouting, o.secondOpinion) : [p.model]);
    const r = await race(ids.map((id) => ({ label: id, start: streamFor(s, s.provider, id, key, buildReq(false, spaceFor(s, id))) })), { signal, firstTokenTimeoutMs: first });
    return { stream: withTotalTimeout(r.stream, (s.timeoutSeconds + 20) * 1000, signal), provider: s.provider, model: r.winner, space: spaceFor(s, r.winner), local: false };
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    if (s.autoLocalFallback && s.localModelInstalled) return { stream: streamLocal(localModel, buildReq(true, "pixels"), { signal }), provider: "local", model: localModel, space: "pixels", local: true };
    if (/No answer within/.test((e as Error).message)) throw new ProviderError((e as Error).message, 0, true, "timeout");
    throw e;
  }
}

async function* withTotalTimeout(stream: TextStream, ms: number, signal: AbortSignal): TextStream {
  const t0 = Date.now();
  for await (const piece of stream) {
    if (signal.aborted) return;
    if (Date.now() - t0 > ms) throw new ProviderError("total timeout", 0, true, "timeout");
    yield piece;
  }
}

/** A text-only completion (writing help, sketches). Drawings prefer Step 5, then Super VL, as in Wisp. */
export async function complete(s: WispSettings, system: string, user: string, signal: AbortSignal, o: { drawing?: boolean; maxTokens?: number } = {}): Promise<Answer> {
  const req: ChatRequest = { system, user, images: [], maxTokens: o.maxTokens ?? 900 };
  const models = s.provider === "nvidia-nim" && o.drawing ? [NIM_DRAWING, NIM_STRONG] : undefined;
  return ask(s, user, () => req, signal, { models });
}

// ── Find Models (Wisp's ModelListFetcher) ────────────────────────────────────
export async function findModels(baseURL: string, apiKey: string): Promise<string[]> {
  let url: URL;
  try { url = new URL(baseURL); if (!/^https?:$/.test(url.protocol) || !url.host) throw new Error(); } catch { throw new Error("That address isn't valid. It usually ends in /v1."); }
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 10_000);
  let res: Response;
  try {
    res = await fetch(`${baseURL.replace(/\/+$/, "")}/models`, { headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}, signal: ctl.signal, credentials: "omit" });
  } catch { throw new Error("Couldn't reach that server. Check the address and that it's running."); } finally { clearTimeout(t); }
  if (res.status === 401 || res.status === 403) throw new Error("The server didn't accept the key.");
  const unexpected = "The server answered, but not with a list of models. Type the model name instead.";
  if (!res.ok) throw new Error(unexpected);
  let j: any;
  try { j = await res.json(); } catch { throw new Error(unexpected); }
  const list: any[] = Array.isArray(j?.data) ? j.data : Array.isArray(j?.models) ? j.models : [];
  const ids = [...new Set(list.map((m) => String(m?.id ?? m?.name ?? "")).filter(Boolean))].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  if (!ids.length) throw new Error(unexpected);
  return ids;
}

// ── Connection test (Wisp's VisionConnectionTest) ────────────────────────────
function whiteJpeg(): Promise<string> {
  const c = new OffscreenCanvas(64, 64);
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, 64, 64);
  return c.convertToBlob({ type: "image/jpeg", quality: 0.9 }).then((b) => new Promise<string>((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1]); fr.readAsDataURL(b); }));
}

export async function testConnection(s: WispSettings, provider: ProviderId = s.provider): Promise<{ ok: boolean; message: string }> {
  const p = s.providers[provider];
  if (provider === "local") return { ok: true, message: "The offline model needs no connection." };
  try { new URL(p.baseURL); } catch { return { ok: false, message: "That address isn't valid." }; }
  const key = await getKey(provider);
  if (PROVIDERS[provider].keyRequired && !key) return { ok: false, message: `Add your ${PROVIDERS[provider].displayName} key first.` };
  const model = provider === "nvidia-nim" && s.smartRouting ? NIM_STRONG : p.model;
  if (!model) return { ok: false, message: "Choose a model first." };
  const req: ChatRequest = { system: "Reply with one short line.", user: "What colour is this image?", images: [{ mediaType: "image/jpeg", base64: await whiteJpeg() }], maxTokens: 20, temperature: 0 };
  const t0 = performance.now();
  const ctl = new AbortController();
  const total = setTimeout(() => ctl.abort(), 45_000);
  try {
    const r = await race([{ label: model, start: streamFor({ ...s, provider }, provider, model, key, req) }], { signal: ctl.signal, firstTokenTimeoutMs: 30_000 });
    let text = "";
    for await (const piece of r.stream) text += piece;
    if (!text.trim()) return { ok: false, message: "The AI service didn't reply. Try again." };
    return { ok: true, message: `Connected. Answered in ${((performance.now() - t0) / 1000).toFixed(1)} seconds.` };
  } catch (e) {
    const status = (e as ProviderError).status ?? Number(String((e as Error).message).match(/\b(401|403)\b/)?.[1] ?? 0);
    if (status === 401 || status === 403) return { ok: false, message: provider === "openai-compatible" ? "The server didn't accept that key." : `${PROVIDERS[provider].displayName.replace(/ \(.*\)$/, "")} didn't accept that key. Remove it and paste it again.` };
    if ((e as Error).name === "AbortError") return { ok: false, message: "That's taking too long. Try again." };
    if (/failed to fetch|network/i.test((e as Error).message)) return { ok: false, message: `Couldn't reach ${providerDisplayName(p.baseURL)}. Check your internet.` };
    return { ok: false, message: (e as Error).message.slice(0, 200) };
  } finally { clearTimeout(total); }
}
