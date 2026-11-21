// Anthropic Messages wire, as in Wisp's VisionClient (.anthropicMessages): x-api-key, anthropic-version 2023-06-01,
// images before text, streamed. Browser calls need the direct-browser-access header.
import { readSSE } from "./sse";
import { ProviderError, type ChatRequest, type StreamOptions, type TextStream } from "./types";

export interface AnthropicConfig { baseURL: string; apiKey: string; model: string }

export async function* streamAnthropic(cfg: AnthropicConfig, req: ChatRequest, opts: StreamOptions = {}): TextStream {
  if (!cfg.apiKey) throw new ProviderError("Add an Anthropic API key in Wspr settings.");
  const content: unknown[] = req.images.map((img) => ({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.base64 } }));
  content.push({ type: "text", text: req.user });
  const body = {
    model: cfg.model,
    max_tokens: req.maxTokens,
    stream: true,
    // The system prompt never changes between questions, so let it be cached.
    system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
    messages: [...(req.history ?? []), { role: "user", content }],
  };
  const res = await fetch(`${cfg.baseURL.replace(/\/+$/, "")}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": cfg.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    let msg = text.slice(0, 300);
    try { msg = JSON.parse(text)?.error?.message ?? msg; } catch { /* plain */ }
    throw new ProviderError(`${res.status}: ${msg || res.statusText}`, res.status, res.status === 429 || res.status === 529 || res.status >= 500);
  }
  for await (const { event, data } of readSSE(res.body, opts.signal)) {
    if (event === "error") {
      let m = data;
      try { m = JSON.parse(data)?.error?.message ?? data; } catch { /* plain */ }
      throw new ProviderError(m, 0, /overload/i.test(m));
    }
    if (event === "message_stop") return;
    if (event !== "content_block_delta") continue;
    try {
      const j = JSON.parse(data);
      if (j.delta?.type === "text_delta" && j.delta.text) yield j.delta.text as string;
    } catch { /* skip */ }
  }
}
