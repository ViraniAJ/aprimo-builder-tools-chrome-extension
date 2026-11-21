// Wisp Check-up: everything Wisp needs, with a fix for each, and a copyable report.
import { useEffect, useState } from "react";
import { PROVIDERS } from "../core/catalog";
import { loadNotes } from "../core/helpers";
import type { WispSettings } from "../core/settings";
import { kbStats } from "../kb/kb-client";
import { testConnection } from "../providers";
import { gpuSummary } from "../providers/gpu";
import { micPermission, speechAvailable } from "../voice/stt";
import { Button, Section, cx } from "../ui/components";

type Row = { title: string; level: "ok" | "problem" | "optional" | "checking"; text: string; fix?: { label: string; run: () => void } };

export function Checkup({ s, goTo }: { s: WispSettings; goTo: (tab: string) => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    const out: Row[] = [];
    const push = (r: Row) => { out.push(r); setRows([...out]); };
    const mic = await micPermission();
    push(mic === "granted" ? { title: "Microphone", level: "ok", text: "Allowed." } : { title: "Microphone", level: "problem", text: "Off. Wspr can't hear your question (you can still type).", fix: { label: "Fix…", run: () => chrome.tabs.create({ url: chrome.runtime.getURL("app/wisp/mic-permission.html") }) } });
    push(speechAvailable() ? { title: "Understanding speech", level: "ok", text: "Ready (Chrome's speech recognition)." } : { title: "Understanding speech", level: "problem", text: "This browser has no speech recognition. Type your questions." });
    const voices = await new Promise<number>((r) => chrome.tts.getVoices((v) => r(v?.length ?? 0)));
    push(voices ? { title: "Wspr's voice", level: "ok", text: `${voices} voices available.` } : { title: "Wspr's voice", level: "optional", text: "No voices found; answers appear as captions." });
    const cmds = await chrome.commands.getAll();
    const talk = cmds.find((c) => c.name === "wisp-talk");
    push(talk?.shortcut ? { title: "Shortcut", level: "ok", text: `Press ${talk.shortcut} to ask.` } : { title: "Shortcut", level: "optional", text: "No keyboard shortcut set.", fix: { label: "Set…", run: () => chrome.tabs.create({ url: "chrome://extensions/shortcuts" }) } });
    const tabs = await chrome.tabs.query({ url: "https://*.aprimo.com/*" });
    push(tabs.length ? { title: "Seeing the page", level: "ok", text: `${tabs.length} Aprimo tab${tabs.length === 1 ? "" : "s"} open; Wspr reads the one you're on.` } : { title: "Seeing the page", level: "optional", text: "No Aprimo tab open right now." });
    if (s.provider === "local") push({ title: "AI service (offline model)", level: s.localModelInstalled ? "ok" : "problem", text: s.localModelInstalled ? "Downloaded and ready." : "Not downloaded yet.", fix: s.localModelInstalled ? undefined : { label: "Download…", run: () => goTo("ai") } });
    else {
      push({ title: `AI service (${PROVIDERS[s.provider].displayName})`, level: "checking", text: "Checking the connection…" });
      const t = await testConnection(s);
      out.pop();
      push({ title: `AI service (${PROVIDERS[s.provider].displayName})`, level: t.ok ? "ok" : "problem", text: t.message, fix: t.ok ? undefined : { label: "Connect…", run: () => goTo("ai") } });
      if (!s.privacyAccepted) push({ title: "Cloud AI allowed", level: "problem", text: "You haven't confirmed what leaves your computer yet.", fix: { label: "Review…", run: () => goTo("privacy") } });
    }
    push(s.readPageControls ? { title: "Better answers", level: "ok", text: "On: Wspr reads the page's buttons, fields and selected text." } : { title: "Better answers", level: "optional", text: "Off (optional). Turn it on for more accurate pointing.", fix: { label: "Turn on…", run: () => goTo("general") } });
    try { const k = await kbStats(); push({ title: "Knowledge", level: "ok", text: `${k.bundled.count.toLocaleString()} built-in passages, ${k.user.toLocaleString()} of yours.` }); }
    catch (e) { push({ title: "Knowledge", level: "problem", text: `The knowledge index didn't load: ${(e as Error).message}` }); }
    const gpu = await gpuSummary();
    push(gpu.ok ? { title: "Offline model", level: s.localModelInstalled ? "ok" : "optional", text: s.localModelInstalled ? "Downloaded; used when the cloud can't answer." : "Available to download (optional)." } : { title: "Offline model", level: "optional", text: `Not available: ${gpu.reason}` });
    const notes = (await loadNotes()).length;
    push({ title: "Privacy", level: "ok", text: `${s.sendScreenshots ? "Screenshots on" : "Screenshots off"} · ${s.keepHistory ? "History saved in this browser" : "History kept until the browser closes"} · ${notes ? `${notes} note${notes === 1 ? "" : "s"}` : "no notes"}.` });
    setRunning(false);
  };
  useEffect(() => { run(); }, []);

  const problems = rows.filter((r) => r.level === "problem").length;
  const report = () => [`Aprimo Wspr ${chrome.runtime.getManifest().version}`, `Provider: ${s.provider}, model: ${s.providers[s.provider].model}${s.smartRouting ? " (smart routing)" : ""}`, ...rows.map((r) => `${r.level === "ok" ? "OK" : r.level === "problem" ? "PROBLEM" : "Optional"}: ${r.title}: ${r.text}`)].join("\n");

  return (
    <Section title="Check-up" right={<div className="flex gap-2"><Button small onClick={() => navigator.clipboard.writeText(report())}>Copy report</Button><Button small disabled={running} onClick={run}>Check again</Button></div>}>
      <div className="mb-3 font-medium">{running ? "Checking…" : problems ? `${problems} thing${problems === 1 ? "" : "s"} to fix.` : "Everything Wspr needs is working."}</div>
      <div className="divide-y divide-line">
        {rows.map((r, i) => (
          <div key={i} className="flex items-start gap-3 py-2">
            <span className={cx("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", r.level === "ok" ? "bg-ok" : r.level === "problem" ? "bg-danger" : r.level === "checking" ? "bg-primary wisp-pulse" : "bg-line")} />
            <div className="flex-1"><div className="text-sm font-medium">{r.title}</div><div className="text-xs text-muted">{r.text}</div></div>
            {r.fix && <Button small onClick={r.fix.run}>{r.fix.label}</Button>}
          </div>
        ))}
      </div>
    </Section>
  );
}
