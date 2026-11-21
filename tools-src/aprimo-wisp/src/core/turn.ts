// One question to the AI, start to finish (the role of Wisp's TurnPipeline model turn): read the page, take a
// screenshot, look up the knowledge, stream the answer, and as lines arrive speak them, caption them and draw what
// they point at, after Wisp's VisualDecision checks (snap to the matching control, drop visuals after "I can't see…"
// or a question back, keep off-topic visuals only when the sentence names them, note greyed-out controls).
import { searchKB } from "../kb/kb-client";
import type { Chunk } from "../kb/types";
import { ask, spokenError } from "../providers";
import { ProviderError, type ChatImage, type ChatRequest } from "../providers/types";
import type { AgentRequest, DrawCommand } from "../shared/messages";
import { speak, stopSpeaking } from "../voice/tts";
import type { CoordinateSpace } from "./catalog";
import { isDrawRequest } from "./drawing";
import { allowsPointing, asksBack, deniesPresence, isAboutAssistant, mentionsClipboard, sentenceNames, withoutHedge } from "./intents";
import { systemPrompt, userText, type KnowledgeNote, type PageElement, type PageFacts, type TurnFacts } from "./prompt";
import { ReplyParser, anchorOf, targetToViewport, type ReplyEvent, type Target } from "./reply-parser";
import { stripCitations, takeSentences } from "./sentences";
import type { WispSettings } from "./settings";

export interface StepView { index: number; total: number; text: string; target?: Target; until?: string }
export interface TurnResult {
  id: string;
  question: string;
  topic: string;
  say: string;
  steps: StepView[];
  stepsMore?: boolean; // Wisp's STEPS: more | done (undefined when absent)
  pointed: boolean;
  firstTarget?: Target;
  firstLabel?: string;
  notes: KnowledgeNote[];
  cited: string[];
  videos: { id: string; at?: number; label?: string }[];
  nav?: string;
  provider: string;
  model: string;
  ms: number;
  firstTokenMs?: number;
  pageTitle?: string;
  raw: string;
  error?: string;
  shot?: { dataUrl: string; width: number; height: number };
}

export interface TurnUI {
  status(text: string): void;
  update(partial: Partial<TurnResult>): void;
  caption(text: string): void;
}

export const isAprimoUrl = (url?: string) => !!url && /^https:\/\/[^/]+\.aprimo\.com\//i.test(url);

export async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

export async function toTab(tabId: number, msg: AgentRequest): Promise<any> {
  return chrome.tabs.sendMessage(tabId, msg);
}

async function pageFacts(tab: chrome.tabs.Tab): Promise<PageFacts | null> {
  if (!tab.id || !isAprimoUrl(tab.url)) return null;
  try {
    const r = await toTab(tab.id, { kind: "wisp", op: "snapshot", max: 150 });
    return r?.facts ?? null;
  } catch {
    // The agent starts with the page; a tab opened before the extension was installed needs one reload.
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content/wisp-agent.js"] });
      const r = await toTab(tab.id, { kind: "wisp", op: "snapshot", max: 150 });
      return r?.facts ?? null;
    } catch {
      return null;
    }
  }
}

export async function screenshot(tab: chrome.tabs.Tab, maxWidth = 1456): Promise<{ img: ChatImage; width: number; height: number; dataUrl: string } | null> {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId!, { format: "jpeg", quality: 72 });
    const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
    // Wisp's imageLongEdge: 1456 px.
    const scale = Math.min(1, maxWidth / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.72 });
    const scaled = await new Promise<string>((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.readAsDataURL(blob); });
    return { img: { mediaType: "image/jpeg", base64: scaled.split(",")[1] }, width: w, height: h, dataUrl: scaled };
  } catch (e) {
    console.warn("[wisp] screenshot unavailable:", (e as Error).message);
    return null;
  }
}

