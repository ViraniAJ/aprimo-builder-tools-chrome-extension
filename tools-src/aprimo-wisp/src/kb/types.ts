// Knowledge shared by the build pipeline and the extension.
export type KnowledgeSource = "dev" | "help" | "user" | "crawl" | "file" | "recording" | "video";

export interface TranscriptSegment { start: number; end: number; text: string }
export interface RecipeStep { at: number; route: string; action: string; target?: { role: string; text: string; aria?: string; auto?: string }; note?: string }

export interface KnowledgeDoc {
  id: string;
  source: KnowledgeSource;
  title: string;
  url: string;
  /** Markdown or plain text. For videos and recordings: the transcript joined, used for keyword search. */
  text: string;
  video?: { url: string; segments: TranscriptSegment[] };
  recipe?: RecipeStep[];
  addedAt?: number;
}

export interface Chunk {
  title: string; // "Page title > Section"
  url: string;
  src: KnowledgeSource;
  text: string;
  docId?: string;
  video?: { url: string; start: number };
}

export const EMBED_MODEL = "Xenova/all-MiniLM-L6-v2";
export const EMBED_DTYPE = "q8";
export const EMBED_DIMS = 384;
