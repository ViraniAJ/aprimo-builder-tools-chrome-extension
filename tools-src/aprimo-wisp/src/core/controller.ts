// The side panel's brain (Wisp's TurnPipeline.process plus WispAppController's guide, timer, note and drawing
// handlers). A question goes through Wisp's local intents in Wisp's order; anything left goes to the AI. After a how-to
// answer the guide watches the user do each step and asks for the next one.
import { complete } from "../providers";
import type { AgentEvent, AgentRequest } from "../shared/messages";
import { earcon, speak, stopSpeaking, untilQuiet } from "../voice/tts";
import { builtInShape, isFreeSketch, parseStroke, placeShape, placeSketch, shapeSpokenName, shapeStrokes, sketchSubject, SKETCH_SYSTEM, type Pt } from "./drawing";
import { FIRST_STEP_TEXT, GUIDE_CAPTIONS, isContinuation, isTask, requestText, shouldEndGuide, shouldStartGuide, type GuideAction, type GuideStepRecord, actionsText } from "./guide";
import {
  HISTORY_CAPACITY, RECENT_CAPACITY, cleanedWriting, historyTitle, isSummaryRequest, isWritingHelp, noteCommand, recall, runNoteCommand,
  spokenDuration, timerCommand, webAction, writingUserText, WRITING_SYSTEM, type HistoryEntry,
} from "./helpers";
import {
  CAPABILITIES_CARD, CAPABILITIES_SAY, VOICE_REPLY, applyVoiceCommand, asksCapabilities, isCopyScreenText, isKeepReading, isMagnify, isReadAloud,
  isReadClipboard, isReadPage, isRepeat, isRetry, littleHelper, readingChunk, recallTopic, voiceCommand,
} from "./intents";
import { quickMath, timeAnswer } from "./quickmath";
import { saveSettings, type WispSettings } from "./settings";
import { activeTab, isAprimoUrl, runTurn, screenshot, toTab, type TurnResult } from "./turn";

export interface Card { title: string; lines: string[] }
export interface ChatEntry {
  id: string;
  question: string;
  typed: boolean;
  kind: "local" | "ai" | "guide";
  say: string;
  card?: Card;
  image?: string; // magnifier
  result?: Partial<TurnResult>;
  status?: string;
  done: boolean;
  at: number;
}

export interface ControllerUI {
  entry(e: ChatEntry): void; // add or replace by id
  status(text: string): void;
  caption(text: string): void;
  guide(active: boolean, text?: string): void;
  settings(s: WispSettings): void;
}

interface Guide { goal: string; history: GuideStepRecord[]; current: string; target?: TurnResult["firstTarget"]; label?: string; turn: string; steps: number; busy: boolean }

export class Controller {
  settings: WispSettings;
  private ui: ControllerUI;
  private abort: AbortController | null = null;
  private recent: { question: string; sentences: string; at: number }[] = [];
  private lastQuestion = "";
  private readingRest: string | undefined;
  private guideState: Guide | null = null;

  constructor(settings: WispSettings, ui: ControllerUI) {
    this.settings = settings;
    this.ui = ui;
    chrome.runtime.onMessage.addListener((m: AgentEvent) => { if (m?.kind === "wisp-event") this.onAgent(m); });
  }

  setSettings(s: WispSettings) { this.settings = s; }

  stop() {
    this.abort?.abort();
    this.abort = null;
    stopSpeaking();
    this.endGuide();
    this.ui.status("");
  }

  private async agent(m: AgentRequest): Promise<any> {
    const tab = await activeTab();
    if (!tab?.id || !isAprimoUrl(tab.url)) return null;
    return toTab(tab.id, m).catch(() => null);
  }

  private speak(text: string) {
    if (!text || !this.settings.speak) return;
    speak(text, { voiceName: this.settings.voiceName || undefined, rate: this.settings.rate, volume: this.settings.volume });
  }

