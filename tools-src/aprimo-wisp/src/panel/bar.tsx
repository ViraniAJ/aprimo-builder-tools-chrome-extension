// The on-page Wspr bar (Settings › General › Where Wspr opens: On the page). A small card at the bottom of the Aprimo
// page, like Siri: it glows while listening and thinking, shows what it heard and then the answer, keeps the
// walkthrough's Next / Stop while it watches, and tucks itself away after a quiet spell. It runs the same controller
// as the side panel; agent/bar.ts places it in a transparent frame and sizes the frame to this card.
import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { PROVIDERS } from "../core/catalog";
import { Controller, type ChatEntry } from "../core/controller";
import { loadSettings, onSettingsChanged, type WispSettings } from "../core/settings";
import { activeTab, toTab } from "../core/turn";
import { initKB } from "../kb/kb-client";
import { videoLink } from "../kb/transcript";
import { listen, speechAvailable, type Listener } from "../voice/stt";
import { stopSpeaking } from "../voice/tts";
import { cx } from "../ui/components";
import { Entry, openSettings, sourceLabel } from "./shared";
import { TalkRing, VoiceGlow, useMicStream, useSpeaking, voiceState } from "../ui/voice";

const toPage = (msg: Record<string, unknown>) => parent.postMessage({ wspr: true, ...msg }, "*");
const HIDE_AFTER_MS = 15_000;

