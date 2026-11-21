// Settings for Aprimo Wisp, mirroring Wisp's AppConfig (vision, speech, overlay, privacy, guide…) with the parts a
// browser can't do left out. Layers, as in Wisp's ConfigStore: built-in defaults, then the user's changes
// (chrome.storage.local), then the organization's managed policy (chrome.storage.managed), whose every leaf is locked.
// Keys are stored apart from the rest under Wisp's account names ("nvidia-nim-api-key", …), in chrome.storage.local,
// or chrome.storage.session for "this session only"; they are never exported.
import { DEFAULT_PROVIDER, PROVIDERS, RETIRED_MODELS, type CoordinateSpace, type ProviderId } from "./catalog";

export interface ProviderSettings { baseURL: string; model: string; fallbacks: string[]; coordinateSpace?: CoordinateSpace }
export type AnswerLength = "short" | "normal" | "detailed";

export interface WispSettings {
  provider: ProviderId;
  providers: Record<ProviderId, ProviderSettings>;
  smartRouting: boolean; // NVIDIA: Super VL first, Nano as backup, drawings to Step 5
  timeoutSeconds: number;
  sendScreenshots: boolean;
  readPageControls: boolean; // Wisp's "Better answers": send the page's control list
  answerLength: AnswerLength;
  instructions: string; // max 500 characters
  guideSteps: boolean; // "Guide me step by step"
  surface: "bar" | "panel"; // where Wspr opens on Aprimo pages: a bar at the bottom of the page, or Chrome's side panel
  allowWebActions: boolean; // "Let Wisp open websites for you"
  answerCard: boolean; // show answers in the panel (always on in the panel; kept for parity of exported files)
  // speech
  speak: boolean;
  voiceName: string;
  rate: number;
  volume: number;
  showCaptions: boolean;
  captionSize: "small" | "medium" | "large";
  captionPosition: "pointer" | "bottom";
  showHeard: boolean;
  earcons: boolean;
  // companion (the on-page cursor)
  cursorTheme: string;
  cursorScale: number;
  outline: "white" | "black" | "none";
  reduceMotion: "system" | "on" | "off";
  keepOnScreen: boolean; // the companion waits beside the pointer between questions
  highlight: "circle" | "box"; // how a control Wspr points at is marked
  idleOpacity: number;
  // offline model
  autoLocalFallback: boolean;
  localModelInstalled: string;
  // privacy
  privacyAccepted: boolean; // Wisp's cloudDisclosureAccepted: gates network requests
  keepHistory: boolean;
  localTimingLog: boolean;
  onboardingCompleted: boolean;
}

export const SETTINGS_KEY = "wisp.settings";
export const MAX_INSTRUCTIONS = 500;

export function defaultSettings(): WispSettings {
  const p = (id: ProviderId): ProviderSettings => ({ baseURL: PROVIDERS[id].defaultBaseURL, model: PROVIDERS[id].defaultModelID, fallbacks: id === "nvidia-nim" ? [...PROVIDERS[id].defaultFallbacks] : [], coordinateSpace: "pixels" });
  return {
    provider: DEFAULT_PROVIDER,
    providers: { "nvidia-nim": p("nvidia-nim"), "openai-compatible": p("openai-compatible"), anthropic: p("anthropic"), local: p("local") },
    smartRouting: true,
    timeoutSeconds: 20,
    sendScreenshots: true,
    readPageControls: true,
    answerLength: "normal",
    instructions: "",
    guideSteps: true,
    surface: "bar",
    allowWebActions: true,
    answerCard: true,
    speak: true,
    voiceName: "",
    rate: 1.0,
    volume: 1.0,
    showCaptions: true,
    captionSize: "medium",
    captionPosition: "pointer",
    showHeard: true,
    earcons: true,
    cursorTheme: "aprimo",
    cursorScale: 1.0,
    outline: "white",
    reduceMotion: "system",
    keepOnScreen: false,
    highlight: "circle",
    idleOpacity: 0.85,
    autoLocalFallback: true,
    localModelInstalled: "",
    privacyAccepted: false,
    keepHistory: false,
    localTimingLog: true,
    onboardingCompleted: false,
  };
}

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);

/** Deep merge; an explicit null deletes the key (Wisp's merge rule). Wrong-typed leaves are dropped. */
export function deepMerge<T>(base: T, layer: unknown, warn?: (path: string) => void, path = ""): T {
  if (!isObj(layer) || !isObj(base)) return base;
  const out: Record<string, any> = { ...(base as any) };
  for (const [k, v] of Object.entries(layer)) {
    const here = path ? `${path}.${k}` : k;
    if (v === null) { delete out[k]; continue; }
    const cur = out[k];
    if (isObj(cur) && isObj(v)) out[k] = deepMerge(cur, v, warn, here);
    else if (cur === undefined || typeof cur === typeof v || (Array.isArray(cur) && Array.isArray(v))) out[k] = v;
    else warn?.(here);
  }
  return out as T;
}

/** Every leaf path in an object ("providers.nvidia-nim.model"). */
export function leafPaths(o: unknown, prefix = ""): string[] {
  if (!isObj(o)) return prefix ? [prefix] : [];
  return Object.entries(o).flatMap(([k, v]) => leafPaths(v, prefix ? `${prefix}.${k}` : k));
}

