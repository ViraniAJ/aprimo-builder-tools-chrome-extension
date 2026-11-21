// Speaks answers sentence by sentence (as Wisp does), through Chrome's TTS. Tracks whether anything is still being
// spoken so walkthroughs can wait for Wisp to finish talking.
export interface Voice { name: string; lang?: string; remote?: boolean }

let queued = 0;
export const isSpeaking = () => queued > 0;

export function voices(): Promise<Voice[]> {
  return new Promise((resolve) => chrome.tts.getVoices((v) => resolve((v ?? []).map((x) => ({ name: x.voiceName ?? "", lang: x.lang, remote: x.remote })).filter((x) => x.name))));
}

export function speak(text: string, opts: { voiceName?: string; rate?: number; volume?: number; onStart?: () => void; onEnd?: () => void } = {}) {
  if (!text.trim()) return;
  queued++;
  let done = false;
  const finish = () => { if (!done) { done = true; queued = Math.max(0, queued - 1); opts.onEnd?.(); } };
  // "Wspr" is said "whisper"; without this, voices spell it out.
  chrome.tts.speak(text.replace(/\bWspr\b/gi, "Whisper"), {
    enqueue: true,
    rate: opts.rate ?? 1,
    volume: opts.volume ?? 1,
    ...(opts.voiceName ? { voiceName: opts.voiceName } : {}),
    onEvent: (e) => {
      if (e.type === "start") opts.onStart?.();
      if (e.type === "end" || e.type === "interrupted" || e.type === "cancelled" || e.type === "error") finish();
    },
  });
}

export function stopSpeaking() {
  queued = 0;
  chrome.tts.stop();
}

/** Resolves once nothing is being spoken (polls every 400 ms, as Wisp retries). */
export async function untilQuiet(maxMs = 30000): Promise<void> {
  const t0 = Date.now();
  while (isSpeaking() && Date.now() - t0 < maxMs) await new Promise((r) => setTimeout(r, 400));
}

/** Short listening sounds (Wisp's earcons). */
export function earcon(kind: "start" | "stop") {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = kind === "start" ? 880 : 620;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.16);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.18);
    o.onended = () => ctx.close();
  } catch { /* no audio */ }
}