function toNotes(chunks: (Chunk & { score: number })[]): KnowledgeNote[] {
  return chunks.map((c, i) => ({ id: `k${i + 1}`, title: c.title, url: c.url, text: c.text, source: c.src, video: c.video }));
}

/** Wisp's normalized(label): drop trailing kind words and a leading "the". */
export function normLabel(label: string): string {
  let w = label.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  while (w.length > 1 && ["button", "icon", "menu", "item", "tab", "link", "field", "option", "checkbox", "toggle", "switch"].includes(w[w.length - 1])) w = w.slice(0, -1);
  if (w[0] === "the" && w.length > 1) w = w.slice(1);
  return w.join(" ");
}

/** VisualDecision step 4: the control a visual means, by label near the anchor (or anywhere if at most two share it). */
export function matchControl(label: string | undefined, anchor: { x: number; y: number } | null, page: PageFacts | null): PageElement | null {
  if (!label || !page) return null;
  const n = normLabel(label);
  if (!n) return null;
  const same = page.elements.filter((e) => normLabel(e.text || e.aria || "") === n || (e.aria && normLabel(e.aria) === n));
  if (!same.length) return null;
  const reach = 0.12 * Math.max(page.viewport.width, page.viewport.height);
  if (anchor) {
    const near = same.map((e) => ({ e, d: Math.hypot(e.x + e.w / 2 - anchor.x, e.y + e.h / 2 - anchor.y) })).sort((a, b) => a.d - b.d)[0];
    if (near.d <= reach) return near.e;
  }
  return same.length <= 2 ? same[0] : null;
}

const GREYED_WORDS = ["greyed", "grayed", "dimmed", "unavailable", "not available", "isn't available", "disabled", "can't be used", "cannot be used", "can't use", "not active", "inactive"];

export interface TurnOptions {
  question: string;
  settings: WispSettings;
  ui: TurnUI;
  signal: AbortSignal;
  guideText?: string;
  secondOpinion?: boolean;
  history?: ChatRequest["history"];
  /** Knowledge search text when it should differ from the question (walkthrough follow-ups). */
  searchText?: string;
  clipboard?: string;
}

