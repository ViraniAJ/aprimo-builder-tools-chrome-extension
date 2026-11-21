// Aprimo Wisp side panel: ask by voice or text, hear and read the answer, see sources and demos, follow along
// step by step, and teach Wisp a feature by recording it.
import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { PROVIDERS, modelInfo } from "../core/catalog";
import { Controller, type ChatEntry } from "../core/controller";
import { loadSettings, onSettingsChanged, type WispSettings } from "../core/settings";
import { activeTab, isAprimoUrl, toTab } from "../core/turn";
import { initKB } from "../kb/kb-client";
import { videoLink } from "../kb/transcript";
import { listen, micPermission, speechAvailable, type Listener } from "../voice/stt";
import { stopSpeaking } from "../voice/tts";
import { Button, WispMark, cx } from "../ui/components";
import { Intro, introReduced } from "./intro";
import { Recorder } from "./recorder";

// Settings open inside Aprimo (Administration › Aprimo Wspr Settings) in the Aprimo tab of this window; a section
// such as "#ai" goes straight to that tab of the settings. Without an Aprimo tab, they open as a page of their own.
const isAprimoShell = (u?: string) => !!u && /^https:\/\/[^/]+\.aprimo\.com\//i.test(u) && !/^https:\/\/[^/]+\.dam\.aprimo\.com\//i.test(u);
const openSettings = async (hash = "") => {
  const section = hash.replace(/^#/, "");
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = isAprimoShell(active?.url) ? active : (await chrome.tabs.query({ currentWindow: true, url: "https://*.aprimo.com/*" })).find((t) => isAprimoShell(t.url));
  if (!tab?.id || !tab.url) { chrome.tabs.create({ url: chrome.runtime.getURL(`app/wisp/settings.html${hash}`) }); return; }
  const u = new URL(tab.url);
  await chrome.tabs.update(tab.id, { active: true, url: `${u.origin}${u.pathname}#/management/home?arm=wisp${section ? `&section=${section}` : ""}` });
};
const sourceLabel: Record<string, string> = { dev: "Developer docs", help: "Aprimo Help", user: "Your articles", crawl: "Your sites", file: "Your files", recording: "Your recording", video: "Video demo" };

function App() {
  const [settings, setSettings] = useState<WispSettings | null>(null);
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [status, setStatus] = useState("");
  const [caption, setCaption] = useState("");
  const [guide, setGuide] = useState<{ active: boolean; text?: string }>({ active: false });
  const [listening, setListening] = useState(false);
  const [partial, setPartial] = useState("");
  const [text, setText] = useState("");
  const [tab, setTab] = useState<"ask" | "teach">("ask");
  const [micError, setMicError] = useState("");
  const [onAprimo, setOnAprimo] = useState(true);
  const [intro, setIntro] = useState(false);
  const introOn = useRef(false);
  const bootAt = useRef(Date.now());
  const ctrl = useRef<Controller | null>(null);
  const listener = useRef<Listener | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let off = () => {};
    loadSettings().then((s) => {
      setSettings(s);
      ctrl.current = new Controller(s, {
        entry: (e) => setEntries((all) => { const i = all.findIndex((x) => x.id === e.id); if (i < 0) return [...all, e].slice(-60); const n = [...all]; n[i] = e; return n; }),
        status: setStatus,
        caption: setCaption,
        guide: (active, t) => setGuide({ active, text: t }),
        settings: setSettings,
        reset: () => { setEntries([]); setCaption(""); setGuide({ active: false }); },
      });
      off = onSettingsChanged(async () => { const n = await loadSettings(); setSettings(n); ctrl.current?.setSettings(n); });
      // Opened by the header button or the shortcut a moment ago: play the intro, then start listening.
      chrome.storage.session.get("wisp.talkAt").then((r) => {
        if (Date.now() - Number(r["wisp.talkAt"] ?? 0) >= 4000) return;
        chrome.storage.session.remove("wisp.talkAt");
        if (introReduced(s.reduceMotion)) startListen();
        else { introOn.current = true; setIntro(true); }
      });
    });
    initKB().catch((e) => console.warn("[wisp] knowledge index:", e));
    const checkTab = async () => setOnAprimo(isAprimoUrl((await activeTab())?.url));
    checkTab();
    chrome.tabs.onActivated.addListener(checkTab);
    chrome.tabs.onUpdated.addListener(checkTab);
    // The keyboard shortcut (Alt+Shift+Space) arrives from the service worker: press to start, press again to stop.
    // Right after the panel opens, that same request also arrives here; it's handled by the start-up check above
    // (intro, then listening), so don't let it toggle listening back off.
    const onMsg = (m: any) => {
      if (m?.kind !== "wisp-talk" || introOn.current) return;
      if (Date.now() - bootAt.current < 2000) startListen(); else toggleListen();
    };
    chrome.runtime.onMessage.addListener(onMsg);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") stopAll(); };
    addEventListener("keydown", onKey);
    return () => { off(); chrome.runtime.onMessage.removeListener(onMsg); removeEventListener("keydown", onKey); chrome.tabs.onActivated.removeListener(checkTab); chrome.tabs.onUpdated.removeListener(checkTab); };
  }, []);

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [entries, partial]);

  const stopAll = () => { listener.current?.abort(); listener.current = null; setListening(false); ctrl.current?.stop(); stopSpeaking(); };

  const startListen = async () => {
    if (listener.current) return;
    setMicError("");
    if (!speechAvailable()) { setMicError("Speech recognition isn't available in this browser. Type your question instead."); return; }
    if ((await micPermission()) !== "granted") { setMicError("Wspr needs the microphone once."); return; }
    stopSpeaking();
    ctrl.current?.earcon("start");
    setListening(true);
    setPartial("");
    listener.current = listen({
      silenceMs: 2500,
      onPartial: setPartial,
      onFinal: (t) => { listener.current = null; setListening(false); setPartial(""); ctrl.current?.earcon("stop"); ctrl.current?.ask(t, false); },
      onError: (e) => { listener.current = null; setListening(false); setMicError(e); },
    });
  };
  const stopListen = () => listener.current?.stop();
  const toggleListen = () => (listener.current ? stopListen() : startListen());

  const send = () => {
    const q = text.trim();
    if (!q) return;
    setText("");
    ctrl.current?.ask(q, true);
  };

  if (!settings) return <div className="p-4 text-muted">Loading…</div>;
  const p = PROVIDERS[settings.provider];
  const modelName = settings.provider === "nvidia-nim" && settings.smartRouting ? "Smart routing" : modelInfo(settings.providers[settings.provider].model).displayName;

  const introDone = () => { introOn.current = false; setIntro(false); startListen(); };

  return (
    <div className="flex h-screen flex-col">
      {intro && <Intro onDone={introDone} />}
      <header className="flex h-14 items-center gap-2 border-b border-line bg-white px-3">
        <WispMark />
        <div className="min-w-0 flex-1">
          <div className="text-[16px] font-medium leading-tight">Aprimo Wspr</div>
          <button className="truncate text-xs text-muted hover:text-fg" title="Change the AI" onClick={() => openSettings("#ai")}>{p.displayName} · {modelName}</button>
        </div>
        <div className="flex self-stretch">
          {(["ask", "teach"] as const).map((t) => <button key={t} onClick={() => setTab(t)} className={cx("wisp-label border-b-2 px-3 !text-[13px]", tab === t ? "border-primary text-primary" : "border-transparent text-muted hover:text-fg")}>{t === "ask" ? "Ask" : "Teach"}</button>)}
        </div>
        {entries.length > 0 && (
          <button title="New chat (Wspr forgets this conversation)" aria-label="New chat" onClick={() => ctrl.current?.newChat()} className="flex h-9 w-9 items-center justify-center rounded-full text-black/60 hover:bg-black/[.04]">
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2Zm0 14H5.2L4 17.2V4h16v12Zm-9-1h2v-3h3v-2h-3V7h-2v3H8v2h3v3Z"/></svg>
          </button>
        )}
        <button title="Settings" onClick={() => openSettings()} className="flex h-9 w-9 items-center justify-center rounded-full text-black/60 hover:bg-black/[.04]">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M19.14 12.94a7.5 7.5 0 0 0 .05-.94 7.5 7.5 0 0 0-.05-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7 7 0 0 0-1.62-.94l-.36-2.54A.5.5 0 0 0 13.9 2h-3.8a.5.5 0 0 0-.49.42l-.36 2.54a7 7 0 0 0-1.62.94l-2.39-.96a.5.5 0 0 0-.6.22L2.72 8.48a.5.5 0 0 0 .12.64l2.03 1.58a7.5 7.5 0 0 0 0 1.88l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.5.38 1.04.7 1.62.94l.36 2.54a.5.5 0 0 0 .49.42h3.8a.5.5 0 0 0 .49-.42l.36-2.54a7 7 0 0 0 1.62-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/></svg>
        </button>
      </header>

      {!settings.privacyAccepted && settings.provider !== "local" && (
        <div className="m-3 rounded-lg bg-[rgb(229,246,253)] p-3 text-sm text-[rgb(1,67,97)]">
          <div className="font-medium">Before you start</div>
          <p className="mt-1">When you ask, Wspr sends your question, a screenshot of the Aprimo tab and its list of controls to {p.displayName}. Nothing is stored by Wspr outside your browser.</p>
          <div className="mt-2"><Button kind="primary" onClick={() => openSettings("#welcome")}>Set up Wspr</Button></div>
        </div>
      )}

      {tab === "teach" ? <Recorder /> : (
        <>
          <main className="flex-1 space-y-3 overflow-y-auto bg-page px-3 py-3">
            {!entries.length && <Empty onAprimo={onAprimo} onAsk={(q) => ctrl.current?.ask(q, true)} />}
            {entries.map((e) => <Entry key={e.id} e={e} />)}
            {listening && <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-soft px-3 py-2 text-sm italic text-muted">{partial || "Listening…"}</div>}
            <div ref={bottom} />
          </main>

          {guide.active && (
            <div className="mx-3 mb-2 flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-xs">
              <span className="h-2 w-2 shrink-0 rounded-full bg-primary wisp-pulse" />
              <span className="flex-1">Watching you do the step. Click where Wspr points; it shows the next one.</span>
              <Button small onClick={() => ctrl.current?.ask("what's the next step", true)}>Next</Button>
              <Button small kind="ghost" onClick={() => ctrl.current?.endGuide()}>Stop</Button>
            </div>
          )}
          {(status || caption) && <div className="truncate px-4 pb-1 text-xs text-muted">{status || caption}</div>}
          {micError && (
            <div className="mx-3 mb-2 rounded-lg bg-[rgb(253,237,237)] px-3 py-2 text-xs text-[rgb(95,33,32)]">
              {micError}{" "}
              {/microphone/i.test(micError) && <button className="underline" onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL("app/wisp/mic-permission.html") })}>Allow the microphone</button>}
            </div>
          )}

          <footer className="border-t border-line bg-white p-2">
            <div className="flex items-end gap-2">
              <button
                title="Hold to talk (or press Alt+Shift+Space)"
                onPointerDown={(ev) => { ev.preventDefault(); startListen(); }}
                onPointerUp={stopListen}
                onPointerLeave={() => listening && stopListen()}
                className={cx("flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white shadow", listening ? "bg-danger wisp-pulse" : "wisp-gradient")}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
              </button>
              <textarea rows={1} value={text} placeholder="Ask about this Aprimo page…" onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                className="max-h-32 min-h-10 flex-1 resize-none rounded-lg border border-black/[.23] bg-white px-3 py-2 text-sm outline-none hover:border-black/90 focus:border-primary focus:shadow-[inset_0_0_0_1px_var(--w-primary)]" />
              {status ? <Button onClick={stopAll}>Stop</Button> : <Button kind="primary" onClick={send} disabled={!text.trim()}>Ask</Button>}
            </div>
            <div className="mt-1 px-1 text-[11px] text-muted">Hold the mic or press Alt+Shift+Space. Esc stops.</div>
          </footer>
        </>
      )}
    </div>
  );
}