  private remember(question: string, answer: string, typed: boolean, page?: string) {
    if (!answer.trim()) return;
    this.recent = [{ question, sentences: answer, at: Date.now() }, ...this.recent].slice(0, RECENT_CAPACITY);
    void this.addHistory({ id: crypto.randomUUID(), at: Date.now(), question, answer, page, typed });
  }

  // ── History (300, newest first; on disk only with "Keep history", otherwise for this browser session) ──
  private historyArea() { return this.settings.keepHistory ? chrome.storage.local : chrome.storage.session; }
  async history(): Promise<HistoryEntry[]> { return ((await this.historyArea().get("wisp.history"))["wisp.history"] as HistoryEntry[]) ?? []; }
  private async addHistory(e: HistoryEntry) {
    const all = [e, ...(await this.history())].slice(0, HISTORY_CAPACITY);
    await this.historyArea().set({ "wisp.history": all });
  }

  /** A local answer: speak it, show it, remember it. */
  private local(question: string, typed: boolean, say: string, extra: Partial<ChatEntry> = {}) {
    const e: ChatEntry = { id: crypto.randomUUID(), question, typed, kind: "local", say, done: true, at: Date.now(), ...extra };
    this.ui.entry(e);
    this.speak(say.replace(/^[•\-]\s*/gm, ""));
    if (say) { this.ui.caption(say); void this.agent({ kind: "wisp", op: "caption", text: say, final: true }); }
    this.remember(question, say, typed);
    return e;
  }

  async ask(raw: string, typed: boolean) {
    const question = raw.trim();
    stopSpeaking();
    if (!question) {
      this.ui.caption(typed ? "" : "I didn't catch a question. Hold the mic while you speak.");
      return;
    }
    if (this.settings.showHeard && !typed) this.ui.caption(`“${historyTitle(question, 80)}”`);

    // Mid-walkthrough: "what now?" asks for the next step; anything else ends it.
    if (this.guideState) {
      if (isContinuation(question)) { void this.nextStep([], false, question); return; }
      this.endGuide();
    }
    this.abort?.abort();
    const ctl = new AbortController();
    this.abort = ctl;
    try { await this.process(question, typed, ctl.signal); }
    catch (e) { if ((e as Error).name !== "AbortError") { console.warn("[wisp]", e); this.local(question, typed, "Sorry, something went wrong. Try again."); } }
  }

