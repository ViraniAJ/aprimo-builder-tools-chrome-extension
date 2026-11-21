// Aprimo Wisp settings, opened from Administration › Aprimo Wisp or the panel. Tabs follow Wisp's Settings window
// (General, Speech, AI, Companion, Permissions, Privacy, About) plus Knowledge and Check-up; first run shows Welcome.
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { THEMES } from "../agent/overlay";
import { defaultSettings, exportSettings, importSettings, isLocked, loadSettingsFull, onSettingsChanged, resetSettings, saveSettings, type WispSettings } from "../core/settings";
import { loadNotes, saveNotes } from "../core/helpers";
import { voices as listVoices, speak, stopSpeaking, type Voice } from "../voice/tts";
import { Button, Field, Range, Section, Segmented, Select, Toggle, WispMark, cx } from "../ui/components";
import { AITab } from "./ai";
import { Checkup } from "./checkup";
import { KnowledgeTab } from "./knowledge";
import { Onboarding } from "./onboarding";

export type Update = (patch: Partial<WispSettings>) => void;
export interface TabProps { s: WispSettings; update: Update; locked: (path: string) => boolean }

const TABS = [
  ["general", "General"], ["voice", "Voice & captions"], ["ai", "AI"], ["knowledge", "Knowledge"], ["companion", "Companion"],
  ["privacy", "Privacy"], ["checkup", "Check-up"], ["about", "About"],
] as const;
type TabId = (typeof TABS)[number][0] | "welcome";

function App() {
  const [s, setS] = useState<WispSettings | null>(null);
  const [lockedPaths, setLocked] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [tab, setTab] = useState<TabId>((location.hash.slice(1) as TabId) || "general");

  const reload = async () => {
    const r = await loadSettingsFull();
    setS(r.settings);
    setLocked(r.locked);
    setWarnings(r.warnings);
    if (!r.settings.onboardingCompleted && !location.hash) setTab("welcome");
  };
  useEffect(() => { reload(); return onSettingsChanged(reload); }, []);
  useEffect(() => { history.replaceState(null, "", `#${tab}`); }, [tab]);

  if (!s) return <div className="p-6 text-muted">Loading…</div>;
  const update: Update = (patch) => { const n = { ...s, ...patch }; setS(n); saveSettings(n); };
  const locked = (path: string) => isLocked(lockedPaths, path);
  const props: TabProps = { s, update, locked };

  if (tab === "welcome") return <Onboarding {...props} done={() => { update({ onboardingCompleted: true }); setTab("general"); }} />;

  return (
    <div className="flex min-h-screen bg-page">
      <nav className="w-56 shrink-0 border-r border-line bg-white px-2 py-4">
        <div className="mb-4 flex items-center gap-2 px-3"><WispMark size={24} /><span className="text-[14px] font-medium">Aprimo Wisp</span></div>
        {TABS.map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={cx("mb-0.5 block h-9 w-full rounded-[6px] pl-3 pr-2 text-left text-[14px] font-medium tracking-[0.25px]", tab === id ? "bg-soft text-primary" : "text-fg hover:bg-black/[.04]")}>{label}</button>
        ))}
      </nav>
      <main className="min-w-0 max-w-4xl flex-1 px-6 py-5">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h1 className="text-[28px] font-normal">{TABS.find(([id]) => id === tab)?.[1]}</h1>
          <Button kind="primary" onClick={openPanel}>Open Wisp panel</Button>
        </div>
        {!!warnings.length && <div className="mb-3 rounded-lg border border-danger/30 bg-danger/5 p-2 text-xs text-danger">Some saved settings were invalid and were ignored: {warnings.join(", ")}.</div>}
        {tab === "general" && <General {...props} replay={() => setTab("welcome")} />}
        {tab === "voice" && <VoiceTab {...props} />}
        {tab === "ai" && <AITab {...props} />}
        {/* Kept mounted so an indexing run and its progress survive switching tabs. */}
        <div hidden={tab !== "knowledge"}><KnowledgeTab /></div>
        {tab === "companion" && <Companion {...props} />}
        {tab === "privacy" && <Privacy {...props} />}
        {tab === "checkup" && <Checkup s={s} goTo={(t) => setTab(t as TabId)} />}
        {tab === "about" && <About />}
      </main>
    </div>
  );
}

async function openPanel() {
  try {
    const win = await chrome.windows.getCurrent();
    await chrome.sidePanel.open({ windowId: win.id! });
  } catch {
    alert("Click the Aprimo Wisp icon or press Alt+Shift+Space to open the panel.");
  }
}

