/// <reference lib="webworker" />
// Transcribes recorded narration on this computer with Whisper (downloaded from Hugging Face on first use, then
// cached by the browser). Input: 16 kHz mono samples. Output: timestamped segments.
import { env, pipeline } from "@huggingface/transformers";

declare const self: DedicatedWorkerGlobalScope;
let asr: any = null;

self.onmessage = async (ev: MessageEvent) => {
  const { id, base, model, audio } = ev.data ?? {};
  const post = (m: object) => self.postMessage({ id, ...m });
  try {
    if (!asr) {
      env.allowRemoteModels = true;
      env.allowLocalModels = false;
      env.useBrowserCache = true;
      const onnx = env.backends.onnx as any;
      onnx.wasm.wasmPaths = `${base}vendor/ort/`;
      onnx.wasm.numThreads = 1;
      asr = await pipeline("automatic-speech-recognition", model ?? "Xenova/whisper-base.en", {
        dtype: { encoder_model: "fp32", decoder_model_merged: "q8" } as any,
        device: "wasm",
        progress_callback: (p: any) => post({ progress: p }),
      });
    }
    post({ progress: { status: "transcribing" } });
    const out = await asr(audio as Float32Array, { chunk_length_s: 30, stride_length_s: 5, return_timestamps: true });
    const segments = (out.chunks ?? [{ timestamp: [0, 0], text: out.text }]).map((c: any) => ({
      start: Number(c.timestamp?.[0] ?? 0),
      end: Number(c.timestamp?.[1] ?? c.timestamp?.[0] ?? 0),
      text: String(c.text ?? "").trim(),
    })).filter((s: any) => s.text);
    post({ result: { text: out.text, segments } });
  } catch (e) {
    post({ error: (e as Error)?.message ?? String(e) });
  }
};
