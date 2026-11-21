// Push-to-talk speech input with Chrome's speech recognition. The microphone permission for the extension is
// granted once in a normal tab (app/wisp/mic-permission.html), because the side panel can't show the prompt.
type Rec = any;

export function speechAvailable(): boolean {
  return typeof (globalThis as any).webkitSpeechRecognition === "function" || typeof (globalThis as any).SpeechRecognition === "function";
}

export async function micPermission(): Promise<PermissionState | "unknown"> {
  try { return (await navigator.permissions.query({ name: "microphone" as PermissionName })).state; } catch { return "unknown"; }
}

export interface Listener { stop: () => void; abort: () => void }

/** Starts listening; `onPartial` gets the live transcript, `onFinal` the finished one ("" if nothing was heard). */
export function listen(opts: { lang?: string; onPartial: (t: string) => void; onFinal: (t: string) => void; onError: (e: string) => void; silenceMs?: number }): Listener {
  const Ctor = (globalThis as any).SpeechRecognition ?? (globalThis as any).webkitSpeechRecognition;
  const rec: Rec = new Ctor();
  rec.lang = opts.lang ?? navigator.language ?? "en-US";
  rec.interimResults = true;
  rec.continuous = true;
  let finalText = "";
  let interim = "";
  let ended = false;
  let silence: ReturnType<typeof setTimeout> | undefined;
  const arm = () => { clearTimeout(silence); if (opts.silenceMs) silence = setTimeout(() => rec.stop(), opts.silenceMs); };
  rec.onresult = (e: any) => {
    interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    opts.onPartial((finalText + " " + interim).trim());
    arm();
  };
  rec.onerror = (e: any) => {
    if (e.error === "no-speech" || e.error === "aborted") return;
    opts.onError(e.error === "not-allowed" ? "Microphone blocked: open Wisp settings and allow the microphone." : `Speech recognition: ${e.error}`);
  };
  rec.onend = () => { if (ended) return; ended = true; clearTimeout(silence); opts.onFinal((finalText + " " + interim).trim()); };
  rec.start();
  arm();
  return { stop: () => rec.stop(), abort: () => { ended = true; rec.abort(); } };
}