function Empty({ onAprimo, onAsk }: { onAprimo: boolean; onAsk: (q: string) => void }) {
  const examples = onAprimo
    ? ["How do I create a classification?", "What does this page do?", "How do I add a field to a record?", "What can you do?"]
    : ["What is a content type in Aprimo?", "How do I authenticate with the Aprimo API?", "What can you do?"];
  return (
    <div className="mt-6 text-center">
      <div className="wisp-tile mx-auto mb-3 h-12 w-12"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg></div>
      <div className="text-[18px] font-medium">Ask anything about Aprimo</div>
      <p className="mx-auto mt-1 max-w-xs text-xs text-muted">{onAprimo ? "Wspr sees this Aprimo page and points to the right spot." : "Open an Aprimo tab and Wspr can point at things on the page too."}</p>
      <div className="mt-4 flex flex-col items-center gap-2">
        {examples.map((q) => <button key={q} onClick={() => onAsk(q)} className="rounded-full border border-primary/50 bg-white px-3 py-1 text-[13px] text-primary hover:bg-soft">{q}</button>)}
      </div>
    </div>
  );
}

function Entry({ e }: { e: ChatEntry }) {
  const r = e.result ?? {};
  const cited = useMemo(() => (r.notes ?? []).filter((n) => (r.cited ?? []).includes(n.id)), [r.notes, r.cited]);
  const shown = (e.say || "").replace(/\s*\[k\d+(?:\s*,\s*k\d+)*\]/gi, "");
  const go = async (route: string) => {
    if (!confirm(`Open ${route} in this Aprimo tab?`)) return;
    const t = await activeTab();
    if (t?.id) toTab(t.id, { kind: "wisp", op: "navigate", route }).catch(() => {});
  };
  return (
    <div className="space-y-1.5">
      {e.kind !== "guide" && <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-white">{e.question}</div>}
      <div className={cx("max-w-[95%] rounded-lg border border-line bg-white px-3 py-2 text-sm", r.error && "border-danger/40")}>
        {e.kind === "guide" && <div className="wisp-label mb-1 !text-[11px] text-primary">Next step</div>}
        {shown ? <div className="whitespace-pre-wrap">{shown}</div> : <div className="text-muted">{e.status || "…"}</div>}
        {e.card && (
          <div className="mt-2 rounded-lg border border-line bg-page p-2">
            <div className="mb-1 text-xs font-medium">{e.card.title}</div>
            {e.card.lines.map((l, i) => <div key={i} className="text-xs">{/^[•\-]/.test(l) || e.card!.lines.length < 2 ? l : `• ${l}`}</div>)}
          </div>
        )}
        {e.image && <img src={e.image} alt="A closer look" className="mt-2 w-full rounded-lg border border-line" />}
        {!!r.steps?.length && (
          <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-xs">{r.steps.map((s) => <li key={s.index}>{s.text}</li>)}</ol>
        )}
        {!!r.videos?.length && (
          <div className="mt-2 space-y-1">
            {r.videos.map((v, i) => {
              const note = r.notes?.find((n) => n.id === v.id);
              if (!note?.video) return null;
              return <a key={i} href={videoLink(note.video.url, v.at ?? note.video.start ?? 0)} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-xs">▶ {v.label || note.title}{v.at ? ` (${Math.floor(v.at / 60)}:${String(Math.floor(v.at % 60)).padStart(2, "0")})` : ""}</a>;
            })}
          </div>
        )}
        {r.nav && <div className="mt-2"><Button small onClick={() => go(r.nav!)}>Open that page</Button></div>}
        {!!cited.length && (
          <div className="mt-2 flex flex-wrap gap-1">
            {cited.map((n) => (
              <a key={n.id} href={n.video ? videoLink(n.video.url, n.video.start ?? 0) : n.url} target="_blank" rel="noreferrer" title={n.title}
                className="max-w-full truncate rounded-full bg-black/[.08] px-2.5 py-0.5 text-[12px] text-fg no-underline hover:bg-black/[.12]">
                <span className="text-muted">{sourceLabel[n.source] ?? n.source}:</span> {n.title.split(" > ").slice(-1)[0]}
              </a>
            ))}
          </div>
        )}
        {e.done && r.raw !== undefined && (
          <details className="mt-1.5 text-[11px] text-muted">
            <summary className="cursor-pointer select-none">Details</summary>
            <div className="mt-1">Topic: {r.topic || "–"} · Pointed: {r.pointed ? `yes${r.firstLabel ? ` (${r.firstLabel})` : ""}` : "no"}{r.stepsMore !== undefined ? ` · Steps: ${r.stepsMore ? "more" : "done"}` : ""}{r.pageTitle ? ` · Page: ${r.pageTitle}` : " · Not on an Aprimo page"}{r.shot ? " · Screenshot sent" : " · No screenshot"}</div>
            {r.pointNotes?.map((n) => <div key={n} className="mt-0.5 text-[#b26a00]">{n}</div>)}
            <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-page p-2 font-mono text-[11px] text-fg">{r.raw || "(empty reply)"}</pre>
          </details>
        )}
        {e.done && r.model && <div className="mt-1.5 text-[10px] text-muted">{r.provider === "local" ? "Offline model" : modelInfo(r.model).displayName}{r.firstTokenMs ? ` · ${(r.firstTokenMs / 1000).toFixed(1)} s to first words` : ""}</div>}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