function General({ s, update, locked, replay }: TabProps & { replay: () => void }) {
  const [msg, setMsg] = useState("");
  return (
    <>
      <Section title="Asking">
        <p className="mb-2 text-sm">Open the panel and hold the mic, or press <kbd className="rounded border border-line px-1">Alt</kbd>+<kbd className="rounded border border-line px-1">Shift</kbd>+<kbd className="rounded border border-line px-1">Space</kbd> to start and again to stop. You can change the keys at <code>chrome://extensions/shortcuts</code>.</p>
        <Toggle checked={s.guideSteps} locked={locked("guideSteps")} onChange={(v) => update({ guideSteps: v })} label="Guide me step by step" help="After a how-to answer, click where Wisp points and it shows the next step." />
        <Toggle checked={s.allowWebActions} locked={locked("allowWebActions")} onChange={(v) => update({ allowWebActions: v })} label="Let Wisp open websites for you" help="Light help only: open a site or search the web or a site in a new tab. Wisp never clicks or types in Aprimo." />
        <Toggle checked={s.readPageControls} locked={locked("readPageControls")} onChange={(v) => update({ readPageControls: v })} label="Better answers" help="Send the page's list of controls (names, positions, state) with each question. Wisp points far more accurately." />
      </Section>
      <Section title="Settings file">
        <div className="flex flex-wrap gap-2">
          <Button onClick={async () => { const blob = new Blob([await exportSettings()], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "aprimo-wisp-settings.json"; a.click(); }}>Export…</Button>
          <label className="inline-flex cursor-pointer items-center rounded-lg border border-line bg-card px-3 py-1.5 text-sm hover:bg-soft">Import…
            <input type="file" accept="application/json" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { await importSettings(await f.text()); setMsg("Imported."); } catch (err) { setMsg((err as Error).message); } }} />
          </label>
          <Button kind="danger" onClick={async () => { if (confirm("Reset every Wisp setting to its default? Keys and knowledge stay.")) { await resetSettings(); setMsg("Reset."); } }}>Reset to defaults</Button>
          <Button kind="ghost" onClick={replay}>Replay Welcome…</Button>
        </div>
        <p className="mt-2 text-xs text-muted">Exports never include AI keys. {msg}</p>
      </Section>
    </>
  );
}

function VoiceTab({ s, update, locked }: TabProps) {
  const [vs, setVs] = useState<Voice[]>([]);
  useEffect(() => { listVoices().then(setVs); }, []);
  return (
    <>
      <Section title="Voice">
        <Field label="Voice" locked={locked("voiceName")}>
          <div className="flex gap-2">
            <Select value={s.voiceName} disabled={locked("voiceName")} onChange={(v) => update({ voiceName: v })} options={[{ value: "", label: "Browser default" }, ...vs.map((v) => ({ value: v.name, label: `${v.name}${v.lang ? `, ${v.lang}` : ""}${v.remote ? " (online)" : ""}` }))]} />
            <Button onClick={() => { stopSpeaking(); speak("Hi, I'm Aprimo Wisp. Ask me anything about Aprimo.", { voiceName: s.voiceName || undefined, rate: s.rate, volume: s.volume }); }}>Preview</Button>
          </div>
        </Field>
        <Field label="Speed" locked={locked("rate")}><Range value={s.rate} min={0.7} max={1.4} step={0.05} format={(v) => `${v.toFixed(2)}×`} disabled={locked("rate")} onChange={(v) => update({ rate: v })} /></Field>
        <Field label="Volume" locked={locked("volume")}><Range value={s.volume} min={0} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} disabled={locked("volume")} onChange={(v) => update({ volume: v })} /></Field>
        <Toggle checked={s.speak} locked={locked("speak")} onChange={(v) => update({ speak: v })} label="Speak answers out loud" help={s.speak ? undefined : "Answers appear as captions only."} />
      </Section>
      <Section title="Captions and sound">
        <Toggle checked={s.showCaptions || !s.speak} disabled={!s.speak} locked={locked("showCaptions")} onChange={(v) => update({ showCaptions: v })} label="Show captions on the page" />
        <Field label="Caption size"><Segmented value={s.captionSize} onChange={(v) => update({ captionSize: v })} options={[{ value: "small", label: "Small" }, { value: "medium", label: "Medium" }, { value: "large", label: "Large" }]} /></Field>
        <Field label="Caption position"><Segmented value={s.captionPosition} onChange={(v) => update({ captionPosition: v })} options={[{ value: "pointer", label: "Next to the pointer" }, { value: "bottom", label: "Bottom of the page" }]} /></Field>
        <Toggle checked={s.showHeard} onChange={(v) => update({ showHeard: v })} label="Show what Wisp heard" />
        <Toggle checked={s.earcons} onChange={(v) => update({ earcons: v })} label="Play listening sounds" />
      </Section>
    </>
  );
}