/** Wisp's isLocked: the path equals, contains or is inside a managed path. */
export function isLocked(locked: string[], path: string): boolean {
  return locked.some((l) => l === path || l.startsWith(path + ".") || path.startsWith(l + "."));
}

function sanitize(s: WispSettings): WispSettings {
  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));
  const providers = { ...s.providers };
  for (const id of Object.keys(providers) as ProviderId[]) {
    const p = { ...providers[id] };
    p.model = RETIRED_MODELS[p.model] ?? p.model;
    p.fallbacks = [...new Set((p.fallbacks ?? []).map((f) => RETIRED_MODELS[f] ?? f))];
    providers[id] = p;
  }
  // Older saves used "medium".
  const answerLength = ((s.answerLength as string) === "medium" ? "normal" : s.answerLength) as AnswerLength;
  return {
    ...s,
    providers,
    answerLength,
    instructions: (s.instructions ?? "").slice(0, MAX_INSTRUCTIONS),
    rate: Math.round(clamp(s.rate, 0.5, 2.0) * 100) / 100,
    volume: clamp(s.volume, 0, 1),
    cursorScale: clamp(s.cursorScale, 0.6, 2.0),
    idleOpacity: clamp(s.idleOpacity, 0.2, 1.0),
    timeoutSeconds: clamp(s.timeoutSeconds, 5, 120),
  };
}

export function mergeSettings(saved: unknown, managed?: unknown, warn?: (path: string) => void): WispSettings {
  let s = deepMerge(defaultSettings(), saved, warn);
  if (managed) s = deepMerge(s, managed, (p) => warn?.(`managed:${p}`));
  return sanitize(s);
}

export interface LoadedSettings { settings: WispSettings; locked: string[]; warnings: string[] }

export async function loadSettingsFull(): Promise<LoadedSettings> {
  const r = await chrome.storage.local.get(SETTINGS_KEY);
  let managed: Record<string, unknown> = {};
  try { managed = (await chrome.storage.managed.get(null)) ?? {}; } catch { /* no policy */ }
  const warnings: string[] = [];
  const settings = mergeSettings(r[SETTINGS_KEY], managed, (p) => warnings.push(p));
  return { settings, locked: leafPaths(managed), warnings };
}

export async function loadSettings(): Promise<WispSettings> {
  return (await loadSettingsFull()).settings;
}

/** Saves only what differs from the defaults (Wisp keeps just the user's changes), never a managed path. */
export async function saveSettings(s: WispSettings): Promise<void> {
  const { locked } = await loadSettingsFull();
  const diff = diffFrom(defaultSettings(), sanitize(s), locked);
  await chrome.storage.local.set({ [SETTINGS_KEY]: diff });
}

export function diffFrom(base: any, next: any, locked: string[] = [], path = ""): any {
  const out: Record<string, any> = {};
  for (const k of Object.keys(next)) {
    const here = path ? `${path}.${k}` : k;
    if (locked.some((l) => l === here || here.startsWith(l + "."))) continue;
    const a = base?.[k], b = next[k];
    if (isObj(a) && isObj(b)) { const d = diffFrom(a, b, locked, here); if (Object.keys(d).length) out[k] = d; }
    else if (JSON.stringify(a) !== JSON.stringify(b)) out[k] = b;
  }
  return out;
}

export async function resetSettings(): Promise<void> {
  await chrome.storage.local.remove(SETTINGS_KEY);
}

/** Settings export (no keys, ever). */
export async function exportSettings(): Promise<string> {
  const r = await chrome.storage.local.get(SETTINGS_KEY);
  return JSON.stringify({ wispSettings: 1, settings: r[SETTINGS_KEY] ?? {} }, null, 2);
}

export async function importSettings(json: string): Promise<void> {
  const parsed = JSON.parse(json);
  const layer = parsed?.settings ?? parsed;
  if (!isObj(layer)) throw new Error("That file doesn't hold Wspr settings.");
  await saveSettings(mergeSettings(layer));
}

const keyName = (account: string) => `wisp.key.${account}`;

export async function getKey(provider: ProviderId): Promise<string> {
  const account = PROVIDERS[provider].keyAccount;
  if (!account) return "";
  const name = keyName(account);
  const s = await chrome.storage.session.get(name);
  if (s[name]) return String(s[name]);
  const l = await chrome.storage.local.get(name);
  return l[name] ? String(l[name]) : "";
}

export async function setKey(provider: ProviderId, key: string, sessionOnly: boolean): Promise<void> {
  const account = PROVIDERS[provider].keyAccount;
  if (!account) return;
  const name = keyName(account);
  const value = key.trim();
  await chrome.storage.session.remove(name);
  await chrome.storage.local.remove(name);
  if (!value) return;
  await (sessionOnly ? chrome.storage.session : chrome.storage.local).set({ [name]: value });
}

export async function keyIsSessionOnly(provider: ProviderId): Promise<boolean> {
  const account = PROVIDERS[provider].keyAccount;
  if (!account) return false;
  const name = keyName(account);
  return !!(await chrome.storage.session.get(name))[name];
}

export function onSettingsChanged(cb: () => void): () => void {
  const fn = (changes: Record<string, unknown>, area: string) => { if ((area === "local" && SETTINGS_KEY in changes) || area === "managed") cb(); };
  chrome.storage.onChanged.addListener(fn);
  return () => chrome.storage.onChanged.removeListener(fn);
}