  private async process(question: string, typed: boolean, signal: AbortSignal) {
    const s = this.settings;
    // 2. Retry with a second opinion.
    if (isRetry(question) && this.lastQuestion) {
      this.ui.caption("Taking another look…");
      return this.aiTurn(this.lastQuestion, typed, signal, { secondOpinion: true, shownQuestion: question });
    }
    // 3. Writing help, when text is selected on the page.
    if (isWritingHelp(question)) {
      const pt = await this.agent({ kind: "wisp", op: "page-text", max: 12000 });
      if (pt?.selection && pt.text) return this.writingHelp(question, typed, pt.text, signal);
    }
    // 4. A built-in shape.
    const shape = builtInShape(question);
    if (shape) return this.drawShape(question, typed, shape);
    // 5. Web actions (6. AppAction is macOS-only).
    if (s.allowWebActions) {
      const w = webAction(question);
      if (w) { await chrome.tabs.create({ url: w.url }); return this.local(question, typed, w.say); }
    }
    // 7. Free sketch.
    if (isFreeSketch(question)) return this.sketch(question, typed, signal);
    // 8. Magnifier.
    if (isMagnify(question)) return this.magnify(question, typed);
    // 9. Definitions go to the AI in the browser (there is no system dictionary).
    // 10. Quick math, time, little helpers (MacFacts are macOS-only).
    const instant = quickMath(question) ?? timeAnswer(question) ?? littleHelper(question);
    if (instant) return this.local(question, typed, instant);
    // 11. Notes.
    const note = noteCommand(question);
    if (note) { const r = await runNoteCommand(note); return this.local(question, typed, r.say, { card: r.card }); }
    // 12. Timers.
    const timer = timerCommand(question);
    if (timer) return this.local(question, typed, await runTimer(timer));
    // 13. Voice commands.
    const vc = voiceCommand(question);
    if (vc) {
      const change = applyVoiceCommand(vc, s.rate);
      if (Object.keys(change).length) { this.settings = { ...s, ...change }; await saveSettings(this.settings); this.ui.settings(this.settings); }
      if (vc === "hush") { this.stop(); return; }
      return this.local(question, typed, VOICE_REPLY[vc]);
    }
    // 14. Copy the page's text.
    if (isCopyScreenText(question)) return this.copyPageText(question, typed);
    // 15. Shortcut lists come from the AI (no menu bar to read).
    // 16. Repeat.
    if (isRepeat(question)) {
      const last = this.recent[0];
      return this.local(question, typed, last ? last.sentences : "I haven't said anything yet.");
    }
    // 17. Capabilities.
    if (asksCapabilities(question)) return this.local(question, typed, CAPABILITIES_SAY, { card: CAPABILITIES_CARD });
    // 18. History recall.
    const topic = recallTopic(question);
    if (topic) {
      const hit = recall(await this.history(), topic);
      return this.local(question, typed, hit ? hit.answer : "I don't have anything about that in History.");
    }
    // 19. Keep reading.
    if (isKeepReading(question) && this.readingRest) return this.readText(question, typed, this.readingRest);
    // 20. Read the clipboard.
    if (isReadClipboard(question)) {
      const clip = await readClipboard();
      return clip ? this.readText(question, typed, clip.slice(0, 8000)) : this.local(question, typed, "There's no text on your clipboard.");
    }
    // 21. Read the selection or the page.
    if (isReadAloud(question) || isReadPage(question)) {
      this.ui.caption("Reading the page…");
      const pt = await this.agent({ kind: "wisp", op: "page-text" });
      if (!pt?.text) return this.local(question, typed, "I couldn't find any text to read on that page.");
      return this.readText(question, typed, pt.text);
    }
    // 22. The AI, looking at the page.
    return this.aiTurn(question, typed, signal, {});
  }

  private readText(question: string, typed: boolean, text: string) {
    const { first, rest } = readingChunk(text);
    this.readingRest = rest;
    return this.local(question, typed, rest ? `${first} Say “keep reading” for more.` : first);
  }

  // ── AI turns and the guide ────────────────────────────────────────────────
  private async aiTurn(question: string, typed: boolean, signal: AbortSignal, o: { secondOpinion?: boolean; shownQuestion?: string }) {
    this.lastQuestion = question;
    const entry: ChatEntry = { id: crypto.randomUUID(), question: o.shownQuestion ?? question, typed, kind: "ai", say: "", done: false, at: Date.now(), result: {} };
    this.ui.entry(entry);
    const clipboard = /clipboard|copied/i.test(question) ? await readClipboard() : undefined;
    const walkthrough = this.settings.guideSteps && isTask(question);
    const r = await runTurn({
      question, settings: this.settings, signal, secondOpinion: o.secondOpinion, clipboard,
      guideText: walkthrough ? FIRST_STEP_TEXT : undefined, oneStep: walkthrough,
      ui: {
        status: (t) => { entry.status = t; this.ui.status(t); this.ui.entry({ ...entry }); },
        update: (p) => { entry.result = { ...entry.result, ...p }; if (p.say !== undefined) entry.say = p.say; this.ui.entry({ ...entry }); },
        caption: (t) => this.ui.caption(t),
      },
    });
    entry.done = true;
    entry.say = r.say;
    entry.result = r;
    entry.status = "";
    this.ui.entry({ ...entry });
    this.remember(entry.question, r.say, typed, r.pageTitle);
    if (!r.error && shouldStartGuide({ guideSteps: this.settings.guideSteps, question, steps: r.stepsMore, pointed: r.pointed })) {
      this.guideState = { goal: question, history: [], current: r.say, target: r.firstTarget, label: r.firstLabel, turn: r.id, steps: 1, busy: false };
      this.ui.guide(true, r.say);
      void this.agent({ kind: "wisp", op: "watch", turn: r.id, target: r.firstTarget, label: r.firstLabel, caption: GUIDE_CAPTIONS.start });
      if (this.settings.showCaptions) this.ui.caption(GUIDE_CAPTIONS.start);
    }
  }