export async function runTurn(o: TurnOptions): Promise<TurnResult> {
  const t0 = performance.now();
  const id = crypto.randomUUID();
  const s = o.settings;
  stopSpeaking();
  const tab = await activeTab();
  const onAprimo = isAprimoUrl(tab?.url);
  const agent = (m: AgentRequest) => { if (tab?.id && onAprimo) toTab(tab.id, m).catch(() => {}); };
  agent({ kind: "wisp", op: "clear" });

  o.ui.status(onAprimo ? "Looking at the page…" : "Thinking…");
  const [page, shot, chunks] = await Promise.all([
    tab ? pageFacts(tab) : Promise.resolve(null),
    tab && onAprimo && s.sendScreenshots && s.provider !== "local" ? screenshot(tab) : Promise.resolve(null),
    searchKB(o.searchText ?? o.question, 6).catch((e) => { console.warn("[wisp] knowledge search failed:", e); return []; }),
  ]);
  const notes = toNotes(chunks);
  const result: TurnResult = { id, question: o.question, topic: "", say: "", steps: [], pointed: false, notes, cited: [], videos: [], provider: "", model: "", ms: 0, pageTitle: page?.title, raw: "", shot: shot ? { dataUrl: shot.dataUrl, width: shot.width, height: shot.height } : undefined };
  const aboutAssistant = isAboutAssistant(o.question);
  const pointing = allowsPointing(o.question);

  let space: CoordinateSpace = "pixels";
  const buildReq = (local: boolean, sp: CoordinateSpace): ChatRequest => {
    space = sp;
    const image = shot && !local ? { width: shot.width, height: shot.height, space: sp } : null;
    const facts: TurnFacts = {
      question: o.question, page, image, notes, answerLength: s.answerLength, instructions: s.instructions, local,
      readControls: s.readPageControls || !image, clipboard: o.clipboard && mentionsClipboard(o.question) ? o.clipboard : undefined,
      guideText: o.guideText, aboutAssistant,
    };
    return { system: systemPrompt(local, sp, !!image), user: userText(facts), images: image ? [shot!.img] : [], maxTokens: local ? 400 : 700, history: o.history };
  };

  const stillThinking = setTimeout(() => { if (!result.say) { o.ui.caption("Still thinking…"); agent({ kind: "wisp", op: "caption", text: "Still thinking…", final: true }); } }, 6000);
  try {
    o.ui.status("Asking…");
    const answer = await ask(s, o.question, buildReq, o.signal, { secondOpinion: o.secondOpinion });
    result.provider = answer.provider;
    result.model = answer.model;
    o.ui.update({ provider: answer.provider, model: answer.model, notes });

    const parser = new ReplyParser();
    const sayParts: string[] = [];
    let spokenUpTo = "";
    let lastSentence = "";
    let greyedNote = "";
    const toVp = (t: Target): Target => (shot && page && t.kind !== "element" ? targetToViewport(t, space, { width: shot.width, height: shot.height }, page.viewport) : t);
    const draw = (cmd: DrawCommand) => agent({ kind: "wisp", op: "draw", turn: id, cmd });
    const say = (text: string) => {
      if (!s.speak) return;
      speak(text, { voiceName: s.voiceName || undefined, rate: s.rate, volume: s.volume });
    };
    const speakNew = (full: string, final: boolean) => {
      const clean = stripCitations(full);
      const pending = clean.slice(spokenUpTo.length);
      const { sentences, rest } = takeSentences(pending);
      const ready = final && rest.trim() ? [...sentences, rest.trim()] : sentences;
      for (const sentence of ready) { say(sentence); lastSentence = sentence; }
      if (ready.length) spokenUpTo = final ? clean : clean.slice(0, clean.length - rest.length);
    };

    /** Wisp's VisualDecision for one visual event; returns the target to draw (viewport), or null. */
    const decide = (ev: ReplyEvent, label?: string): { target?: Target; el?: PageElement } | null => {
      if (!pointing || !onAprimo) return null;
      if (isDrawRequest(o.question)) return {};
      const sentence = lastSentence || sayParts[sayParts.length - 1] || "";
      if (deniesPresence(sentence) || asksBack(sentence)) return null;
      const a = anchorOf(ev);
      const anchor = a && a.kind !== "element" ? toVp(a) : null;
      const anchorPt = anchor ? (anchor.kind === "rect" ? { x: anchor.x + anchor.w / 2, y: anchor.y + anchor.h / 2 } : anchor.kind === "point" ? anchor : null) : null;
      const byId = a?.kind === "element" ? page?.elements.find((e) => e.id === a.id) ?? null : null;
      const el = byId ?? matchControl(label, anchorPt, page);
      if (result.topic === "other" && !(label && sentenceNames(label, sentence) && el)) return null;
      return { el: el ?? undefined, target: el ? { kind: "element", id: el.id } : undefined };
    };
    const noteGreyed = (el?: PageElement, label?: string) => {
      if (!el?.disabled || greyedNote) return;
      const all = result.say.toLowerCase();
      if (GREYED_WORDS.some((w) => all.includes(w))) return;
      greyedNote = `${label || el.text || "That"} is greyed out right now, so it can't be used yet.`;
    };
    const markPointed = (t: Target, label?: string) => {
      if (!result.pointed) { result.pointed = true; result.firstTarget = t; result.firstLabel = label; }
    };

    const handle = (ev: ReplyEvent) => {
      switch (ev.type) {
        case "topic": result.topic = ev.text; o.ui.update({ topic: ev.text }); break;
        case "say-partial": {
          const live = [...sayParts, ev.text].join(" ");
          o.ui.update({ say: live });
          o.ui.caption(stripCitations(ev.text));
          if (s.showCaptions) agent({ kind: "wisp", op: "caption", text: stripCitations(ev.text) });
          speakNew(live, false);
          break;
        }
        case "say":
        case "text": {
          const text = result.topic === "other" ? withoutHedge(ev.text) : ev.text;
          sayParts.push(text);
          result.say = sayParts.join(" ");
          o.ui.update({ say: result.say });
          if (s.showCaptions) agent({ kind: "wisp", op: "caption", text: stripCitations(text), final: true });
          speakNew(result.say, false);
          break;
        }
        case "shape": {
          const d = decide(ev, ev.label);
          if (!d) break;
          // A POINT on a matched control snaps to it (and follows it); circles and underlines keep their own area
          // unless they were given by id.
          const target = d.target && (ev.shape === "POINT" || ev.target.kind === "element") ? d.target : toVp(ev.target);
          draw({ kind: "shape", shape: ev.shape, target, label: ev.label });
          markPointed(d.target ?? target, ev.label);
          noteGreyed(d.el, ev.label);
          break;
        }
        case "arrow": {
          const d = decide(ev, ev.label);
          if (!d) break;
          const to = d.target ?? toVp(ev.to);
          draw({ kind: "arrow", from: toVp(ev.from), to, label: ev.label });
          markPointed(to, ev.label);
          break;
        }
        case "path": {
          if (!pointing || !onAprimo) break;
          draw({ kind: "path", targets: ev.targets.map(toVp), label: ev.label });
          break;
        }
        case "steps": result.stepsMore = ev.more; break;
        case "step": result.steps.push({ ...ev, target: ev.target ? toVp(ev.target) : undefined }); o.ui.update({ steps: [...result.steps] }); break;
        case "source": result.cited = [...new Set([...result.cited, ...ev.ids])]; o.ui.update({ cited: result.cited }); break;
        case "video": result.videos.push({ id: ev.id, at: ev.at, label: ev.label }); o.ui.update({ videos: [...result.videos] }); break;
        case "nav": result.nav = ev.route; o.ui.update({ nav: ev.route }); break;
        case "done": break;
      }
    };

    o.ui.status(`Answering with ${answer.local ? "the offline model" : answer.model}…`);
    for await (const chunk of answer.stream) {
      if (o.signal.aborted) break;
      if (!result.firstTokenMs) result.firstTokenMs = Math.round(performance.now() - t0);
      result.raw += chunk;
      for (const ev of parser.push(chunk)) handle(ev);
      if (parser.degenerate) throw new ProviderError("degenerate", 0, true, "degenerate");
    }
    for (const ev of parser.end()) handle(ev);
    speakNew(result.say, true);

    if (greyedNote) { sayParts.push(greyedNote); result.say = sayParts.join(" "); say(greyedNote); }
    // Visuals but no speech: "Here." / "Here: {label}."
    if (!result.say.trim() && result.pointed) {
      const here = result.firstLabel ? `Here: ${result.firstLabel}.` : "Here.";
      result.say = here;
      say(here);
      if (s.showCaptions) agent({ kind: "wisp", op: "caption", text: here, final: true });
    }
    for (const m of result.say.matchAll(/\[(k\d+)\]/gi)) if (!result.cited.includes(m[1].toLowerCase())) result.cited.push(m[1].toLowerCase());
    if (result.steps.length && !s.guideSteps) agent({ kind: "wisp", op: "steps", turn: id, steps: result.steps });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    const msg = spokenError(e);
    result.error = msg || String((e as Error).message);
    result.say = msg;
    console.warn("[wisp] turn failed:", e);
    if (msg && s.speak) speak(msg, { voiceName: s.voiceName || undefined, rate: s.rate, volume: s.volume });
    if (msg) agent({ kind: "wisp", op: "caption", text: msg, final: true });
  } finally {
    clearTimeout(stillThinking);
  }
  result.ms = Math.round(performance.now() - t0);
  o.ui.update({ ...result });
  o.ui.status("");
  return result;
}