function Bar() {
  const [settings, setSettings] = useState<WispSettings | null>(null);
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [status, setStatus] = useState("");
  const [guide, setGuide] = useState<{ active: boolean; text?: string }>({ active: false });
  const [listening, setListening] = useState(false);
  const [partial, setPartial] = useState("");
  const [text, setText] = useState("");
  const [micError, setMicError] = useState("");
  const [history, setHistory] = useState(false);
  const [menu, setMenu] = useState(false);
  const ctrl = useRef<Controller | null>(null);
  const listener = useRef<Listener | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const hover = useRef(false);
  const idle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // The frame follows the card's height.
  useEffect(() => {
    const el = card.current;
    if (!el) return;
    const ro = new ResizeObserver(() => toPage({ type: "size", height: el.getBoundingClientRect().height + 72 }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [settings]);

  useEffect(() => {
    loadSettings().then(async (s) => {
      setSettings(s);
      ctrl.current = new Controller(s, {
        entry: (e) => setEntries((all) => { const i = all.findIndex((x) => x.id === e.id); if (i < 0) return [...all, e].slice(-40); const n = [...all]; n[i] = e; return n; }),
        status: setStatus,
        caption: () => {},
        guide: (active, t) => setGuide({ active, text: t }),
        settings: setSettings,
        reset: () => { setEntries([]); setGuide({ active: false }); setHistory(false); },
      });
      onSettingsChanged(async () => { const n = await loadSettings(); setSettings(n); ctrl.current?.setSettings(n); });
      const tab = await chrome.tabs.getCurrent?.().catch(() => undefined);
      void ctrl.current.resumeSavedGuide(tab?.id);
      toPage({ type: "ready" });
    });
    initKB().catch((e) => console.warn("[wisp] knowledge index:", e));
    const onMsg = (e: MessageEvent) => {
      if (e.source !== parent || !e.data?.wspr) return;
      const t = e.data.type;
      if (t === "show") { if (e.data.talk) startListen(); else input.current?.focus(); }
      if (t === "toggle-talk") toggleListen();
      if (t === "focus") input.current?.focus();
      if (t === "hidden") { listener.current?.abort(); listener.current = null; setListening(false); setMenu(false); }
    };
    addEventListener("message", onMsg);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { if (listener.current || ctrl.current?.guiding || status) stopAll(); else toPage({ type: "hide" }); } };
    addEventListener("keydown", onKey);
    return () => { removeEventListener("message", onMsg); removeEventListener("keydown", onKey); };
  }, []);

  // Tuck away after a quiet spell (not while listening, thinking, watching a step, typing, or under the mouse).
  useEffect(() => {
    clearTimeout(idle.current);
    if (listening || status || guide.active || text || menu || history) return;
    idle.current = setTimeout(function check() {
      if (hover.current || document.activeElement === input.current || window.speechSynthesis?.speaking) { idle.current = setTimeout(check, 3000); return; }
      chrome.tts.isSpeaking((speaking) => { if (speaking) idle.current = setTimeout(check, 3000); else toPage({ type: "hide" }); });
    }, HIDE_AFTER_MS);
    return () => clearTimeout(idle.current);
  }, [listening, status, guide.active, text, menu, history, entries]);

  const stopAll = () => { listener.current?.abort(); listener.current = null; setListening(false); ctrl.current?.stop(); stopSpeaking(); };

  const startListen = () => {
    if (listener.current) return;
    setMicError("");
    if (!speechAvailable()) { setMicError("Speech recognition isn't available in this browser. Type your question instead."); return; }
    stopSpeaking();
    ctrl.current?.earcon("start");
    setListening(true);
    setPartial("");
    listener.current = listen({
      silenceMs: 2500,
      onPartial: setPartial,
      onFinal: (t) => { listener.current = null; setListening(false); setPartial(""); ctrl.current?.earcon("stop"); ctrl.current?.ask(t, false); },
      onError: (e) => {
        listener.current = null; setListening(false);
        setMicError(/blocked|not-allowed/i.test(e) ? "Chrome blocked the microphone for this page. Allow it with the icon at the right of the address bar, or type instead." : e);
      },
    });
  };
  const stopListen = () => listener.current?.stop();
  const toggleListen = () => (listener.current ? stopListen() : startListen());

  const send = () => {
    const q = text.trim();
    if (!q) return;
    setText("");
    setHistory(false);
    ctrl.current?.ask(q, true);
  };

  const last = entries[entries.length - 1];
  const busy = !!status && !last?.done;
  const speaking = useSpeaking();
  const mic = useMicStream(listening);
  const voice = voiceState({ listening, busy, speaking });

  if (!settings) return null;
  const needsSetup = !settings.privacyAccepted && settings.provider !== "local";

  return (
    <div className="flex min-h-screen items-end justify-center px-10 pb-6 pt-12" onMouseEnter={() => { hover.current = true; }} onMouseLeave={() => { hover.current = false; }}>
      <div ref={card} className={cx("wspr-card relative w-full max-w-[720px]", voice === "idle" && guide.active && "watching")}>
        <VoiceGlow state={voice} stream={mic}>
        <div className="relative overflow-hidden rounded-[20px] border border-black/[.05] bg-white/[.97] shadow-[0_12px_36px_-6px_rgba(0,0,0,.12),0_2px_10px_-2px_rgba(0,0,0,.06)] backdrop-blur">
          {history && entries.length > 1 && (
            <div className="max-h-[340px] space-y-3 overflow-y-auto border-b border-line bg-page px-4 py-3">
              {entries.slice(0, -1).map((e) => <Entry key={e.id} e={e} />)}
            </div>
          )}

          {needsSetup ? (
            <div className="px-4 pt-3 text-sm">
              <span className="font-medium">Before you start:</span> Wspr sends your question, a screenshot of this page and its list of controls to {PROVIDERS[settings.provider].displayName}.{" "}
              <button className="font-medium text-primary underline" onClick={() => openSettings("#welcome")}>Set up Wspr</button>
            </div>
          ) : listening ? (
            <div className="px-4 pt-3 text-[17px] font-light leading-snug text-fg">{partial || <span className="text-muted">Listening…</span>}</div>
          ) : last ? (
            <Current e={last} busy={busy} status={status} />
          ) : (
            <div className="px-4 pt-3 text-[15px] text-muted">Ask anything about Aprimo. I'll point to the right spot on the page.</div>
          )}

          {guide.active && (
            <div className="mx-4 mt-2 flex items-center gap-2 rounded-full bg-soft px-3 py-1 text-[12px] text-primary">
              <span className="h-2 w-2 shrink-0 rounded-full bg-primary wisp-pulse" />
              <span className="flex-1 truncate">Watching you do the step…</span>
              <button className="font-medium uppercase tracking-[1px] hover:underline" onClick={() => ctrl.current?.ask("what's the next step", true)}>Next</button>
              <button className="font-medium uppercase tracking-[1px] text-muted hover:underline" onClick={() => ctrl.current?.endGuide()}>Stop</button>
            </div>
          )}
          {micError && <div className="mx-4 mt-2 rounded-lg bg-[rgb(253,237,237)] px-3 py-1.5 text-[12px] text-[rgb(95,33,32)]">{micError}</div>}
          {/* "More" opens as a row inside the card (the frame is only as tall as the card, so a pop-up menu would be cut off). */}
          {menu && (
            <div className="mx-4 mt-2 flex flex-wrap justify-end gap-1.5">
              <MenuChip onClick={() => { setMenu(false); ctrl.current?.newChat(); }}>New chat</MenuChip>
              <MenuChip onClick={() => { setMenu(false); void openSettings(); }}>Settings</MenuChip>
              <MenuChip onClick={async () => { setMenu(false); const t = await chrome.tabs.getCurrent(); if (t?.windowId) chrome.sidePanel.open({ windowId: t.windowId }).catch(() => {}); }}>Teach Wspr</MenuChip>
            </div>
          )}

          <div className="flex items-center gap-2 px-2.5 py-2.5">
            <button title={listening ? "Stop listening" : "Talk (Alt+Shift+Space)"} aria-label={listening ? "Stop listening" : "Talk"} onClick={toggleListen}
              className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-transform hover:scale-[1.06]">
              <TalkRing state={voice} stream={mic} />
            </button>
            <input ref={input} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); send(); } }}
              placeholder={guide.active ? "Ask about this step…" : "Ask Wspr…"} aria-label="Ask Wspr"
              className="h-10 min-w-0 flex-1 rounded-full bg-black/[.04] px-4 text-[14px] outline-none placeholder:text-muted focus:bg-black/[.06]" />
            {busy || listening
              ? <IconButton title="Stop" onClick={stopAll}><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></IconButton>
              : text.trim() && <IconButton title="Ask" onClick={send} primary><path d="M4 12h14M12 5l7 7-7 7" stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></IconButton>}
            {entries.length > 1 && (
              <IconButton title={history ? "Hide earlier answers" : "Earlier answers"} onClick={() => setHistory((h) => !h)} active={history}>
                <path d="M13 3a9 9 0 0 0-9 9H1l4 4 4-4H6a7 7 0 1 1 2.05 4.95l-1.42 1.42A9 9 0 1 0 13 3zm-1 5v5l4.25 2.52.77-1.28-3.52-2.09V8z" fill="currentColor" />
              </IconButton>
            )}
            <IconButton title="More" onClick={() => setMenu((m) => !m)} active={menu}><circle cx="5" cy="12" r="2" fill="currentColor" /><circle cx="12" cy="12" r="2" fill="currentColor" /><circle cx="19" cy="12" r="2" fill="currentColor" /></IconButton>
            <IconButton title="Close (Esc)" onClick={() => { stopAll(); toPage({ type: "hide" }); }}><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></IconButton>
          </div>
        </div>
        </VoiceGlow>
      </div>
    </div>
  );
}

