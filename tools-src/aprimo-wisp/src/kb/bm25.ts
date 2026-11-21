// A small BM25 keyword index: catches exact terms (API names, field names, error text) that embeddings blur.
const STOP = new Set("a an and are as at be by can do does for from how i if in into is it its me my of on or the this to was what when where which who why will with you your".split(" "));

export function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9_/.-]+/g, " ").split(/\s+/)
    .map((t) => t.replace(/^[./-]+|[./-]+$/g, ""))
    .filter((t) => t.length > 1 && !STOP.has(t));
}

export class BM25 {
  private df = new Map<string, number>();
  private tfs: Map<string, number>[] = [];
  private lens: number[] = [];
  private avg = 0;
  private k1: number;
  private b: number;
  constructor(k1 = 1.2, b = 0.75) {
    this.k1 = k1;
    this.b = b;
  }

  add(text: string) {
    const toks = tokenize(text);
    const tf = new Map<string, number>();
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    this.tfs.push(tf);
    this.lens.push(toks.length);
    this.avg = this.lens.reduce((a, b) => a + b, 0) / this.lens.length;
  }

  get size() { return this.tfs.length; }

  scores(query: string): Float32Array {
    const n = this.tfs.length;
    const out = new Float32Array(n);
    const terms = [...new Set(tokenize(query))];
    for (const t of terms) {
      const df = this.df.get(t);
      if (!df) continue;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      for (let i = 0; i < n; i++) {
        const f = this.tfs[i].get(t);
        if (!f) continue;
        out[i] += idf * ((f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + (this.b * this.lens[i]) / (this.avg || 1))));
      }
    }
    return out;
  }
}

/** Reciprocal rank fusion of several score lists over the same items. */
export function rrf(lists: Float32Array[], k = 60, top = 6, minScore = 0): number[] {
  const fused = new Map<number, number>();
  for (const scores of lists) {
    const order = [...scores.keys()].filter((i) => scores[i] > minScore).sort((a, b) => scores[b] - scores[a]).slice(0, 100);
    order.forEach((idx, rank) => fused.set(idx, (fused.get(idx) ?? 0) + 1 / (k + rank + 1)));
  }
  return [...fused.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).map(([i]) => i);
}
