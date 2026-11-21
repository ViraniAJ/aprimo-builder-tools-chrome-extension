// The AI tab: provider, key, model (with Wisp's smart routing, Find Models and the connection test), the offline
// model download, and "About you" (answer length and standing instructions).
import { useEffect, useState } from "react";
import { LOCAL_MODELS, NIM_RECOMMENDED, PROVIDERS, type ProviderId } from "../core/catalog";
import { MAX_INSTRUCTIONS, defaultSettings, getKey, keyIsSessionOnly, setKey } from "../core/settings";
import { findModels, testConnection } from "../providers";
import { gpuSummary } from "../providers/gpu";
const webllm = () => import("../providers/webllm");
import { Button, Field, Progress, Section, Segmented, Select, Toggle, inputCls } from "../ui/components";
import type { TabProps } from "./main";

const EXAMPLES = ["I'm new to Aprimo: explain simply, one step at a time.", "Keep answers very short.", "I'm a DAM administrator; I configure classifications and rules."];

export function AITab({ s, update, locked }: TabProps) {
  const id = s.provider;
  const info = PROVIDERS[id];
  const p = s.providers[id];
  const setP = (patch: Partial<typeof p>) => update({ providers: { ...s.providers, [id]: { ...p, ...patch } } });
  const [test, setTest] = useState<{ running?: boolean; ok?: boolean; message?: string }>({});
  const [allModels, setAllModels] = useState(false);
  const [found, setFound] = useState<string[]>([]);
  const [findErr, setFindErr] = useState("");

  const choose = (next: ProviderId) => {
    // Wisp: changing provider resets its address and model to that provider's defaults.
    const d = defaultSettings().providers[next];
    update({ provider: next, providers: { ...s.providers, [next]: { ...s.providers[next], baseURL: s.providers[next].baseURL || d.baseURL, model: s.providers[next].model || d.model } } });
    setTest({});
    setFound([]);
  };
  const runTest = async () => { setTest({ running: true, message: "Checking the connection…" }); setTest(await testConnection(s)); };

  const catalog = id === "nvidia-nim" && !allModels ? info.catalog.filter((m) => NIM_RECOMMENDED.includes(m.id)) : info.catalog;

  return (
    <>
      <Section title="AI provider">
        <Field label="Provider" locked={locked("provider")}>
          <Select value={id} disabled={locked("provider")} onChange={choose} options={(Object.keys(PROVIDERS) as ProviderId[]).map((k) => ({ value: k, label: PROVIDERS[k].displayName }))} />
        </Field>

        {id !== "local" && <KeyRow provider={id} onSaved={runTest} />}

        {id === "nvidia-nim" && (
          <>
            <Toggle checked={s.smartRouting} locked={locked("smartRouting")} onChange={(v) => update({ smartRouting: v })} label="Smart routing"
              help={s.smartRouting ? "Questions go to Nemotron 3.5 Super VL, the most accurate free model (about 2 seconds), with Nemotron Nano as a quick backup; drawings go to Step 5 Preview." : "Every question goes to the model below."} />
            <Field label="Model" locked={locked("providers")}>
              <Select value={p.model} disabled={s.smartRouting} onChange={(v) => setP({ model: v })} options={catalog.map((m) => ({ value: m.id, label: `${m.displayName}${m.note ? ` – ${m.note}` : ""}` }))} />
              <label className="mt-1 flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={allModels} onChange={(e) => setAllModels(e.target.checked)} /> Show all models</label>
            </Field>
            <Toggle checked={p.fallbacks.length > 0} onChange={(v) => setP({ fallbacks: v ? [...info.defaultFallbacks] : [] })} label="If the model fails, try another one" />
          </>
        )}

        {id === "anthropic" && (
          <Field label="Model"><Select value={p.model} onChange={(v) => setP({ model: v })} options={info.catalog.map((m) => ({ value: m.id, label: `${m.displayName}${m.note ? ` – ${m.note}` : ""}` }))} /></Field>
        )}

        {id === "openai-compatible" && (
          <>
            <Field label="Server address" help={<>For example <code>https://api.openai.com/v1</code>, or <code>http://localhost:11434/v1</code> for Ollama. Chrome asks once for permission to reach a new address.</>}>
              <input className={inputCls} value={p.baseURL} placeholder="https://api.example.com/v1" onChange={(e) => setP({ baseURL: e.target.value.trim() })} />
            </Field>
            <Field label="Model">
              <div className="flex gap-2">
                <input className={inputCls} value={p.model} placeholder="e.g. gpt-4o or qwen2.5vl" list="found-models" onChange={(e) => setP({ model: e.target.value.trim() })} />
                <datalist id="found-models">{found.map((m) => <option key={m} value={m} />)}</datalist>
                <Button onClick={async () => {
                  setFindErr("");
                  try {
                    await requestOrigin(p.baseURL);
                    const list = await findModels(p.baseURL, await getKey(id));
                    setFound(list);
                    if (!p.model) setP({ model: list[0] });
                  } catch (e) { setFindErr((e as Error).message); }
                }}>Find models</Button>
              </div>
              {findErr && <div className="mt-1 text-xs text-danger">{findErr}</div>}
              {!!found.length && <div className="mt-1 text-xs text-muted">{found.length} models found.</div>}
            </Field>
            <Field label="Screen positions">
              <Select value={p.coordinateSpace ?? "pixels"} onChange={(v) => setP({ coordinateSpace: v })} options={[{ value: "pixels", label: "Pixels in the screenshot (most models)" }, { value: "normalized1000", label: "0 to 1000 (Gemini, Qwen, Gemma)" }, { value: "normalizedUnit", label: "0 to 1" }]} />
            </Field>
          </>
        )}

        {id !== "local" && (
          <div className="mt-2 flex items-center gap-3">
            <Button kind="primary" disabled={test.running} onClick={async () => { if (id === "openai-compatible") await requestOrigin(p.baseURL); runTest(); }}>{id === "openai-compatible" ? "Connect" : "Test connection"}</Button>
            {test.message && <span className={test.running ? "text-sm text-muted" : test.ok ? "text-sm text-ok" : "text-sm text-danger"}>{test.message}</span>}
          </div>
        )}
      </Section>

      <OfflineModel {...{ s, update, locked }} />

      <Section title="About you">
        <Field label="Answer length"><Segmented value={s.answerLength} disabled={locked("answerLength")} onChange={(v) => update({ answerLength: v })} options={[{ value: "short", label: "Short" }, { value: "normal", label: "Normal" }, { value: "detailed", label: "Detailed" }]} /></Field>
        <Field label="Instructions" help={<>Tell Wspr about yourself or how you like answers. It's sent with every question. {s.instructions.length}/{MAX_INSTRUCTIONS}</>} locked={locked("instructions")}>
          <textarea className={inputCls + " min-h-20"} maxLength={MAX_INSTRUCTIONS} value={s.instructions} placeholder="For example: I'm new to Aprimo, so explain simply." onChange={(e) => update({ instructions: e.target.value })} />
          <div className="mt-1 flex flex-wrap gap-1">{EXAMPLES.map((x) => <button key={x} className="rounded-full border border-line px-2 py-0.5 text-xs hover:bg-soft" onClick={() => update({ instructions: `${s.instructions}${s.instructions ? " " : ""}${x}`.slice(0, MAX_INSTRUCTIONS) })}>{x}</button>)}</div>
        </Field>
      </Section>
    </>
  );
}

/** Custom servers need a host permission; ask for exactly that origin. */
async function requestOrigin(baseURL: string) {
  try {
    const u = new URL(baseURL);
    const origins = [`${u.protocol}//${u.hostname}/*`];
    if (!(await chrome.permissions.contains({ origins }))) await chrome.permissions.request({ origins });
  } catch { /* invalid URL: findModels/testConnection say so */ }
}

function KeyRow({ provider, onSaved }: { provider: ProviderId; onSaved: () => void }) {
  const info = PROVIDERS[provider];
  const [has, setHas] = useState(false);
  const [value, setValue] = useState("");
  const [session, setSession] = useState(false);
  useEffect(() => { getKey(provider).then((k) => setHas(!!k)); keyIsSessionOnly(provider).then(setSession); setValue(""); }, [provider]);
  return (
    <Field label={`API key${info.keyRequired ? "" : " (optional)"}`} help={<>Kept only in this browser{session ? ", until you close it" : ""}. {info.keyURL && <a href={info.keyURL} target="_blank" rel="noreferrer">Get a key</a>}</>}>
      {has ? (
        <div className="flex items-center gap-2 text-sm"><span className="rounded bg-soft px-2 py-1">•••••••• saved{session ? " for this session" : ""}</span><Button kind="danger" small onClick={async () => { await setKey(provider, "", false); setHas(false); }}>Remove</Button></div>
      ) : (
        <div className="flex gap-2">
          <input className={inputCls} type="password" autoComplete="off" placeholder={info.keyPlaceholder} value={value} onChange={(e) => setValue(e.target.value)} />
          <Button kind="primary" disabled={!value.trim()} onClick={async () => { await setKey(provider, value, session); setValue(""); setHas(true); onSaved(); }}>Save</Button>
        </div>
      )}
      {!has && <label className="mt-1 flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={session} onChange={(e) => setSession(e.target.checked)} /> Only for this browser session</label>}
    </Field>
  );
}

function OfflineModel({ s, update }: TabProps) {
  const [gpu, setGpu] = useState<{ ok: boolean; reason?: string } | null>(null);
  const [cached, setCached] = useState<Record<string, boolean>>({});
  const [prog, setProg] = useState<{ text: string; value: number } | null>(null);
  const [err, setErr] = useState("");
  const model = s.providers.local.model || LOCAL_MODELS[0].id;
  useEffect(() => {
    gpuSummary().then(setGpu);
    webllm().then((w) => Promise.all(LOCAL_MODELS.map(async (m) => [m.id, await w.isLocalModelCached(m.id)] as const))).then((r) => setCached(Object.fromEntries(r)));
  }, []);
  const download = async () => {
    setErr("");
    setProg({ text: "Starting…", value: 0 });
    try {
      await (await webllm()).loadLocalModel(model, (p) => setProg({ text: p.text, value: p.progress }));
      setCached((c) => ({ ...c, [model]: true }));
      update({ localModelInstalled: model });
    } catch (e) { setErr((e as Error).message); }
    setProg(null);
  };
  return (
    <Section title="Offline model">
      <p className="text-sm text-muted">A small model that runs on this computer's graphics chip. It answers from Wspr's Aprimo knowledge and the page's controls when there's no key or no network. It can't see screenshots.</p>
      {gpu && !gpu.ok ? <div className="mt-2 text-sm text-danger">Not available here: {gpu.reason}</div> : (
        <>
          <Field label="Model"><Select value={model} onChange={(v) => update({ providers: { ...s.providers, local: { ...s.providers.local, model: v } } })} options={LOCAL_MODELS.map((m) => ({ value: m.id, label: `${m.displayName}${cached[m.id] ? " – downloaded" : ""}` }))} /></Field>
          <div className="flex flex-wrap items-center gap-2">
            {cached[model] ? (
              <>
                <span className="text-sm text-ok">Downloaded{s.localModelInstalled === model ? " and ready" : ""}.</span>
                {s.localModelInstalled !== model && <Button onClick={() => update({ localModelInstalled: model })}>Use it</Button>}
                <Button kind="danger" small onClick={async () => { await (await webllm()).deleteLocalModel(model); setCached((c) => ({ ...c, [model]: false })); if (s.localModelInstalled === model) update({ localModelInstalled: "" }); }}>Delete</Button>
              </>
            ) : <Button kind="primary" disabled={!!prog} onClick={download}>Download (about 1 GB)</Button>}
          </div>
          {prog && <div className="mt-2 space-y-1"><div className="truncate text-xs text-muted">{prog.text}</div><Progress value={prog.value} /></div>}
          {err && <div className="mt-2 text-xs text-danger">{err}</div>}
          <Toggle checked={s.autoLocalFallback} onChange={(v) => update({ autoLocalFallback: v })} label="Use it automatically when the cloud AI can't answer" />
        </>
      )}
    </Section>
  );
}