  private async nextStep(actions: GuideAction[], clickedTarget: boolean, typedQuestion?: string) {
    const g = this.guideState;
    if (!g || g.busy) return;
    g.busy = true;
    await untilQuiet();
    if (this.guideState !== g) return;
    const ctl = new AbortController();
    this.abort = ctl;
    const entry: ChatEntry = { id: crypto.randomUUID(), question: typedQuestion ?? "What's the next step?", typed: true, kind: "guide", say: "", done: false, at: Date.now(), result: {} };
    this.ui.entry(entry);
    try {
      const r = await runTurn({
        question: "What's the next step?", settings: this.settings, signal: ctl.signal, searchText: g.goal, oneStep: true,
        guideText: requestText({ goal: g.goal, history: g.history, current: g.current, actions, clickedTarget, targetLabel: g.label }),
        ui: {
          status: (t) => { entry.status = t; this.ui.entry({ ...entry }); },
          update: (p) => { entry.result = { ...entry.result, ...p }; if (p.say !== undefined) entry.say = p.say; this.ui.entry({ ...entry }); },
          caption: (t) => this.ui.caption(t),
        },
      });
      entry.done = true; entry.say = r.say; entry.result = r; entry.status = "";
      if (this.guideState !== g) { this.ui.entry({ ...entry }); return; }
      g.history.push({ said: g.current, did: actionsText(actions) });
      if (r.error) {
        this.ui.entry({ ...entry });
        this.ui.caption(GUIDE_CAPTIONS.lost);
        this.endGuide();
        return;
      }
      if (shouldEndGuide({ steps: r.stepsMore, pointed: r.pointed, stepCount: g.steps })) {
        if (!r.say.trim()) { entry.say = GUIDE_CAPTIONS.allSet; this.speak(GUIDE_CAPTIONS.allSet); }
        this.ui.entry({ ...entry });
        this.endGuide();
        return;
      }
      this.ui.entry({ ...entry });
      g.steps++;
      g.current = r.say;
      g.target = r.firstTarget;
      g.label = r.firstLabel;
      g.turn = r.id;
      g.busy = false;
      this.ui.guide(true, r.say);
      void this.agent({ kind: "wisp", op: "watch", turn: r.id, target: r.firstTarget, label: r.firstLabel });
    } catch (e) {
      if ((e as Error).name !== "AbortError") this.ui.caption(GUIDE_CAPTIONS.lost);
      this.endGuide();
    }
  }

  endGuide() {
    if (!this.guideState) return;
    this.guideState = null;
    this.ui.guide(false);
    void this.agent({ kind: "wisp", op: "watch-stop" });
  }

  get guiding() { return !!this.guideState; }

  private onAgent(m: AgentEvent) {
    const g = this.guideState;
    if (m.op === "guide-settled" && g && m.turn === g.turn) void this.nextStep(m.actions, m.clickedTarget);
    if (m.op === "guide-stopped" && g && m.turn === g.turn) this.endGuide();
  }

  // ── Local skills ──────────────────────────────────────────────────────────
  private async pointerAndViewport(): Promise<{ p: Pt; vp: { width: number; height: number } } | null> {
    const snap = await this.agent({ kind: "wisp", op: "snapshot", max: 1 });
    const f = snap?.facts;
    if (!f) return null;
    return { p: f.pointer ?? { x: f.viewport.width / 2, y: f.viewport.height / 2 }, vp: f.viewport };
  }

