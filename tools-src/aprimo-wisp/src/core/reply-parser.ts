// Streaming parser for Wisp's line-tagged reply format. It accepts both grammars:
//
// Native Wisp (coordinates in the screenshot's space):
//   TOPIC: screen | other
//   SAY: Click Share in the toolbar.
//   POINT: 812, 64 | Share            CIRCLE: x, y, w, h | label
//   UNDERLINE: x1, y1, x2, y2         ARROW: x1, y1, x2, y2 | label      PATH: x1,y1 x2,y2 …  (max 64 points)
//   …any visual may end with "| screen N"
//   STEPS: more | done
//
// The browser extensions (element ids from the page snapshot, walkthroughs, sources, videos, navigation):
//   POINT: e17 | "Administration"     (or @612,388)       CIRCLE: e42     ARROW: e4 -> e17     PATH: e2, e9, e17
//   STEP 2/3: Choose Classifications. | e42 ? hash~/classifications
//   SOURCE: k12, k40        VIDEO: k77 @83 | "Creating a classification"        NAV: #/management/classifications
//   DONE
//
// Like Wisp: <think>…</think> is dropped, several tags on one line are split apart, untagged lines and unknown tags
// are spoken, numbers are read leniently, and degenerate (looping) output is detected.

export type Target =
  | { kind: "element"; id: string }
  | { kind: "point"; x: number; y: number }
  | { kind: "rect"; x: number; y: number; w: number; h: number };
export type ShapeKind = "POINT" | "CIRCLE" | "UNDERLINE";

export type ReplyEvent =
  | { type: "topic"; text: string }
  | { type: "say"; text: string }
  | { type: "say-partial"; text: string }
  | { type: "shape"; shape: ShapeKind; target: Target; label?: string; screen?: number }
  | { type: "arrow"; from: Target; to: Target; label?: string; screen?: number }
  | { type: "path"; targets: Target[]; label?: string; screen?: number }
  | { type: "step"; index: number; total: number; text: string; target?: Target; until?: string }
  | { type: "steps"; more: boolean }
  | { type: "source"; ids: string[] }
  | { type: "video"; id: string; at?: number; label?: string }
  | { type: "nav"; route: string }
  | { type: "done" }
  | { type: "text"; text: string }; // an untagged line: spoken, as in Wisp

const ELEMENT = /^e\d+$/i;
const MAX_PATH = 64;
const KNOWN_TAGS = ["TOPIC", "SAY", "POINT", "CIRCLE", "UNDERLINE", "ARROW", "PATH", "STEPS", "STEP", "SOURCES", "SOURCE", "VIDEO", "NAV"];
// Wisp splits "SAY: … POINT: …" on one line at each visual or SAY tag that follows whitespace.
const INLINE_SPLIT = /(?<=\s)(?=(?:SAY|POINT|CIRCLE|UNDERLINE|ARROW|PATH|STEP(?:S)?|SOURCE|VIDEO|NAV)(?:\s+\d+\s*\/\s*\d+)?\s*:)/g;

