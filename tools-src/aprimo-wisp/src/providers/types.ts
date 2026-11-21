export interface ChatImage { mediaType: "image/jpeg" | "image/png"; base64: string }
export interface ChatRequest {
  system: string;
  user: string;
  images: ChatImage[];
  maxTokens: number;
  temperature?: number;
  /** Prior turns for follow-ups (walkthrough continuation); plain text only. */
  history?: { role: "user" | "assistant"; content: string }[];
}
export interface StreamOptions { signal?: AbortSignal; firstTokenTimeoutMs?: number; totalTimeoutMs?: number }
export type TextStream = AsyncGenerator<string, void, unknown>;

export type ProviderErrorKind = "noKey" | "noModel" | "badURL" | "privacy" | "local" | "network" | "timeout" | "degenerate" | "http";

export class ProviderError extends Error {
  status: number;
  retryable: boolean;
  kind?: ProviderErrorKind;
  constructor(message: string, status = 0, retryable = false, kind?: ProviderErrorKind) {
    super(message);
    this.status = status;
    this.retryable = retryable;
    this.kind = kind ?? (status ? "http" : undefined);
  }
}
