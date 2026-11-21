// First run, following Wisp's onboarding steps (welcome, privacy, AI, microphone, shortcut, try it, done), minus the
// macOS-only ones (speech model download, Screen Recording and Input Monitoring permissions).
import { useEffect, useState } from "react";
import { PROVIDERS, type ProviderId } from "../core/catalog";
import { getKey, setKey } from "../core/settings";
import { testConnection } from "../providers";
import { micPermission } from "../voice/stt";
import { Button, Select, WispMark, inputCls } from "../ui/components";
import type { TabProps } from "./main";

const STEPS = ["welcome", "privacy", "ai", "microphone", "shortcut", "tryIt", "done"] as const;
type Step = (typeof STEPS)[number];

export function Onboarding({ s, update, done }: TabProps & { done: () => void }) {
  const [step, setStep] = useState<Step>(() => (localStorage.getItem("wisp.onboarding.step") as Step) || "welcome");
  useEffect(() => { try { localStorage.setItem("wisp.onboarding.step", step); } catch { /* private window */ } }, [step]);
  const i = STEPS.indexOf(step);
  const next = () => setStep(STEPS[Math.min(STEPS.length - 1, i + 1)]);
  const back = () => setStep(STEPS[Math.max(0, i - 1)]);

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center p-6">
      <div className="rounded-2xl border border-line bg-card p-8 shadow-sm">
        {step === "welcome" && (
          <Body title="Meet Aprimo Wisp" sub="Ask anything about Aprimo, out loud or typed. Wisp answers in a friendly voice, and when it's about the page you're on, it shows you where to click.">
            <div className="flex justify-center py-6"><WispMark size={72} /></div>
          </Body>
        )}
        {step === "privacy" && (
          <Body title="What leaves your computer" sub="Plainly, before you turn anything on.">
            <ul className="list-disc space-y-1.5 pl-5 text-sm">
              <li>Wisp listens only while you hold the mic or after you press the shortcut.</li>
              <li>When you ask, it takes a screenshot of the Aprimo tab and lists the page's controls.</li>
              <li>Those, with your question, go to {PROVIDERS[s.provider].displayName} to answer. Wisp keeps nothing on a server.</li>
              <li>Speech recognition uses Chrome's built-in service; voices are your browser's.</li>
              <li>Your knowledge, recordings, notes and history stay in this browser. No analytics.</li>
            </ul>
          </Body>
        )}
        {step === "ai" && <AIStep s={s} update={update} />}
        {step === "microphone" && <MicStep />}
        {step === "shortcut" && (
          <Body title="Your shortcut" sub="Press Alt+Shift+Space to open Wisp and start listening; press it again when you're done. Or hold the mic button in the panel.">
            <Button onClick={() => chrome.tabs.create({ url: "chrome://extensions/shortcuts" })}>Change the shortcut…</Button>
          </Body>
        )}
        {step === "tryIt" && (
          <Body title="Try it out" sub="Open an Aprimo tab, open the Wisp panel, and ask something real.">
            <ol className="list-decimal space-y-1.5 pl-5 text-sm">
              <li>Press Alt+Shift+Space, or click the Wisp icon and hold the mic.</li>
              <li>Ask, for example: “What can you do?”, “How do I create a classification?”, “What's 15% of 80?”</li>
              <li>Let go. Wisp answers out loud with captions, and points when it's about the page.</li>
            </ol>
            <p className="mt-3 text-xs text-muted">To stop an answer, press Esc or the Stop button.</p>
          </Body>
        )}
        {step === "done" && (
          <Body title="You're all set" sub="Ask “how do I…” and click each step as Wisp shows it. Add your own articles, sites and recordings under Settings › Knowledge.">
            <div />
          </Body>
        )}
        <div className="mt-6 flex justify-between">
          {i > 0 ? <Button kind="ghost" onClick={back}>Back</Button> : <span />}
          {step === "welcome" && <Button kind="primary" onClick={next}>Get Started</Button>}
          {step === "privacy" && <Button kind="primary" onClick={() => { update({ privacyAccepted: true }); next(); }}>I Understand</Button>}
          {["ai", "microphone", "shortcut", "tryIt"].includes(step) && <Button kind="primary" onClick={next}>Continue</Button>}
          {step === "done" && <Button kind="primary" onClick={() => { try { localStorage.removeItem("wisp.onboarding.step"); } catch { /* ignore */ } done(); }}>Start Using Wisp</Button>}
        </div>
      </div>
    </div>
  );
}