/** Every number in a string, read leniently ("x=612, y=388", "(612; 388)", "612 388"). */
export function numbers(s: string): number[] {
  return [...s.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
}

export function parseTarget(raw: string): Target | null {
  const s = raw.trim().replace(/^["“]|["”]$/g, "");
  if (ELEMENT.test(s)) return { kind: "element", id: s.toLowerCase() };
  if (/[a-df-z]{3,}/i.test(s.replace(/\b[xywh]\s*=/gi, ""))) return null; // words, not coordinates
  const n = numbers(s);
  if (n.length >= 4 && !s.startsWith("@")) return { kind: "rect", x: n[0], y: n[1], w: n[2], h: n[3] };
  if (n.length >= 2) return { kind: "point", x: n[0], y: n[1] };
  return null;
}

/** Splits "target | label | screen 2" into parts; the label may be quoted. */
function splitPipes(rest: string): { head: string; label?: string; screen?: number } {
  const parts = rest.split("|").map((p) => p.trim());
  const head = parts.shift() ?? "";
  let label: string | undefined;
  let screen: number | undefined;
  for (const p of parts) {
    const sm = p.match(/^screen\s*(\d+)$/i);
    if (sm) screen = Number(sm[1]);
    else if (p && label === undefined) label = p.replace(/^["“]|["”]$/g, "");
  }
  return { head, label, screen };
}

function pointsFrom(head: string): Target[] {
  // Element ids, "@x,y" or "x,y" groups, or a flat run of numbers taken in pairs.
  const pieces = head.split(/\s*(?:->|→|;)\s*|\s*,\s*(?=e\d+\b)|(?<=\be\d+)\s*,\s*/i).filter(Boolean);
  if (pieces.length > 1 && pieces.every((p) => ELEMENT.test(p.trim()) || /^@?\s*-?\d/.test(p.trim()))) {
    const t = pieces.map((p) => parseTarget(p)).filter((x): x is Target => !!x);
    if (t.length >= 2) return t.slice(0, MAX_PATH);
  }
  const ids = head.match(/\be\d+\b/gi);
  if (ids && ids.length >= 2) return ids.slice(0, MAX_PATH).map((id) => ({ kind: "element", id: id.toLowerCase() }));
  const n = numbers(head);
  const out: Target[] = [];
  for (let i = 0; i + 1 < n.length && out.length < MAX_PATH; i += 2) out.push({ kind: "point", x: n[i], y: n[i + 1] });
  return out;
}

export function parseLine(line: string): ReplyEvent | null {
  const t = line.replace(/\r$/, "").trim().replace(/^[-*•]\s+(?=[A-Z]+\s*[:\d])/, "");
  if (!t) return null;
  if (/^\**DONE\.?\**$/i.test(t)) return { type: "done" };
  const tag = t.match(/^\**\s*([A-Za-z]+)(?:\s+(\d+)\s*(?:\/|of)\s*(\d+))?\s*\**\s*:\s*(.*)$/);
  if (!tag) return { type: "text", text: t };
  const [, rawName, a, b, restRaw] = tag;
  const name = rawName.toUpperCase();
  const rest = restRaw.trim().replace(/\*+$/, "").trim();
  if (!KNOWN_TAGS.includes(name)) {
    // Wisp: an unknown tag is spoken. Short lowercase words ("note:") read as plain text with the tag kept.
    return rest ? { type: "say", text: rawName === name ? rest : t } : null;
  }
  switch (name) {
    case "TOPIC": {
      // Wisp: screen | you | other ("wisp" means you); anything else is screen if it starts with "screen".
      const w = rest.toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g, "");
      const topic = w === "wisp" ? "you" : ["screen", "you", "other"].includes(w) ? w : w.startsWith("screen") ? "screen" : rest ? (/^[a-z]+$/.test(w) ? "other" : rest) : "other";
      return { type: "topic", text: topic };
    }
    case "SAY":
      return rest ? { type: "say", text: rest } : null;
    case "POINT":
    case "CIRCLE":
    case "UNDERLINE": {
      const { head, label, screen } = splitPipes(rest);
      let target = parseTarget(head);
      if (target && name === "POINT" && target.kind === "rect") target = { kind: "point", x: target.x, y: target.y };
      if (target && name === "UNDERLINE" && target.kind === "rect") {
        // Wisp's UNDERLINE is x1,y1,x2,y2: a line under the text.
        const [x1, y1, x2, y2] = [target.x, target.y, target.w, target.h];
        target = { kind: "rect", x: Math.min(x1, x2), y: Math.min(y1, y2) - 14, w: Math.max(4, Math.abs(x2 - x1)), h: Math.max(14, Math.abs(y2 - y1) + 14) };
      }
      return target ? { type: "shape", shape: name, target, label, screen } : null;
    }
    case "ARROW": {
      const { head, label, screen } = splitPipes(rest);
      const parts = head.split(/\s*(?:->|→|\bto\b)\s*/i);
      if (parts.length >= 2) {
        const from = parseTarget(parts[0]);
        const to = parseTarget(parts[1]);
        if (from && to) return { type: "arrow", from: asPoint(from), to: asPoint(to), label, screen };
      }
      const n = numbers(head);
      if (n.length >= 4) return { type: "arrow", from: { kind: "point", x: n[0], y: n[1] }, to: { kind: "point", x: n[2], y: n[3] }, label, screen };
      return null;
    }
    case "PATH": {
      const { head, label, screen } = splitPipes(rest);
      const targets = pointsFrom(head);
      return targets.length >= 2 ? { type: "path", targets, label, screen } : null;
    }
    case "STEPS":
      return { type: "steps", more: ["more", "next", "continue", "yes"].some((p) => rest.toLowerCase().startsWith(p)) };
    case "STEP": {
      const [textPart, ...tail] = rest.split("|");
      let target: Target | undefined;
      let until: string | undefined;
      if (tail.length) {
        const [tgt, cond] = tail.join("|").split("?");
        target = parseTarget(tgt ?? "") ?? undefined;
        if (target?.kind === "rect") target = { kind: "point", x: target.x, y: target.y };
        if (cond) until = cond.trim();
      }
      return { type: "step", index: Number(a ?? 1), total: Number(b ?? a ?? 1), text: textPart.trim(), target, until };
    }
    case "SOURCE":
    case "SOURCES": {
      const ids = rest.split(/[\s,;]+/).map((x) => x.replace(/[[\]]/g, "")).filter((x) => /^k\d+$/i.test(x));
      return ids.length ? { type: "source", ids: ids.map((x) => x.toLowerCase()) } : null;
    }
    case "VIDEO": {
      const { head, label } = splitPipes(rest);
      const m = head.match(/^(k\d+)(?:\s*@\s*(?:(\d+):)?(\d+(?:\.\d+)?))?$/i);
      if (!m) return null;
      const at = m[3] !== undefined ? (m[2] ? Number(m[2]) * 60 : 0) + Number(m[3]) : undefined;
      return { type: "video", id: m[1].toLowerCase(), at, label };
    }
    case "NAV":
      return /^#\//.test(rest) ? { type: "nav", route: rest } : null;
  }
  return null;
}