function Companion({ s, update, locked }: TabProps) {
  const look = (patch: Partial<WispSettings>) => update(patch);
  return (
    <>
      <Section title="Theme">
        <p className="mb-3 text-xs text-muted">The cursor Wisp moves on the Aprimo page to show you things.</p>
        <div className="grid grid-cols-4 gap-3 sm:grid-cols-7">
          {Object.entries(THEMES).map(([id, t]) => (
            <button key={id} disabled={locked("cursorTheme")} onClick={() => look({ cursorTheme: id })} className="text-center text-xs">
              <span className={cx("mx-auto mb-1 block h-12 w-12 rounded-2xl", s.cursorTheme === id && "ring-2 ring-primary ring-offset-2 ring-offset-bg")} style={{ background: `linear-gradient(135deg, ${t.a}, ${t.b})` }} />
              {t.name}
            </button>
          ))}
        </div>
      </Section>
      <Section title="Look">
        <Field label="Outline"><Segmented value={s.outline} onChange={(v) => look({ outline: v })} options={[{ value: "white", label: "White" }, { value: "black", label: "Black" }, { value: "none", label: "None" }]} /></Field>
        <Field label="Size" locked={locked("cursorScale")}><Range value={s.cursorScale} min={0.6} max={2} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={(v) => look({ cursorScale: v })} /></Field>
        <Toggle checked={s.keepOnScreen} onChange={(v) => look({ keepOnScreen: v })} label="Keep the companion on screen" help={s.keepOnScreen ? "Your companion waits beside your pointer and flies off to show you things." : "The companion appears beside your pointer when you ask, flies to what it shows you, then fades away."} />
        <Field label="Transparency when idle"><Range value={s.idleOpacity} min={0.2} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} disabled={!s.keepOnScreen} onChange={(v) => look({ idleOpacity: v })} /></Field>
        <Field label="Reduce motion"><Segmented value={s.reduceMotion} onChange={(v) => look({ reduceMotion: v })} options={[{ value: "system", label: "Follow system" }, { value: "on", label: "Always" }, { value: "off", label: "Never" }]} /></Field>
      </Section>
    </>
  );
}

function Privacy({ s, update, locked }: TabProps) {
  const [notes, setNotes] = useState(0);
  useEffect(() => { loadNotes().then((n) => setNotes(n.length)); }, []);
  return (
    <>
      <Section title="What leaves your computer">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>Only when you ask: your question, a screenshot of the Aprimo tab (if allowed below), the page's list of controls, and the few knowledge passages that match, go to the AI provider you chose. Wisp keeps none of it on a server.</li>
          <li>The offline model, the knowledge index, speech transcription for recordings, notes, timers and history all stay in this browser.</li>
          <li>Speech recognition for the mic uses Chrome's built-in service.</li>
          <li>Passwords, tokens and input values on the page are never read; text that looks like a key is masked.</li>
          <li>No analytics.</li>
        </ul>
        <div className="mt-3"><Toggle checked={s.privacyAccepted} onChange={(v) => update({ privacyAccepted: v })} label="I understand: let Wisp ask the cloud AI" help="Without this, Wisp only uses the offline model." /></div>
      </Section>
      <Section title="Screen">
        <Toggle checked={s.sendScreenshots} locked={locked("sendScreenshots")} onChange={(v) => update({ sendScreenshots: v })} label="Send a screenshot of the Aprimo tab with each question" help="Turn off to send only the page's list of controls." />
      </Section>
      <Section title="History and notes">
        <Toggle checked={s.keepHistory} locked={locked("keepHistory")} onChange={async (v) => { if (!v) await chrome.storage.local.remove("wisp.history"); update({ keepHistory: v }); }} label="Keep history in this browser" help="Off: history lasts until you close the browser." />
        <div className="flex items-center gap-3 py-2 text-sm">{notes} note{notes === 1 ? "" : "s"} <Button small kind="danger" disabled={!notes} onClick={async () => { await saveNotes([]); setNotes(0); }}>Clear notes</Button></div>
        <Toggle checked={s.localTimingLog} onChange={(v) => update({ localTimingLog: v })} label="Keep timing measurements (no content)" />
      </Section>
    </>
  );
}

function About() {
  const m = chrome.runtime.getManifest();
  return (
    <Section title="About">
      <p className="text-sm">Aprimo Wisp {m.version}: a browser take on Wisp, the push-to-talk Mac helper, specialised for Aprimo and built into Aprimo Builder Tools.</p>
      <p className="mt-2 text-sm text-muted">What carries over from the Mac app: the reply format and pointing, the race between NVIDIA models, step-by-step guidance, the local skills (math, conversions, time, timers, notes, reading aloud, writing help, drawing), history, captions, themes and the settings file. What doesn't: things only macOS allows (opening Mac apps, menu-bar commands, Mac facts, the system dictionary, the Kokoro voice). See docs/wisp.md.</p>
      <p className="mt-2 text-sm text-muted">Knowledge: developers.aprimo.com (bundled), Aprimo Help (indexed with your sign-in), and anything you add.</p>
      <div className="mt-3"><Button onClick={() => { const d = defaultSettings(); navigator.clipboard.writeText(JSON.stringify({ version: m.version, defaults: { provider: d.provider } })); }}>Copy version info</Button></div>
    </Section>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
