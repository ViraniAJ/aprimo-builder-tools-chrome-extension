// Brings documents into Wisp from extension pages (which have a DOM): web pages and whole sites, the signed-in
// Aprimo help center, files (Markdown, text, HTML, PDF, VTT/SRT, Wisp knowledge packs) and video links.
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import { parseCaptions } from "./transcript";
import type { KnowledgeDoc, KnowledgeSource } from "./types";

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
turndown.remove(["script", "style", "noscript", "iframe", "svg", "nav", "footer"]);
turndown.addRule('anchorLinks', {
  // Docusaurus and similar sites add a "#" permalink inside every heading; drop it.
  filter: (node: any) => node.nodeName === 'A' && ((node.getAttribute('class') || '').includes('hash-link') || /^Direct link/i.test(node.getAttribute('title') || node.getAttribute('aria-label') || '') || ((node.getAttribute('href') || '').startsWith('#') && !(node.textContent || '').replace(/[\u200b\s#]/g, ''))),
  replacement: () => '',
});

export const docId = (prefix: string, key: string) => `${prefix}:${key}`;

/** HTML → {title, markdown}. Uses the page's main article when Readability can find one. */
export function htmlToMarkdown(html: string, url: string): { title: string; markdown: string } {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const baseEl = doc.createElement("base");
  baseEl.href = url;
  doc.head.prepend(baseEl);
  const title = doc.querySelector("h1")?.textContent?.trim() || doc.title?.trim() || url;
  const main = doc.querySelector("main article, article, [role=main], main");
  let html2 = main?.innerHTML ?? "";
  try {
    const art = new Readability(doc.cloneNode(true) as Document, { charThreshold: 200 }).parse();
    if (art?.content && art.textContent && art.textContent.length > (main?.textContent?.length ?? 0) * 0.6) html2 = art.content;
  } catch { /* fall back to <main> */ }
  if (!html2) html2 = doc.body?.innerHTML ?? "";
  const markdown = turndown.turndown(html2).replace(/\[\u200b?\]\(#[^)]*\)/g, "").replace(/\[([^\]]*)\]\(#[^)]*"Direct link to[^)]*\)/g, "$1").replace(/\[([^\]]+)\]\(#[^)]*\)/g, "$1").replace(/\n{3,}/g, "\n\n").trim();
  return { title, markdown: markdown.startsWith("#") ? markdown : `# ${title}\n\n${markdown}` };
}

export interface CrawlOptions {
  start: string;
  maxPages: number;
  maxDepth: number;
  /** Only follow links whose URL starts with one of these (defaults to the start URL's folder). */
  prefixes?: string[];
  /** Send cookies (needed for the Aprimo help center, which uses the Aprimo sign-in). */
  withCredentials?: boolean;
  delayMs?: number;
  source: KnowledgeSource;
  signal?: AbortSignal;
  onPage?: (info: { url: string; count: number; queued: number; error?: string }) => void;
}

const SKIP = /\.(png|jpe?g|gif|svg|webp|ico|css|js|mjs|json|xml|zip|gz|mp4|mov|webm|mp3|woff2?|ttf|eot)(\?|$)/i;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Same-site breadth-first crawl. Returns one document per page with readable content. */
export async function crawl(o: CrawlOptions): Promise<KnowledgeDoc[]> {
  const start = new URL(o.start);
  const prefixes = o.prefixes?.length ? o.prefixes : [start.origin + start.pathname.replace(/[^/]*$/, "")];
  const seen = new Set<string>();
  const queue: { url: string; depth: number }[] = [{ url: start.href, depth: 0 }];
  const docs: KnowledgeDoc[] = [];
  const norm = (u: URL) => { u.hash = ""; return u.href.replace(/\/$/, ""); };
  seen.add(norm(new URL(start.href)));
  while (queue.length && docs.length < o.maxPages) {
    if (o.signal?.aborted) break;
    const { url, depth } = queue.shift()!;
    try {
      const res = await fetch(url, { credentials: o.withCredentials ? "include" : "omit", signal: o.signal, redirect: "follow" });
      if (res.status === 401 || res.status === 403) throw new Error(`${res.status}: sign in to Aprimo in this browser first`);
      if (!res.ok) throw new Error(String(res.status));
      if (!/html/i.test(res.headers.get("content-type") ?? "")) { o.onPage?.({ url, count: docs.length, queued: queue.length }); continue; }
      const html = await res.text();
      const finalUrl = res.url || url;
      const { title, markdown } = htmlToMarkdown(html, finalUrl);
      if (markdown.length > 200) docs.push({ id: docId(o.source, finalUrl), source: o.source, title, url: finalUrl, text: markdown, addedAt: Date.now() });
      if (depth < o.maxDepth) {
        const d = new DOMParser().parseFromString(html, "text/html");
        for (const a of d.querySelectorAll<HTMLAnchorElement>("a[href]")) {
          let u: URL;
          try { u = new URL(a.getAttribute("href")!, finalUrl); } catch { continue; }
          if (!/^https?:$/.test(u.protocol) || SKIP.test(u.pathname)) continue;
          const key = norm(u);
          if (seen.has(key) || !prefixes.some((p) => key.startsWith(p.replace(/\/$/, "")))) continue;
          seen.add(key);
          queue.push({ url: key, depth: depth + 1 });
        }
      }
      o.onPage?.({ url: finalUrl, count: docs.length, queued: queue.length });
    } catch (e) {
      if ((e as Error).name === "AbortError") break;
      o.onPage?.({ url, count: docs.length, queued: queue.length, error: (e as Error).message });
      if (/sign in/.test((e as Error).message) && docs.length === 0) throw e;
    }
    await sleep(o.delayMs ?? 400);
  }
  return docs;
}

/** The Aprimo help center needs the user's Aprimo sign-in; it is indexed on this computer only. */
export const HELP_CENTER = "https://help.aprimo.com/";

async function pdfText(buf: ArrayBuffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: false });
  return (text as string[]).map((t, i) => `## Page ${i + 1}\n\n${t}`).join("\n\n");
}

/** Turns an uploaded file into documents. A `.wisp.json` knowledge pack can hold many documents. */
export async function fileToDocs(file: File): Promise<KnowledgeDoc[]> {
  const name = file.name;
  const lower = name.toLowerCase();
  const id = docId("file", `${name}:${file.size}:${file.lastModified}`);
  const base = { id, source: "file" as const, title: name.replace(/\.[^.]+$/, ""), url: `file:${name}`, addedAt: Date.now() };
  if (lower.endsWith(".wisp.json") || lower.endsWith(".json")) {
    const j = JSON.parse(await file.text());
    const docs: KnowledgeDoc[] = Array.isArray(j) ? j : Array.isArray(j.docs) ? j.docs : [j];
    return docs.filter((d) => d && d.id && d.title && (d.text || d.video));
  }
  if (lower.endsWith(".pdf")) return [{ ...base, text: `# ${base.title}\n\n${await pdfText(await file.arrayBuffer())}` }];
  if (lower.endsWith(".html") || lower.endsWith(".htm")) { const { title, markdown } = htmlToMarkdown(await file.text(), base.url); return [{ ...base, title, text: markdown }]; }
  if (lower.endsWith(".vtt") || lower.endsWith(".srt")) {
    const segments = parseCaptions(await file.text());
    return [{ ...base, source: "video", text: segments.map((s) => s.text).join(" "), video: { url: "", segments } }];
  }
  return [{ ...base, text: await file.text() }];
}

/** A video demo: a link plus a transcript (captions file or pasted text). */
export function videoDoc(title: string, url: string, captions: string): KnowledgeDoc {
  const segments = /-->/.test(captions) ? parseCaptions(captions) : captions.split(/\n+/).filter(Boolean).map((t, i) => ({ start: i * 15, end: i * 15 + 15, text: t }));
  return { id: docId("video", url || title), source: "video", title, url, text: segments.map((s) => s.text).join(" "), video: { url, segments }, addedAt: Date.now() };
}
