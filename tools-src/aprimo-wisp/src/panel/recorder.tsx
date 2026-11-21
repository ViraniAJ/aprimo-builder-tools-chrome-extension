// "Teach Wisp a feature": record the screen with narration while Wisp notes every click on the Aprimo page, then
// transcribe the narration on this computer (Whisper) and save transcript + clicks + video as knowledge Wisp searches.
// This adds to Wisp's knowledge index; it does not retrain a model.
import { useEffect, useRef, useState } from "react";
import { activeTab, isAprimoUrl, toTab } from "../core/turn";
import { addDocs } from "../kb/kb-client";
import { putMedia } from "../kb/media";
import type { KnowledgeDoc, RecipeStep, TranscriptSegment } from "../kb/types";
import { transcribe } from "../voice/transcribe";
import type { AgentEvent } from "../shared/messages";
import { Button, Progress, Toggle, inputCls } from "../ui/components";

type Phase = "idle" | "recording" | "transcribing" | "review" | "saved";

export function Recorder() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [title, setTitle] = useState("");
  const [useMic, setUseMic] = useState(true);
  const [steps, setSteps] = useState<RecipeStep[]>([]);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [transcriptText, setTranscriptText] = useState("");
  const [progress, setProgress] = useState<{ label: string; value: number } | null>(null);
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const rec = useRef<{ mr: MediaRecorder; streams: MediaStream[]; chunks: Blob[]; start: number; tabId?: number; ctx?: AudioContext } | null>(null);
  const blob = useRef<Blob | null>(null);

  useEffect(() => {
    const onMsg = (m: AgentEvent) => {
      if (m?.kind !== "wisp-event" || m.op !== "recorded-action" || !rec.current) return;
      setSteps((s) => [...s, { at: Math.round((Date.now() - rec.current!.start) / 100) / 10, route: m.route, action: m.action, target: m.target && { role: m.target.role, text: m.target.text, aria: m.target.aria, auto: m.target.auto } }]);
    };
    chrome.runtime.onMessage.addListener(onMsg);
    return () => chrome.runtime.onMessage.removeListener(onMsg);
  }, []);
  useEffect(() => {
    if (phase !== "recording") return;
    const t = setInterval(() => setElapsed(Math.round((Date.now() - (rec.current?.start ?? Date.now())) / 1000)), 500);
    return () => clearInterval(t);
  }, [phase]);

  const start = async () => {
    setError("");
    setSteps([]);
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: true });
      const streams = [screen];
      const ctx = new AudioContext();
      const dest = ctx.createMediaStreamDestination();
      if (screen.getAudioTracks().length) ctx.createMediaStreamSource(new MediaStream(screen.getAudioTracks())).connect(dest);
      if (useMic) {
        try {
          const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
          streams.push(mic);
          ctx.createMediaStreamSource(mic).connect(dest);
        } catch {
          setError("The microphone isn't allowed yet, so only the screen's own sound is recorded. Use “Allow the microphone” on the Ask tab.");
        }
      }
      const mixed = new MediaStream([...screen.getVideoTracks(), ...dest.stream.getAudioTracks()]);
      const mime = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "video/webm";
      const mr = new MediaRecorder(mixed, { mimeType: mime, videoBitsPerSecond: 1_500_000 });
      const chunks: Blob[] = [];
      mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      mr.onstop = () => finish(new Blob(chunks, { type: mime.split(";")[0] }));
      screen.getVideoTracks()[0].addEventListener("ended", () => stop());
      const tab = await activeTab();
      rec.current = { mr, streams, chunks, start: Date.now(), tabId: tab?.id, ctx };
      if (tab?.id && isAprimoUrl(tab.url)) {
        const r = await toTab(tab.id, { kind: "wisp", op: "record-start" }).catch(() => null);
        if (r?.title && !title) setTitle(r.title.replace(/\s*[|·-]\s*Aprimo.*$/i, ""));
      }
      mr.start(1000);
      setElapsed(0);
      setPhase("recording");
    } catch (e) {
      if ((e as Error).name !== "NotAllowedError") setError((e as Error).message);
    }
  };

  const stop = () => {
    const r = rec.current;
    if (!r || r.mr.state === "inactive") return;
    r.mr.stop();
    r.streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    r.ctx?.close().catch(() => {});
    if (r.tabId) toTab(r.tabId, { kind: "wisp", op: "record-stop" }).catch(() => {});
  };

  const finish = async (b: Blob) => {
    blob.current = b;
    rec.current = null;
    setPhase("transcribing");
    setProgress({ label: "Getting the speech model ready (first time only)…", value: 0 });
    try {
      const res = await transcribe(b, (p) => {
        if (p.status === "progress" && p.progress !== undefined) setProgress({ label: `Downloading the speech model… ${p.file ?? ""}`, value: p.progress / 100 });
        else if (p.status === "transcribing") setProgress({ label: "Transcribing on this computer…", value: 0.95 });
      });
      setSegments(res.segments);
      setTranscriptText(res.text.trim());
    } catch (e) {
      setError(`Transcription failed: ${(e as Error).message}. You can still type what the recording shows and save it.`);
    }
    setProgress(null);
    setPhase("review");
  };

  const save = async () => {
    if (!blob.current) return;
    const id = crypto.randomUUID();
    const name = title.trim() || "Recorded walkthrough";
    setProgress({ label: "Saving…", value: 0.2 });
    try {
      await putMedia(id, blob.current, { title: name, mime: blob.current.type });
      // An edited transcript replaces the timed one (kept as a single segment).
      const edited = transcriptText.trim() !== segments.map((s) => s.text).join(" ").trim();
      const segs = edited || !segments.length ? [{ start: 0, end: blob.current.size ? elapsed : 0, text: transcriptText.trim() }] : segments;
      const doc: KnowledgeDoc = {
        id: `recording:${id}`, source: "recording", title: name, url: `wisp-media:${id}`,
        text: transcriptText.trim(), video: { url: `wisp-media:${id}`, segments: segs }, recipe: steps, addedAt: Date.now(),
      };
      await addDocs([doc], (p) => setProgress({ label: "Adding to Wspr's knowledge…", value: 0.2 + 0.8 * (p.done / Math.max(1, p.total)) }));
      setPhase("saved");
    } catch (e) {
      setError((e as Error).message);
    }
    setProgress(null);
  };

  const reset = () => { setPhase("idle"); setTitle(""); setSteps([]); setSegments([]); setTranscriptText(""); setError(""); blob.current = null; };

  return (
    <div className="flex-1 space-y-3 overflow-y-auto p-3 text-sm">
      <div>
        <div className="font-semibold">Teach Wspr a feature</div>
        <p className="text-xs text-muted">Record yourself doing it in Aprimo and talk it through. Wspr transcribes the narration on this computer, notes each click, and keeps the video so it can point people to it later. Nothing is uploaded.</p>
      </div>
      {error && <div className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">{error}</div>}

      {phase === "idle" && (
        <>
          <input className={inputCls} placeholder="What are you showing? e.g. Creating a classification" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Toggle checked={useMic} onChange={setUseMic} label="Record my narration" help="Mixes your microphone with the screen's sound." />
          <Button kind="primary" onClick={start}>● Start recording</Button>
          <p className="text-xs text-muted">Choose the Aprimo tab when Chrome asks what to share. Clicks are noted only on Aprimo pages.</p>
        </>
      )}

      {phase === "recording" && (
        <div className="space-y-2">
          <div className="flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-danger wisp-pulse" /> Recording · {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")} · {steps.length} click{steps.length === 1 ? "" : "s"} noted</div>
          <Button kind="danger" onClick={stop}>■ Stop</Button>
          <Steps steps={steps} />
        </div>
      )}

      {phase === "transcribing" && progress && <div className="space-y-1"><div className="text-xs">{progress.label}</div><Progress value={progress.value} /></div>}

      {phase === "review" && (
        <div className="space-y-2">
          <input className={inputCls} value={title} placeholder="Title" onChange={(e) => setTitle(e.target.value)} />
          {blob.current && <video className="w-full rounded-lg border border-line" src={URL.createObjectURL(blob.current)} controls />}
          <div className="text-xs font-semibold">What you said</div>
          <textarea className={inputCls + " min-h-32"} value={transcriptText} onChange={(e) => setTranscriptText(e.target.value)} placeholder="Type what the recording shows if there's no narration." />
          <div className="text-xs font-semibold">Clicks Wspr noted ({steps.length})</div>
          <Steps steps={steps} onRemove={(i) => setSteps((s) => s.filter((_, j) => j !== i))} />
          {progress && <Progress value={progress.value} />}
          <div className="flex gap-2"><Button kind="primary" onClick={save} disabled={!transcriptText.trim() && !steps.length}>Save to Wspr's knowledge</Button><Button kind="ghost" onClick={reset}>Discard</Button></div>
        </div>
      )}

      {phase === "saved" && (
        <div className="space-y-2">
          <div className="rounded-lg border border-ok/40 bg-ok/5 px-3 py-2 text-xs">Saved. Wspr will use “{title || "Recorded walkthrough"}” when someone asks about it, and can offer the video.</div>
          <Button onClick={reset}>Record another</Button>
        </div>
      )}
    </div>
  );
}

function Steps({ steps, onRemove }: { steps: RecipeStep[]; onRemove?: (i: number) => void }) {
  if (!steps.length) return null;
  return (
    <ol className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-line bg-card p-2 text-xs">
      {steps.map((s, i) => (
        <li key={i} className="flex gap-2">
          <span className="w-10 shrink-0 tabular-nums text-muted">{Math.floor(s.at / 60)}:{String(Math.floor(s.at % 60)).padStart(2, "0")}</span>
          <span className="flex-1">{s.action} {s.target ? `${s.target.role} “${s.target.text || s.target.aria || ""}”` : s.route}</span>
          {onRemove && <button className="text-muted hover:text-danger" title="Remove" onClick={() => onRemove(i)}>×</button>}
        </li>
      ))}
    </ol>
  );
}
