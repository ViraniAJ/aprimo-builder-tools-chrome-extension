// OpenAI chat-completions wire (NVIDIA NIM, OpenAI, Ollama, most gateways), as in Wisp's VisionClient
// (.openAIChat): streamed, images as data URLs after the text, temperature 0.2, model extras merged into the body.
import { readSSE } from "./sse";
import { ProviderError, type ChatRequest, type StreamOptions, type TextStream } from "./types";

export interface OpenAICompatConfig { baseURL: string; apiKey: string; model: string; extraBody?: Record<string, unknown> }

export async function* streamOpenAICompat(cfg: OpenAICompatConfig, req: ChatRequest, opts: StreamOptions = {}): TextStream {
  if (!cfg.model) throw new ProviderError("Choose a model for this provider in Wspr settings.");
  const content: unknown[] = [{ type: "text", text: req.user }];
  for (const img of req.images) content.push({ type: "image_url", image_url: { url: `data:${img.mediaType};base64,${img.base64}` } });
  const body: Record<string, unknown> = {
    model: cfg.model,
    stream: true,
    max_tokens: req.maxTokens,
    temperature: req.temperature ?? 0.2,
    messages: [{ role: "system", content: req.system }, ...(req.history ?? []), { role: "user", content: req.images.length ? content : req.user }],
    ...(cfg.extraBody ?? {}),
  };
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "text/event-stream" };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  const res = await fetch(`${cfg.baseURL.replace(/\/+$/, "")}/chat/completions`, { method: "POST", headers, body: JSON.stringify(body), signal: opts.signal });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    let msg = text.slice(0, 300);
    try { msg = JSON.parse(text)?.error?.message ?? JSON.parse(text)?.detail ?? msg; } catch { /* plain text */ }
    throw new ProviderError(`${res.status}: ${msg || res.statusText}`, res.status, res.status === 429 || res.status >= 500);
  }
  for await (const { data } of readSSE(res.body, opts.signal)) {
    if (data === "[DONE]") return;
    let j: any;
    try { j = JSON.parse(data); } catch { continue; }
    // NIM reports overload inside a 200 stream: {"error": {"message": "ResourceExhausted: …"}}
    if (j.error) throw new ProviderError(String(j.error.message ?? j.error), 0, /exhaust|limit|overload/i.test(String(j.error.message)));
    const piece = j.choices?.[0]?.delta?.content;
    if (typeof piece === "string" && piece) yield piece;
  }
}
