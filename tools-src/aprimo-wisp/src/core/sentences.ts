// Splits streamed SAY text into sentences so speech can start on the first one (as Wisp does).
const ABBREV = /\b(e\.g|i\.e|etc|vs|approx|Mr|Ms|Dr|No)\.$/i;

/** Returns complete sentences in `text` and the unfinished remainder. Citation markers like [k12] are dropped. */
export function takeSentences(text: string): { sentences: string[]; rest: string } {
  const clean = text.replace(/\s*\[k\d+(?:\s*,\s*k\d+)*\]/gi, "");
  const sentences: string[] = [];
  let start = 0;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (c !== "." && c !== "!" && c !== "?") continue;
    const next = clean[i + 1];
    if (next !== undefined && !/\s/.test(next)) continue; // 3.5, e.g.x, a URL
    const candidate = clean.slice(start, i + 1);
    if (c === "." && ABBREV.test(candidate.trim())) continue;
    if (next === undefined) break; // keep the last one until we know it's finished
    const s = candidate.trim();
    if (s) sentences.push(s);
    start = i + 1;
  }
  return { sentences, rest: clean.slice(start).trimStart() };
}

export function stripCitations(text: string): string {
  return text.replace(/\s*\[k\d+(?:\s*,\s*k\d+)*\]/gi, "").trim();
}
