// Providers and models, ported from Wisp (ZakVir/wisp: WispMac/Support/Keychain.swift `VisionProvider`,
// WispCore/Assistant/PromptBuilder.swift `VisionModelCatalog`, WispCore/Assistant/QuestionRouter.swift).
// Wisp's defaults are this tool's defaults: NVIDIA NIM first, Nemotron 3.5 Super VL racing Nemotron Nano.

export type ProviderId = "nvidia-nim" | "openai-compatible" | "anthropic" | "local";
export type Wire = "openAIChat" | "anthropicMessages" | "webllm";
/** How a model reports pixel positions: the image's own pixels, or 0..1000 on both axes. */
export type CoordinateSpace = "pixels" | "normalized1000" | "normalizedUnit";

export interface ModelInfo {
  id: string;
  displayName: string;
  coordinateSpace?: CoordinateSpace;
  /** Extra fields merged into the request body (Wisp's `extraBody`). */
  extraBody?: Record<string, unknown>;
  note?: string;
}

export interface ProviderInfo {
  id: ProviderId;
  displayName: string;
  /** Storage name of the key (Wisp's keychain account names). */
  keyAccount: string;
  defaultBaseURL: string;
  defaultModelID: string;
  wire: Wire;
  catalog: ModelInfo[];
  keyRequired: boolean;
  /** Wisp's default fallback list (NVIDIA only). */
  defaultFallbacks: string[];
  keyPlaceholder: string;
  keyURL?: string;
}

const noThinking = { chat_template_kwargs: { enable_thinking: false } };