  private async drawShape(question: string, typed: boolean, shape: string) {
    const at = await this.pointerAndViewport();
    if (!at) return this.local(question, typed, "Open an Aprimo page and I'll draw it there.");
    const strokes = placeShape(shapeStrokes(shape), at.p, at.vp);
    await this.agent({ kind: "wisp", op: "draw", turn: "draw", cmd: { kind: "strokes", strokes } });
    return this.local(question, typed, `Here's a ${shapeSpokenName(shape)}.`);
  }

  private async sketch(question: string, typed: boolean, signal: AbortSignal) {
    const at = await this.pointerAndViewport();
    if (!at) return this.local(question, typed, "Open an Aprimo page and I'll draw it there.");
    const subject = sketchSubject(question);
    this.ui.caption(`Drawing ${subject}…`);
    void this.agent({ kind: "wisp", op: "caption", text: `Drawing ${subject}…` });
    try {
      const a = await complete(this.settings, SKETCH_SYSTEM, `Draw: ${subject}`, signal, { drawing: true, maxTokens: 1500 });
      let buf = "";
      let drawn = 0;
      const flush = async (line: string) => {
        const st = parseStroke(line);
        if (!st) return;
        drawn++;
        await this.agent({ kind: "wisp", op: "draw", turn: "sketch", cmd: { kind: "strokes", strokes: [placeSketch(st, at.p, at.vp)] } });
      };
      for await (const piece of a.stream) {
        buf += piece;
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) { await flush(buf.slice(0, nl)); buf = buf.slice(nl + 1); }
      }
      await flush(buf);
      return this.local(question, typed, drawn ? `There's ${subject}.` : "I couldn't draw that just now. Try again in a moment.");
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      return this.local(question, typed, "I couldn't draw that just now. Try again in a moment.");
    }
  }

  private async magnify(question: string, typed: boolean) {
    const tab = await activeTab();
    const at = await this.pointerAndViewport();
    const shot = tab ? await screenshot(tab, 4000) : null;
    if (!shot || !at) return this.local(question, typed, "I couldn't take a closer look just now.");
    const bmp = await createImageBitmap(await (await fetch(shot.dataUrl)).blob());
    const sx = bmp.width / at.vp.width, sy = bmp.height / at.vp.height;
    const w = 220 * sx, h = 140 * sy;
    const x = Math.max(0, Math.min(bmp.width - w, at.p.x * sx - w / 2)), y = Math.max(0, Math.min(bmp.height - h, at.p.y * sy - h / 2));
    const c = new OffscreenCanvas(Math.round(w * 2.5 / sx), Math.round(h * 2.5 / sy));
    const g = c.getContext("2d")!;
    g.imageSmoothingQuality = "high";
    g.drawImage(bmp, x, y, w, h, 0, 0, c.width, c.height);
    const blob = await c.convertToBlob({ type: "image/png" });
    const url = await new Promise<string>((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.readAsDataURL(blob); });
    return this.local(question, typed, "Here's a closer look.", { image: url });
  }

  private async copyPageText(question: string, typed: boolean) {
    const pt = await this.agent({ kind: "wisp", op: "page-text" });
    if (!pt) return this.local(question, typed, "I couldn't read the page just now.");
    if (!pt.text?.trim()) return this.local(question, typed, "I didn't find any text on the page.");
    await navigator.clipboard.writeText(pt.text).catch(() => {});
    const n = pt.text.split("\n").length;
    return this.local(question, typed, `Copied the text on the page, ${n} line${n === 1 ? "" : "s"}. Paste it anywhere.`);
  }

  private async writingHelp(question: string, typed: boolean, selection: string, signal: AbortSignal) {
    this.ui.caption("Working on it…");
    try {
      const a = await complete(this.settings, WRITING_SYSTEM, writingUserText(question, selection), signal);
      let out = "";
      for await (const piece of a.stream) out += piece;
      const text = cleanedWriting(out.replace(/<think>[\s\S]*?<\/think>/gi, ""));
      await navigator.clipboard.writeText(text).catch(() => {});
      const card = { title: isSummaryRequest(question) ? "Summary" : "Your text", lines: text.split("\n") };
      if (isSummaryRequest(question) && text.length <= 900) return this.local(question, typed, text.replace(/^[•\-*]\s*/gm, ""), { card });
      return this.local(question, typed, "Done. It's on your clipboard, ready to paste.", { card });
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      return this.local(question, typed, "I couldn't do that just now. Try again in a moment.");
    }
  }

  earcon(kind: "start" | "stop") { if (this.settings.earcons) earcon(kind); }
}

