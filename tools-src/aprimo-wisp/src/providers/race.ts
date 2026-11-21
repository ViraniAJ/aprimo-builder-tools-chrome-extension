// Wisp's AssistantEngine race: start the first model; if it hasn't produced real content by the stagger time (or
// fails), start the next one too. The first to produce real content wins and the others are aborted.
import type { TextStream } from "./types";

export interface RaceEntry { label: string; start: (signal: AbortSignal) => TextStream }
export interface RaceResult { winner: string; stream: AsyncGenerator<string, void, unknown> }

const real = (s: string) => /\S/.test(s);

export async function race(entries: RaceEntry[], opts: { staggerMs?: number; firstTokenTimeoutMs?: number; signal?: AbortSignal } = {}): Promise<RaceResult> {
  const stagger = opts.staggerMs ?? 2500;
  const firstTimeout = opts.firstTokenTimeoutMs ?? 20000;
  if (!entries.length) throw new Error("No model to ask.");
  const controllers: AbortController[] = [];
  const errors: string[] = [];
  type Ready = { i: number; first: string; it: AsyncIterator<string> };

  return await new Promise<RaceResult>((resolve, reject) => {
    let settled = false;
    let started = 0;
    let finished = 0;
    const abortAll = (except = -1) => controllers.forEach((c, j) => j !== except && c.abort());
    opts.signal?.addEventListener("abort", () => { if (!settled) { settled = true; abortAll(); reject(new DOMException("Aborted", "AbortError")); } });
    const overall = setTimeout(() => { if (!settled) { settled = true; abortAll(); reject(new Error(`No answer within ${Math.round(firstTimeout / 1000)} s.${errors.length ? ` ${errors.join("; ")}` : ""}`)); } }, firstTimeout);

    const launch = (i: number) => {
      if (settled || i >= entries.length) return;
      started++;
      const c = new AbortController();
      controllers[i] = c;
      const it = entries[i].start(c.signal)[Symbol.asyncIterator]();
      let pre = "";
      const pump = async (): Promise<Ready | null> => {
        for (;;) {
          const r = await it.next();
          if (r.done) return null;
          pre += r.value;
          if (real(pre)) return { i, first: pre, it };
        }
      };
      pump().then((ready) => {
        if (settled) return;
        if (!ready) { finished++; errors.push(`${entries[i].label}: empty answer`); launch(started); if (finished >= started && started >= entries.length) fail(); return; }
        settled = true;
        clearTimeout(overall);
        abortAll(i);
        resolve({ winner: entries[i].label, stream: (async function* () { yield ready.first; for (;;) { const r = await ready.it.next(); if (r.done) return; yield r.value; } })() });
      }, (e) => {
        if (settled) return;
        finished++;
        if ((e as Error)?.name !== "AbortError") errors.push(`${entries[i].label}: ${(e as Error)?.message ?? e}`);
        launch(started); // a failure starts the next model right away
        if (finished >= started && started >= entries.length) fail();
      });
    };
    const fail = () => { if (!settled) { settled = true; clearTimeout(overall); reject(new Error(errors.join("; ") || "Every model failed.")); } };
    launch(0);
    const timer = setInterval(() => { if (settled || started >= entries.length) return clearInterval(timer); launch(started); }, stagger);
  });
}
