// Splits documents into searchable chunks. Text is split at headings, then packed to about `size` characters with
// some overlap; every chunk is prefixed by its heading path so it reads on its own. Transcripts are split into
// time windows that keep their start time, so answers can link to the right moment in a video.
import type { Chunk, KnowledgeDoc } from "./types";

export function chunkMarkdown(title: string, md: string, size = 1600, overlap = 240): { heading: string; text: string }[] {
  const lines = md.replace(/\r/g, "").split("\n");
  const sections: { path: string[]; body: string[] }[] = [];
  const path: string[] = [];
  let cur = { path: [] as string[], body: [] as string[] };
  for (const line of lines) {
    const h = line.match(/^(#{1,4})\s+(.+?)\s*#*\s*$/);
    if (h) {
      if (cur.body.join("").trim()) sections.push(cur);
      const level = h[1].length;
      path.length = Math.max(0, level - 1);
      path[level - 1] = h[2].trim();
      cur = { path: path.filter(Boolean), body: [] };
    } else cur.body.push(line);
  }
  if (cur.body.join("").trim()) sections.push(cur);

  const out: { heading: string; text: string }[] = [];
  for (const s of sections) {
    const heading = [title, ...s.path.filter((p) => p !== title)].join(" > ");
    const text = s.body.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    if (text.length <= size) { if (text.length > 40) out.push({ heading, text }); continue; }
    const paras = text.split(/\n\n+/);
    let buf = "";
    for (const p of paras) {
      if (buf && buf.length + p.length + 2 > size) {
        out.push({ heading, text: buf.trim() });
        buf = buf.slice(Math.max(0, buf.length - overlap));
      }
      if (p.length > size) {
        for (let i = 0; i < p.length; i += size - overlap) {
          const piece = p.slice(i, i + size);
          if (buf) { out.push({ heading, text: (buf + "\n\n" + piece).trim().slice(0, size + overlap) }); buf = ""; }
          else out.push({ heading, text: piece });
        }
        continue;
      }
      buf += (buf ? "\n\n" : "") + p;
    }
    if (buf.trim().length > 40) out.push({ heading, text: buf.trim() });
  }
  return out;
}

export function chunkTranscript(segments: { start: number; end: number; text: string }[], windowSec = 60): { start: number; text: string }[] {
  const out: { start: number; text: string }[] = [];
  let start = -1;
  let buf: string[] = [];
  for (const s of segments) {
    if (start < 0) start = s.start;
    buf.push(s.text.trim());
    if (s.end - start >= windowSec) { out.push({ start, text: buf.join(" ") }); start = -1; buf = []; }
  }
  if (buf.length) out.push({ start: Math.max(0, start), text: buf.join(" ") });
  return out.filter((c) => c.text.length > 20);
}

export const fmtTime = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

export function recipeText(doc: KnowledgeDoc): string {
  if (!doc.recipe?.length) return "";
  return doc.recipe.map((r, i) => {
    const what = r.target ? `${r.action} "${r.target.text || r.target.aria || r.target.auto || r.target.role}"${r.target.auto ? ` (auto=${r.target.auto})` : ""}` : r.action;
    return `Step ${i + 1} (${fmtTime(r.at)}, page ${r.route || "/"}): ${what}${r.note ? `. ${r.note}` : ""}`;
  }).join("\n");
}

/** Every chunk of a document, ready to embed. */
export function chunkDoc(doc: KnowledgeDoc): Chunk[] {
  const base = { url: doc.url, src: doc.source, docId: doc.id };
  const chunks: Chunk[] = [];
  if (doc.video?.segments.length) {
    for (const w of chunkTranscript(doc.video.segments)) {
      chunks.push({ ...base, title: `${doc.title} (video at ${fmtTime(w.start)})`, text: w.text, video: { url: doc.video.url, start: w.start } });
    }
  }
  const recipe = recipeText(doc);
  if (recipe) chunks.push({ ...base, title: `${doc.title} > Recorded walkthrough`, text: recipe, ...(doc.video ? { video: { url: doc.video.url, start: doc.recipe![0].at } } : {}) });
  if (doc.text && !doc.video) for (const c of chunkMarkdown(doc.title, doc.text)) chunks.push({ ...base, title: c.heading, text: c.text });
  return chunks;
}

/** The text that is embedded for a chunk (heading included, so short sections still carry their topic). */
export const embedText = (c: Chunk) => `${c.title}\n${c.text}`.slice(0, 2000);