async function readClipboard(): Promise<string | undefined> {
  try {
    const ok = await chrome.permissions.contains({ permissions: ["clipboardRead"] }) || await chrome.permissions.request({ permissions: ["clipboardRead"] });
    if (!ok) return undefined;
    return (await navigator.clipboard.readText()).trim() || undefined;
  } catch { return undefined; }
}

// ── Timers (chrome.alarms; the service worker speaks and notifies when one fires) ──
export interface WispTimer { id: string; due: number; label?: string; seconds: number }
async function timers(): Promise<WispTimer[]> { return ((await chrome.storage.local.get("wisp.timers"))["wisp.timers"] as WispTimer[]) ?? []; }
async function saveTimers(t: WispTimer[]) { await chrome.storage.local.set({ "wisp.timers": t }); }
async function addTimer(seconds: number, label?: string, due = Date.now() + seconds * 1000) {
  const t: WispTimer = { id: crypto.randomUUID(), due, label, seconds };
  await saveTimers([...(await timers()), t]);
  await chrome.alarms.create(`wisp-timer:${t.id}`, { when: due });
  return t;
}

async function runTimer(c: NonNullable<ReturnType<typeof timerCommand>>): Promise<string> {
  const now = Date.now();
  const live = (await timers()).filter((t) => t.due > now).sort((a, b) => a.due - b.due);
  if (c.kind === "set") {
    if (c.seconds < 1 || c.seconds > 86400) return "I can set timers from a second up to a day.";
    await addTimer(c.seconds, c.label);
    return c.label ? `Okay, I'll remind you to ${c.label} in ${spokenDuration(c.seconds)}.` : `Timer set for ${spokenDuration(c.seconds)}.`;
  }
  if (c.kind === "at") {
    const d = new Date(); d.setHours(c.hour, c.minute, 0, 0);
    const tomorrow = d.getTime() <= now;
    if (tomorrow) d.setDate(d.getDate() + 1);
    await addTimer(Math.round((d.getTime() - now) / 1000), c.label, d.getTime());
    const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    return `Okay, I'll remind you${tomorrow ? " tomorrow" : ""} at ${time}${c.label ? ` to ${c.label}` : ""}.`;
  }
  if (c.kind === "cancel") {
    if (!live.length) return "You don't have any timers or reminders.";
    for (const t of live) await chrome.alarms.clear(`wisp-timer:${t.id}`);
    await saveTimers([]);
    return live.length === 1 ? "Cancelled." : `Cancelled all ${live.length}.`;
  }
  if (c.kind === "snooze") {
    const fired = ((await chrome.storage.local.get("wisp.lastTimer"))["wisp.lastTimer"] as WispTimer | undefined);
    if (!fired) return "There's nothing to snooze right now.";
    await chrome.storage.local.remove("wisp.lastTimer");
    await addTimer(c.seconds, fired.label);
    return `Okay, again in ${spokenDuration(c.seconds)}.`;
  }
  if (c.kind === "extend") {
    const next = live[0];
    if (!next) return "You don't have a timer running.";
    next.due += c.seconds * 1000;
    await saveTimers(live);
    await chrome.alarms.create(`wisp-timer:${next.id}`, { when: next.due });
    return `Added ${spokenDuration(c.seconds)}. ${spokenDuration((next.due - now) / 1000)} left.`;
  }
  const next = live[0];
  if (!next) return "You don't have any timers running.";
  const left = spokenDuration((next.due - now) / 1000);
  return next.label ? `${left} until I remind you to ${next.label}.` : `${left} left on your timer.`;
}