function Body({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return <div><h1 className="text-2xl font-semibold">{title}</h1><p className="mt-2 text-muted">{sub}</p><div className="mt-5">{children}</div></div>;
}

function AIStep({ s, update }: Pick<TabProps, "s" | "update">) {
  const [key, setK] = useState("");
  const [has, setHas] = useState(false);
  const [msg, setMsg] = useState("");
  const id = s.provider;
  useEffect(() => { getKey(id).then((k) => setHas(!!k)); }, [id]);
  return (
    <Body title="Connect Wisp's AI" sub={id === "nvidia-nim" ? "Wisp uses a free NVIDIA account to understand your questions and the page. It takes about a minute." : "Use the provider you picked; you can change it any time in Settings › AI."}>
      <Select value={id} onChange={(v: ProviderId) => update({ provider: v })} options={(["nvidia-nim", "anthropic", "openai-compatible", "local"] as ProviderId[]).map((k) => ({ value: k, label: PROVIDERS[k].displayName }))} />
      {id !== "local" && id !== "openai-compatible" && (
        <div className="mt-4 space-y-2 text-sm">
          <div>1. {PROVIDERS[id].keyURL ? <a href={PROVIDERS[id].keyURL} target="_blank" rel="noreferrer">Get a key from {PROVIDERS[id].displayName.replace(/ \(.*\)$/, "")}</a> : "Get a key"}{id === "nvidia-nim" ? ": sign in or create an account, then choose Generate API Key and copy it." : "."}</div>
          <div>2. Paste it here:</div>
          {has ? <div className="text-ok">Key saved.</div> : (
            <div className="flex gap-2">
              <input className={inputCls} type="password" placeholder={PROVIDERS[id].keyPlaceholder} value={key} onChange={(e) => setK(e.target.value)} />
              <Button kind="primary" disabled={!key.trim()} onClick={async () => { await setKey(id, key, false); setHas(true); setK(""); setMsg("Checking the connection…"); setMsg((await testConnection({ ...s, privacyAccepted: true })).message); }}>Save</Button>
            </div>
          )}
          {msg && <div className="text-xs text-muted">{msg}</div>}
          <p className="text-xs text-muted">The key is kept only in this browser. You can change it any time in Settings › AI.</p>
        </div>
      )}
      {id === "openai-compatible" && <p className="mt-3 text-sm text-muted">Set the server address and model in Settings › AI after setup.</p>}
      {id === "local" && <p className="mt-3 text-sm text-muted">Download the offline model in Settings › AI after setup (about 1 GB, needs WebGPU).</p>}
    </Body>
  );
}

function MicStep() {
  const [state, setState] = useState<string>("unknown");
  useEffect(() => { micPermission().then(setState); const t = setInterval(() => micPermission().then(setState), 1500); return () => clearInterval(t); }, []);
  return (
    <Body title="Let Wisp hear you" sub="Wisp listens only while you hold the mic or after you press the shortcut. Chrome shows a recording dot whenever the microphone is on.">
      {state === "granted" ? <div className="text-ok">Microphone allowed.</div> : <Button kind="primary" onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL("app/wisp/mic-permission.html") })}>Allow the microphone…</Button>}
      <p className="mt-2 text-xs text-muted">You can skip this and type your questions.</p>
    </Body>
  );
}