export const NIM_MODELS: ModelInfo[] = [
  { id: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning", displayName: "Nemotron 3 Nano Omni", coordinateSpace: "normalized1000", extraBody: noThinking, note: "Fastest (about 1 s); the usual fallback." },
  { id: "stepfun-ai/step-5-preview", displayName: "Step 5 Preview", extraBody: { reasoning_effort: "low" }, note: "Best for drawings." },
  { id: "nvidia/nemotron-3.5-super-vl-120b-a12b", displayName: "Nemotron 3.5 Super VL", extraBody: noThinking, note: "The default: most accurate pointing (about 2 s)." },
  { id: "z-ai/glm-5.3-flash", displayName: "GLM 5.3 Flash", note: "Accurate, but slow (about 11 seconds)." },
  { id: "deepseek-ai/deepseek-v4.1-flash", displayName: "DeepSeek V4.1 Flash", extraBody: { chat_template_kwargs: { thinking: false } } },
  { id: "meta/muse-glimmer-30b", displayName: "Muse Glimmer 30B", coordinateSpace: "normalized1000" },
  { id: "google/gemma-4-31b-it", displayName: "Gemma 4 31B", coordinateSpace: "normalized1000" },
  { id: "google/diffusiongemma-26b-a4b-it", displayName: "DiffusionGemma 26B", coordinateSpace: "normalized1000" },
  { id: "meta/llama-3.2-90b-vision-instruct", displayName: "Llama 3.2 90B Vision" },
  { id: "meta/llama-3.2-11b-vision-instruct", displayName: "Llama 3.2 11B Vision", note: "Poor at pointing (4%)." },
  { id: "nvidia/ising-calibration-1.5-31b", displayName: "Ising Calibration 1.5 31B" },
];

export const CLAUDE_MODELS: ModelInfo[] = [
  { id: "claude-sonnet-5-5", displayName: "Claude Sonnet 5.5", note: "Recommended: very capable and quick." },
  { id: "claude-haiku-4-5-20251001", displayName: "Claude Haiku 4.5", note: "Fastest Claude model." },
  { id: "claude-opus-5-5", displayName: "Claude Opus 5.5", note: "Most capable; slower to start talking." },
];

export const LOCAL_MODELS: ModelInfo[] = [
  { id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC", displayName: "Qwen 2.5 1.5B (about 1 GB)", note: "Default offline model." },
  { id: "Llama-3.2-1B-Instruct-q4f16_1-MLC", displayName: "Llama 3.2 1B (about 0.9 GB)", note: "For weaker GPUs." },
];

/** Wisp's QuestionRouter: every question goes to Super VL first, Nano as its fallback; drawings to Step 5. */
export const NIM_STRONG = "nvidia/nemotron-3.5-super-vl-120b-a12b";
export const NIM_FAST = "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning";
export const NIM_DRAWING = "stepfun-ai/step-5-preview";
export const DEFAULT_CLAUDE = "claude-sonnet-5-5";

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  // Wisp's saved default model is Nano with [Super VL, Nano] as fallbacks; smart routing puts Super VL first.
  "nvidia-nim": { id: "nvidia-nim", displayName: "NVIDIA (free)", keyAccount: "nvidia-nim-api-key", defaultBaseURL: "https://integrate.api.nvidia.com/v1", defaultModelID: NIM_FAST, wire: "openAIChat", catalog: NIM_MODELS, keyRequired: true, defaultFallbacks: [NIM_STRONG, NIM_FAST], keyPlaceholder: "nvapi-…", keyURL: "https://build.nvidia.com/settings/api-keys" },
  "openai-compatible": { id: "openai-compatible", displayName: "Custom (OpenAI-compatible)", keyAccount: "openai-compatible-api-key", defaultBaseURL: "https://api.openai.com/v1", defaultModelID: "", wire: "openAIChat", catalog: [], keyRequired: false, defaultFallbacks: [], keyPlaceholder: "sk-…" },
  anthropic: { id: "anthropic", displayName: "Anthropic (Claude)", keyAccount: "anthropic-api-key", defaultBaseURL: "https://api.anthropic.com/v1", defaultModelID: DEFAULT_CLAUDE, wire: "anthropicMessages", catalog: CLAUDE_MODELS, keyRequired: true, defaultFallbacks: [], keyPlaceholder: "sk-ant-…", keyURL: "https://console.anthropic.com/settings/keys" },
  local: { id: "local", displayName: "On this computer (offline)", keyAccount: "", defaultBaseURL: "", defaultModelID: LOCAL_MODELS[0].id, wire: "webllm", catalog: LOCAL_MODELS, keyRequired: false, defaultFallbacks: [], keyPlaceholder: "" },
};

/** Saved model ids Wisp has retired, and what replaces them. */
export const RETIRED_MODELS: Record<string, string> = { "moonshotai/kimi-k3": NIM_STRONG };

/** The short list Wisp's AI tab shows before "Show all models". */
export const NIM_RECOMMENDED = [NIM_FAST, NIM_DRAWING, NIM_STRONG];

/** Wisp's providerDisplayName, from the server's host. */
export function providerDisplayName(baseURL: string): string {
  let host = "";
  try { host = new URL(baseURL).hostname; } catch { return "the AI service"; }
  if (host.endsWith("nvidia.com")) return "NVIDIA";
  if (host.endsWith("anthropic.com")) return "Anthropic";
  if (host.endsWith("openai.com")) return "OpenAI";
  if (host.endsWith("googleapis.com")) return "Google";
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return "a local server on this computer";
  return host;
}

export const DEFAULT_PROVIDER: ProviderId = "nvidia-nim";

export function modelInfo(id: string): ModelInfo {
  return [...NIM_MODELS, ...CLAUDE_MODELS, ...LOCAL_MODELS].find((m) => m.id === id) ?? { id, displayName: id };
}

/** Wisp's isDrawRequest. */
export function isDrawing(question: string): boolean {
  return /^(?:wisp,? |hey wisp,? )?(?:can you |could you |please |now )*(?:draw|sketch|doodle)\b/i.test(question.trim().toLowerCase().replace(/’/g, "'"));
}

/**
 * Wisp's QuestionRouter. Smart routing: Super VL, then Nano, then the other fallbacks; drawings go to Step 5 first.
 * Without it: the chosen model, then its fallbacks. A second opinion ("try again") swaps the first two.
 */
export function nimModelsFor(question: string, chosen: string, fallbacks: string[] = [], smartRouting = true, secondOpinion = false): string[] {
  let order: string[];
  if (smartRouting) order = isDrawing(question) ? [NIM_DRAWING, NIM_STRONG, NIM_FAST] : [NIM_STRONG, NIM_FAST, ...fallbacks];
  else order = [chosen || NIM_FAST, ...fallbacks];
  order = [...new Set(order.filter(Boolean))];
  if (secondOpinion && order.length > 1) [order[0], order[1]] = [order[1], order[0]];
  return order;
}
