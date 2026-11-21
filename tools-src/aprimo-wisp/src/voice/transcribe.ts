// Decodes a recording's audio to 16 kHz mono and sends it to the Whisper worker.
import type { TranscriptSegment } from "../kb/types";

export async function decodeTo16k(blob: Blob): Promise<Float32Array> {
  const buf = await blob.arrayBuffer();
  const ctx = new AudioContext();
  const decoded = await ctx.decodeAudioData(buf);
  await ctx.close();
  const frames = Math.ceil(decoded.duration * 16000);
  const off = new OfflineAudioContext(1, Math.max(1, frames), 16000);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const rendered = await off.startRendering();
  return rendered.getChannelData(0);
}

let worker: Worker | null = null;
let seq = 0;

export function transcribe(blob: Blob, onProgress?: (p: { status: string; progress?: number; file?: string }) => void, model = "Xenova/whisper-base.en"): Promise<{ text: string; segments: TranscriptSegment[] }> {
  return decodeTo16k(blob).then((audio) => new Promise((resolve, reject) => {
    worker ??= new Worker(chrome.runtime.getURL("app/wisp/asr-worker.js"), { type: "module" });
    const id = ++seq;
    const onMsg = (ev: MessageEvent) => {
      if (ev.data?.id !== id) return;
      if (ev.data.progress) return onProgress?.(ev.data.progress);
      worker!.removeEventListener("message", onMsg);
      ev.data.error ? reject(new Error(ev.data.error)) : resolve(ev.data.result);
    };
    worker!.addEventListener("message", onMsg);
    worker!.postMessage({ id, base: chrome.runtime.getURL(""), model, audio }, [audio.buffer]);
  }));
}