/** The latest exchange, Siri-style: the question small, the answer large, sources and links underneath. */
function Current({ e, busy, status }: { e: ChatEntry; busy: boolean; status: string }) {
  const r = e.result ?? {};
  const cited = useMemo(() => (r.notes ?? []).filter((n) => (r.cited ?? []).includes(n.id)), [r.notes, r.cited]);
  const shown = (e.say || "").replace(/\s*\[k\d+(?:\s*,\s*k\d+)*\]/gi, "");
  const go = async (route: string) => {
    const t = await activeTab();
    if (t?.id) toTab(t.id, { kind: "wisp", op: "navigate", route }).catch(() => {});
  };
  return (
    <div className="max-h-[260px] overflow-y-auto px-4 pt-3">
      <div className="truncate text-[12.5px] text-muted">{e.kind === "guide" ? "Next step" : e.question}</div>
      {shown
        ? <div className="mt-0.5 whitespace-pre-wrap text-[15.5px] leading-snug text-fg">{shown}</div>
        : <div className="wspr-shimmer mt-0.5 text-[15.5px]">{busy ? (status || "Thinking…") : "…"}</div>}
      {e.card && <div className="mt-1 text-[13px]">{e.card.lines.map((l, i) => <div key={i}>{l}</div>)}</div>}
      {e.image && <img src={e.image} alt="A closer look" className="mt-2 max-h-48 rounded-lg border border-line" />}
      {(r.nav || cited.length > 0 || (r.videos?.length ?? 0) > 0) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {r.nav && <button onClick={() => go(r.nav!)} className="rounded-full bg-primary px-3 py-0.5 text-[12px] font-medium text-white">Open that page</button>}
          {r.videos?.map((v, i) => {
            const note = r.notes?.find((n) => n.id === v.id);
            return note?.video ? <a key={i} href={videoLink(note.video.url, v.at ?? note.video.start ?? 0)} target="_blank" rel="noreferrer" className="rounded-full bg-soft px-2.5 py-0.5 text-[12px] text-primary no-underline">▶ {v.label || note.title}</a> : null;
          })}
          {cited.map((n) => (
            <a key={n.id} href={n.video ? videoLink(n.video.url, n.video.start ?? 0) : n.url} target="_blank" rel="noreferrer" title={n.title}
              className="max-w-[16rem] truncate rounded-full bg-black/[.06] px-2.5 py-0.5 text-[12px] text-fg no-underline hover:bg-black/[.1]">
              <span className="text-muted">{sourceLabel[n.source] ?? n.source}:</span> {n.title.split(" > ").slice(-1)[0]}
            </a>
          ))}
        </div>
      )}
      {e.done && r.pointNotes?.length ? <div className="mt-1 text-[11.5px] text-[#b26a00]">{r.pointNotes[0]}</div> : null}
    </div>
  );
}

function IconButton({ title, onClick, children, primary, active }: { title: string; onClick: () => void; children: React.ReactNode; primary?: boolean; active?: boolean }) {
  return (
    <button title={title} aria-label={title} onClick={onClick}
      className={cx("flex h-9 w-9 shrink-0 items-center justify-center rounded-full", primary ? "bg-primary text-white" : active ? "bg-soft text-primary" : "text-black/55 hover:bg-black/[.05]")}>
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">{children}</svg>
    </button>
  );
}

function MenuChip({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} className="rounded-full border border-primary/40 bg-white px-3 py-1 text-[13px] font-medium text-primary hover:bg-soft">{children}</button>;
}

createRoot(document.getElementById("root")!).render(<Bar />);