/** The end of `s` if it could be the start of `tag` ("<thi" for "<think>"). */
function partialTag(s: string, tag: string): string {
  for (let n = Math.min(tag.length - 1, s.length); n > 0; n--) if (tag.toLowerCase().startsWith(s.slice(-n).toLowerCase())) return s.slice(-n);
  return "";
}

const asPoint = (t: Target): Target => (t.kind === "rect" ? { kind: "point", x: t.x, y: t.y } : t);

/** Splits one physical line that holds several tags ("SAY: Here. POINT: 10, 20") into logical lines. */
export function splitInline(line: string): string[] {
  return line.split(INLINE_SPLIT).map((s) => s.trim()).filter(Boolean);
}

/** Wisp's DegenerateOutputDetector: a run of 8+ identical symbols, mostly punctuation, or the last 12 words
 *  using two distinct words or fewer. */
export function isDegenerate(text: string): boolean {
  if (/([^\p{L}\p{N}\s\-=])\1{7,}/u.test(text)) return true;
  const chars = text.replace(/\s+/g, "");
  if (chars.length >= 40) {
    const punct = [...chars].filter((c) => /[^\p{L}\p{N}]/u.test(c) && !",.|:'\"()-".includes(c)).length;
    if (punct / chars.length > 0.5) return true;
  }
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length >= 12 && new Set(words.slice(-12)).size <= 2) return true;
  return false;
}

/** Feed text chunks as they stream; get events back in order. */
export class ReplyParser {
  private buf = "";
  private lastPartial = "";
  private inThink = false;
  private all = "";
  degenerate = false;

  private hold = "";

