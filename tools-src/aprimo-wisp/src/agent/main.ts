// Aprimo Wisp page agent (content script, top frame of *.aprimo.com). Answers snapshot requests from the side
// panel, draws what the model points at, watches the user do each walkthrough step (Wisp's GuideSession), and records
// clicks while the user teaches a feature.
import type { GuideAction } from "../core/guide";
import type { Target } from "../core/reply-parser";
import type { AgentEvent, AgentRequest, DrawCommand, PlanStep } from "../shared/messages";
import { Overlay } from "./overlay";
import { findByDescriptor, rectOf, resolve, type Known } from "./resolve";
import { cleanSelection, describe, lastPointer, mask, snapshot } from "./snapshot";

(() => {
  if (window.top !== window || (window as any).__aprimoWisp) return;
  (window as any).__aprimoWisp = true;

  let known = new Map<string, Known>();
  let overlay: Overlay | null = null;
  let savedLook: Record<string, unknown> = {};
  const ov = () => { if (!overlay) { overlay = new Overlay(); overlay.setLook(savedLook); } return overlay; };
  const send = (e: AgentEvent) => chrome.runtime.sendMessage(e).catch(() => {});

  const getter = (t: Target): (() => DOMRect | null) => {
    if (t.kind === "point") return () => new DOMRect(t.x - 12, t.y - 12, 24, 24);
    if (t.kind === "rect") return () => new DOMRect(t.x, t.y, t.w, t.h);
    const k = known.get(t.id);
    return () => { const el = resolve(k); return el ? rectOf(el) : null; };
  };
  const elementOf = (t?: Target) => (t?.kind === "element" ? resolve(known.get(t.id)) : null);

  function draw(cmd: DrawCommand) {
    const o = ov();
    if (cmd.kind === "shape") {
      o.add(cmd.shape, [getter(cmd.target)], cmd.label);
      elementOf(cmd.target)?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    } else if (cmd.kind === "arrow") o.add("ARROW", [getter(cmd.from), getter(cmd.to)], cmd.label);
    else if (cmd.kind === "path") o.add("PATH", cmd.targets.map(getter), cmd.label);
    else o.addStrokes(cmd.strokes, cmd.label);
  }

  // ── Planned walkthroughs (STEP n/m lines: Next / Stop chip) ─────────────────
  let plan: PlanStep[] = [];
  let at = 0;
  let planTurn = "";
  let stepEl: Element | null = null;

  function showStep() {
    const o = ov();
    o.clearShapes();
    const s = plan[at];
    if (!s) { finishPlan(); return; }
    o.holdShapes = true;
    stepEl = elementOf(s.target);
    if (s.target) {
      if (s.target.kind === "element" && !stepEl) send({ kind: "wisp-event", op: "step-lost", turn: planTurn, index: s.index, text: s.text });
      else { o.add("POINT", [getter(s.target)]); stepEl?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
    }
    o.setChip({ label: `Step ${s.index} of ${s.total}`, text: s.text, last: at >= plan.length - 1, onNext: advance, onStop: stopPlan });
    o.setCaption(s.text, true);
  }
  function advance() {
    send({ kind: "wisp-event", op: "step-advanced", turn: planTurn, index: plan[at]?.index ?? 0 });
    at++;
    if (at >= plan.length) finishPlan(); else setTimeout(showStep, 350);
  }
  function finishPlan() { const o = ov(); o.holdShapes = false; o.clearAll(); plan = []; send({ kind: "wisp-event", op: "steps-finished", turn: planTurn }); }
  function stopPlan() { const o = ov(); o.holdShapes = false; o.clearAll(); plan = []; send({ kind: "wisp-event", op: "steps-stopped", turn: planTurn }); }

  // ── Guide watching (Wisp's GuideSession, one step at a time) ───────────────
  // Wisp waits for quiet (0.8 s after a click or key, 2 s after typing), then samples the screen until two samples
  // match. Here "the screen changed" means DOM mutations or a route change since the step was shown.
  interface Watch { turn: string; target?: Target; label?: string; actions: GuideAction[]; clicked: boolean; used: boolean; baseRoute: string; muts: number; lastInput: number; quiet: number; timer?: ReturnType<typeof setTimeout>; idle?: ReturnType<typeof setTimeout> }
  let watch: Watch | null = null;
  const mo = new MutationObserver((records) => {
    if (!watch) return;
    for (const r of records) if (!(r.target as Element).closest?.("#aprimo-wisp-overlay-host")) watch.muts += r.addedNodes.length + r.removedNodes.length + (r.type === "attributes" ? 0.2 : 0);
  });

  function startWatch(turn: string, target: Target | undefined, label: string | undefined, caption?: string) {
    stopWatch();
    watch = { turn, target, label, actions: [], clicked: false, used: false, baseRoute: location.hash, muts: 0, lastInput: 0, quiet: 800 };
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "aria-expanded", "aria-selected", "hidden"] });
    const o = ov();
    o.holdShapes = true;
    if (caption) o.setCaption(caption);
    o.setChip({ label: "Wisp is watching", text: "Do the step; Wisp will show the next one. Esc stops.", last: false, onStop: () => endWatch("button") });
    bumpIdle();
  }
  function bumpIdle() {
    if (!watch) return;
    clearTimeout(watch.idle);
    watch.idle = setTimeout(() => endWatch("idle"), 180_000);
  }
  function stopWatch() {
    if (!watch) return;
    clearTimeout(watch.timer); clearTimeout(watch.idle);
    mo.disconnect();
    watch = null;
    const o = ov();
    o.holdShapes = false;
    o.setChip(null);
  }
  function endWatch(reason: "esc" | "idle" | "button") {
    const turn = watch?.turn;
    stopWatch();
    ov().clearAll();
    if (turn) send({ kind: "wisp-event", op: "guide-stopped", turn, reason });
  }
  function noteAction(a: GuideAction, quietMs: number) {
    if (!watch) return;
    if (watch.actions.length < 16) watch.actions.push(a);
    if (a.kind === "click-target") { watch.clicked = true; watch.used = true; }
    if (a.kind === "key") watch.used = true;
    watch.lastInput = Date.now();
    watch.quiet = quietMs;
    bumpIdle();
    clearTimeout(watch.timer);
    watch.timer = setTimeout(settle, quietMs);
  }
  /** Samples every 350 ms, up to 14 times, until two samples in a row show no new mutations. */
  function settle() {
    const w = watch;
    if (!w) return;
    let last = w.muts, stable = 0, n = 0;
    const tick = () => {
      if (watch !== w) return;
      n++;
      if (w.muts - last < 1) stable++; else stable = 0;
      last = w.muts;
      if (stable >= 2 || n >= 14) {
        const changed = w.muts >= 3 || location.hash !== w.baseRoute;
        if (!w.used && !changed) return; // a stray click: keep waiting
        const ev: AgentEvent = { kind: "wisp-event", op: "guide-settled", turn: w.turn, actions: w.actions, clickedTarget: w.clicked, changed };
        stopWatch();
        ov().clearShapes();
        send(ev);
        return;
      }
      w.timer = setTimeout(tick, 350);
    };
    w.timer = setTimeout(tick, 350);
  }
  const near = (t: Target | undefined, x: number, y: number, el: Element | null) => {
    if (!t) return false;
    if (t.kind === "element") { const te = elementOf(t); return !!te && !!el && (te === el || te.contains(el) || el.contains(te)); }
    const cx = t.kind === "rect" ? t.x + t.w / 2 : t.x, cy = t.kind === "rect" ? t.y + t.h / 2 : t.y;
    if (t.kind === "rect" && x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h) return true;
    return Math.hypot(x - cx, y - cy) <= 70; // Wisp's clickReach
  };

  document.addEventListener("click", (e) => {
    const target = e.target instanceof Element ? e.target : null;
    if (target?.closest("#aprimo-wisp-overlay-host")) return;
    if (plan.length && stepEl && target && stepEl.contains(target) && !plan[at]?.until) advance();
    if (watch) {
      const el = target?.closest("a,button,[role],input,select,textarea,mat-option,[data-automation-id]") ?? target;
      const label = el ? describe(el).text || describe(el).aria : undefined;
      noteAction(near(watch.target, e.clientX, e.clientY, target) ? { kind: "click-target", label: watch.label ?? label } : { kind: "click-else", label }, 800);
    }
    if (recording) recordClick(e);
  }, true);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && (watch || plan.length)) { if (watch) endWatch("esc"); else stopPlan(); return; }
    if (!watch) return;
    const mod = e.ctrlKey || e.altKey || e.metaKey;
    if (!mod && e.key.length === 1) { noteAction({ kind: "typing" }, 2000); return; }
    const named = e.key === "Enter" ? "Return" : e.key === "Tab" ? "Tab" : e.key.startsWith("Arrow") ? "an arrow key" : null;
    const name = named ?? `${e.ctrlKey ? "Control-" : ""}${e.altKey ? "Option-" : ""}${e.shiftKey ? "Shift-" : ""}${e.metaKey ? "Command-" : ""}${e.key.length === 1 ? e.key.toUpperCase() : "a key"}`;
    if (!mod && !named) { noteAction({ kind: "typing" }, 2000); return; }
    noteAction({ kind: "key", name }, 800);
  }, true);

  let lastRoute = location.hash;
  const onRoute = () => {
    if (location.hash === lastRoute) return;
    lastRoute = location.hash;
    send({ kind: "wisp-event", op: "page-changed", route: location.hash });
    const s = plan[at];
    if (s?.until) {
      const m = s.until.match(/^hash\s*~\s*(.+)$/i);
      if (!m || location.hash.toLowerCase().includes(m[1].trim().toLowerCase())) advance();
    }
    if (watch) noteAction({ kind: "page-changed", route: location.hash }, 800);
    if (recording) send({ kind: "wisp-event", op: "recorded-action", at: (Date.now() - recordStart) / 1000, route: location.hash, action: "opened page", title: document.title });
  };
  addEventListener("hashchange", onRoute);
  setInterval(onRoute, 700); // Aprimo also changes routes without hashchange events
  document.addEventListener("mousemove", (e: MouseEvent) => overlay?.setPointer({ x: e.clientX, y: e.clientY }), { passive: true });

  // ── Recording clicks to teach a feature ────────────────────────────────────
  let recording = false;
  let recordStart = 0;
  function recordClick(e: MouseEvent) {
    const t = e.target as Element | null;
    const el = t?.closest("a,button,[role],input,select,textarea,mat-option,mat-select,[data-automation-id],[tabindex]") ?? t;
    if (!el || el.closest("#aprimo-wisp-overlay-host")) return;
    const d = describe(el);
    send({ kind: "wisp-event", op: "recorded-action", at: (Date.now() - recordStart) / 1000, route: location.hash, action: d.role === "input" ? "clicked into" : "clicked", target: d, title: document.title });
  }
  document.addEventListener("change", (e) => {
    if (!recording) return;
    const el = e.target as Element;
    const d = describe(el);
    send({ kind: "wisp-event", op: "recorded-action", at: (Date.now() - recordStart) / 1000, route: location.hash, action: el.tagName === "SELECT" ? "chose an option in" : "filled in", target: d, title: document.title });
  }, true);

  /** The page's readable text (selection first), for "read this page" and "copy the text on the page". */
  function pageText(max = 60000): { text: string; selection: boolean } {
    const sel = String(getSelection()?.toString() ?? "").trim();
    if (sel) return { text: cleanSelection(sel, max), selection: true };
    const main = document.querySelector("main, [role=main], .main-content, mat-sidenav-content") as HTMLElement | null;
    const raw = (main ?? document.body).innerText ?? "";
    const text = mask(raw.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n")).slice(0, max);
    return { text, selection: false };
  }

  chrome.runtime.onMessage.addListener((msg: AgentRequest, _sender, sendResponse) => {
    if (msg?.kind !== "wisp") return;
    switch (msg.op) {
      case "ping": sendResponse({ ok: true }); return;
      case "snapshot": { const s = snapshot(msg.max); known = s.byId; sendResponse({ facts: s.facts }); return; }
      case "draw": draw(msg.cmd); sendResponse({ ok: true }); return;
      case "caption": ov().setCaption(msg.text, msg.hold ?? !msg.final, !msg.final); sendResponse({ ok: true }); return;
      case "clear": stopWatch(); ov().holdShapes = false; ov().clearAll(); plan = []; sendResponse({ ok: true }); return;
      case "companion": if (msg.state === "thinking") ov().summon(true); else overlay?.release(); sendResponse({ ok: true }); return;
      case "look": savedLook = { ...savedLook, ...msg.look }; overlay?.setLook(msg.look); sendResponse({ ok: true }); return;
      case "steps": planTurn = msg.turn; plan = msg.steps; at = 0; showStep(); sendResponse({ ok: true }); return;
      case "watch": startWatch(msg.turn, msg.target, msg.label, msg.caption); sendResponse({ ok: true }); return;
      case "watch-stop": stopWatch(); sendResponse({ ok: true }); return;
      case "page-text": sendResponse({ ...pageText(msg.max), pointer: lastPointer(), title: document.title }); return;
      case "record-start": recording = true; recordStart = Date.now(); ov().setCaption("Wisp is recording your clicks…", true); sendResponse({ ok: true, title: document.title, route: location.hash }); return;
      case "record-stop": recording = false; ov().setCaption(""); sendResponse({ ok: true }); return;
      case "navigate": if (/^#\//.test(msg.route)) location.hash = msg.route; sendResponse({ ok: true }); return;
    }
  });

  // Apply the saved companion look.
  const applyLook = (s: any) => {
    const look = { theme: s.cursorTheme, scale: s.cursorScale, outline: s.outline, reduceMotion: s.reduceMotion, captionSize: s.captionSize, captionPosition: s.captionPosition, showCaptions: s.showCaptions, keepOnScreen: s.keepOnScreen ?? false, idleOpacity: s.idleOpacity };
    const defined = Object.fromEntries(Object.entries(look).filter(([, v]) => v !== undefined));
    savedLook = defined;
    overlay?.setLook(defined);
    if (s.keepOnScreen) ov(); // the companion waits beside the pointer
  };
  chrome.storage.local.get("wisp.settings").then((r) => applyLook(r["wisp.settings"] ?? {})).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && changes["wisp.settings"]) applyLook(changes["wisp.settings"].newValue ?? {}); });

  // ── A Wisp button in Aprimo's top bar, next to Help ────────────────────────
  // Clicking it opens the Wisp panel and starts listening (like the shortcut). Aprimo re-renders its header, so the
  // button is put back whenever it goes missing.
  const BUTTON_ID = "aprimo-wisp-header-button";
  const findHelp = (): Element | null =>
    document.querySelector('app-header-button[title="Help"]') ??
    [...document.querySelectorAll("header button, mat-toolbar button, [role=banner] button, app-header button")].find((b) => /^help$/i.test((b.getAttribute("aria-label") || b.getAttribute("title") || "").trim())) ?? null;
  function placeButton() {
    if (document.getElementById(BUTTON_ID)) return;
    const help = findHelp();
    if (!help?.parentElement) return;
    const b = document.createElement("button");
    b.id = BUTTON_ID;
    b.type = "button";
    b.title = "Ask Aprimo Wisp (Alt+Shift+Space)";
    b.setAttribute("aria-label", "Ask Aprimo Wisp");
    b.style.cssText = "width:48px;height:48px;border:0;border-radius:50%;background:transparent;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0;margin:0;vertical-align:middle;transition:background-color .15s";
    b.addEventListener("mouseenter", () => { b.style.background = "rgba(0,0,0,.04)"; });
    b.addEventListener("mouseleave", () => { b.style.background = "transparent"; });
    // A small teal cursor: the same shape and colour as the companion that points on the page.
    b.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 2.5 L5 19.5 L9.4 15.3 L12.4 21.8 L15.2 20.6 L12.3 14.2 L18.6 14 Z" fill="#008080" stroke="#008080" stroke-width="1.2" stroke-linejoin="round"/></svg>';
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      chrome.runtime.sendMessage({ kind: "wisp-open", talk: true }).then((r) => {
        if (!r?.ok) ov().setCaption("Press Alt+Shift+Space to open Aprimo Wisp.");
      }).catch(() => ov().setCaption("Press Alt+Shift+Space to open Aprimo Wisp."));
    });
    help.parentElement.insertBefore(b, help);
  }
  placeButton();
  setInterval(placeButton, 1500);

  // Expose for tests in the fake-aprimo harness.
  (window as any).__aprimoWispDebug = { snapshot, findByDescriptor };
})();