  /** Removes <think>…</think> as it streams; a tag split across chunks is held back until it's complete. */
  private dethink(chunk: string): string {
    let s = this.hold + chunk;
    this.hold = "";
    let out = "";
    for (;;) {
      if (this.inThink) {
        const end = s.search(/<\/think>/i);
        if (end < 0) { this.hold = partialTag(s, "</think>"); return out; }
        s = s.slice(end + 8);
        this.inThink = false;
        continue;
      }
      const open = s.search(/<think>/i);
      const close = s.search(/<\/think>/i);
      if (close >= 0 && (open < 0 || close < open)) { s = s.slice(close + 8); out = ""; continue; } // stray closer: drop what came before
      if (open < 0) {
        const tail = partialTag(s, "<think>") || partialTag(s, "</think>");
        out += s.slice(0, s.length - tail.length);
        this.hold = tail;
        return out;
      }
      out += s.slice(0, open);
      s = s.slice(open + 7);
      this.inThink = true;
    }
  }

  private emitLine(line: string, out: ReplyEvent[]) {
    for (const piece of splitInline(line)) {
      const ev = parseLine(piece);
      if (ev) out.push(ev);
    }
  }

  push(chunk: string): ReplyEvent[] {
    const clean = this.dethink(chunk);
    this.all += clean;
    if (!this.degenerate && isDegenerate(this.all.slice(-1200))) this.degenerate = true;
    this.buf += clean;
    const out: ReplyEvent[] = [];
    let nl: number;
    while ((nl = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      this.emitLine(line, out);
      this.lastPartial = "";
    }
    // A SAY line still arriving is shown live (only up to the next inline tag, if one has started).
    const partial = this.buf.match(/^\s*\**SAY\**\s*:\s*(.+)$/i);
    if (partial) {
      const text = splitInline(`SAY: ${partial[1]}`)[0].replace(/^SAY\s*:\s*/i, "");
      if (text && text !== this.lastPartial) {
        this.lastPartial = text;
        out.push({ type: "say-partial", text });
      }
    }
    return out;
  }

  end(): ReplyEvent[] {
    if (!this.inThink) this.buf += this.hold;
    this.hold = "";
    const rest = this.buf;
    this.buf = "";
    const out: ReplyEvent[] = [];
    this.emitLine(rest, out);
    return out;
  }
}

/** Converts a model's coordinates into viewport CSS pixels. */
export function toViewport(p: { x: number; y: number }, space: "pixels" | "normalized1000" | "normalizedUnit", image: { width: number; height: number }, viewport: { width: number; height: number }) {
  const k = space === "normalized1000" ? 1000 : space === "normalizedUnit" ? 1 : 0;
  const ix = k ? (p.x / k) * image.width : p.x;
  const iy = k ? (p.y / k) * image.height : p.y;
  return { x: Math.round((ix * viewport.width) / image.width), y: Math.round((iy * viewport.height) / image.height) };
}

export function targetToViewport(t: Target, space: "pixels" | "normalized1000" | "normalizedUnit", image: { width: number; height: number }, viewport: { width: number; height: number }): Target {
  if (t.kind === "element") return t;
  if (t.kind === "point") return { kind: "point", ...toViewport(t, space, image, viewport) };
  const a = toViewport({ x: t.x, y: t.y }, space, image, viewport);
  const b = toViewport({ x: t.x + t.w, y: t.y + t.h }, space, image, viewport);
  return { kind: "rect", x: a.x, y: a.y, w: Math.max(1, b.x - a.x), h: Math.max(1, b.y - a.y) };
}

/** Wisp's gesture anchor: point; circle centre; underline midpoint; arrow end; path start. */
export function anchorOf(ev: ReplyEvent): Target | null {
  if (ev.type === "shape") {
    const t = ev.target;
    if (t.kind === "rect") return { kind: "point", x: t.x + t.w / 2, y: t.y + t.h / 2 };
    return t;
  }
  if (ev.type === "arrow") return ev.to;
  if (ev.type === "path") return ev.targets[0] ?? null;
  return null;
}
