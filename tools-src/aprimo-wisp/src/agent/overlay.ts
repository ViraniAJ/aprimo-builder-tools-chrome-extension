// Wisp's companion, captions and walkthrough chip, drawn over the Aprimo page in a closed shadow root on a fixed,
// click-through layer (only the chip buttons take clicks).
//
// The companion behaves like Wisp's: when you ask, it appears beside your pointer; each visual in the answer is
// queued, and the companion flies to it on a gentle arc, then points (with a label) or traces the mark like a pen
// (Wisp's GesturePlanner: circles overshoot, underlines sag, arrows bow, drawings trace at a steady speed). Marks
// follow their elements as the page scrolls or re-renders. When it's done it flies back beside your pointer and fades
// (or stays there, faintly, with "Keep the companion on screen").
import { drawDuration, gestureArrow, gestureCircle, gestureUnderline, markDuration, smooth, strokeLength, type Pt, type Stroke } from "../core/drawing";

type Getter = () => DOMRect | null;
type Kind = "POINT" | "CIRCLE" | "UNDERLINE" | "ARROW" | "PATH" | "STROKES";
interface Item {
  kind: Kind;
  rects: Getter[];
  label?: string;
  seed: number;
  strokes?: Stroke[];
  els: SVGElement[];
  start: number | null; // when the companion arrived and drawing began (null: still queued or flying)
  added: number;
}

export interface CompanionLook {
  theme: string; // Wisp theme id
  scale: number; // 0.6–2
  outline: "white" | "black" | "none";
  reduceMotion: "system" | "on" | "off";
  captionSize: "small" | "medium" | "large";
  captionPosition: "pointer" | "bottom";
  showCaptions: boolean;
  keepOnScreen: boolean;
  idleOpacity: number; // 0.2–1, with keepOnScreen
  highlight: "circle" | "box"; // how a pointed-at control is marked: a hand-drawn circle, or an outlined box
}

/** Wisp's companion themes: accent, secondary accent (the palette's two ends), plus Aprimo teal. */
export const THEMES: Record<string, { name: string; a: string; b: string }> = {
  aprimo: { name: "Aprimo", a: "#008080", b: "#4DB6AC" },
  aurora: { name: "Aurora", a: "#2B6BFF", b: "#9BE832" },
  quasar: { name: "Quasar", a: "#C4248F", b: "#FF8A2A" },
  magma: { name: "Magma", a: "#E8452C", b: "#B4175F" },
  spice: { name: "Spice Latte", a: "#D9681A", b: "#8A3410" },
  storm: { name: "Storm", a: "#2F5BFF", b: "#8FC8FF" },
  lagoon: { name: "Lagoon", a: "#0FA9A0", b: "#1E66D9" },
  ember: { name: "Ember", a: "#E0457F", b: "#2FD9C0" },
  nebula: { name: "Nebula", a: "#7B2CFF", b: "#FF6A2B" },
  sunset: { name: "City Sunset", a: "#F06A1E", b: "#2EC4D6" },
  solar: { name: "Solar Flare", a: "#FF5A14", b: "#B0124E" },
  ametrine: { name: "Ametrine", a: "#8E1CFF", b: "#FFC43D" },
  forest: { name: "Forest", a: "#1E9A55", b: "#8ED65A" },
  rosegold: { name: "Rose Gold", a: "#D0607A", b: "#E9A56B" },
  graphite: { name: "Graphite", a: "#5B6B80", b: "#9AA7B8" },
};

const DEFAULT_LOOK: CompanionLook = { theme: "aprimo", scale: 1, outline: "white", reduceMotion: "system", captionSize: "medium", captionPosition: "pointer", showCaptions: true, keepOnScreen: false, idleOpacity: 0.85, highlight: "circle" };
const CAPTION_SCALE = { small: 0.87, medium: 1, large: 1.3 };
const NS = "http://www.w3.org/2000/svg";
const BESIDE = { x: 22, y: 26 }; // where the companion waits relative to the user's pointer
const POINT_HOLD = 0.7; // seconds the companion rests on a point before moving to the next queued visual
const LIFETIME = 12; // seconds a mark stays (unless a walkthrough holds it)

const CSS_TEXT = `
:host{all:initial}
.layer{position:fixed;inset:0;pointer-events:none;z-index:2147483646;font:400 14px/1.43 Roboto,"Helvetica Neue",Helvetica,Arial,sans-serif;letter-spacing:.25px;--a:#008080;--b:#4DB6AC}
svg.marks{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.cursor{position:absolute;left:0;top:0;width:30px;height:30px;margin:-3px 0 0 -6px;transform-origin:6px 3px;transition:opacity .35s;filter:drop-shadow(0 2px 5px rgba(0,0,0,.35));will-change:transform}
.cursor .body{transition:transform .2s}
.cursor.thinking .body{animation:think 1.2s ease-in-out infinite}
@keyframes think{0%,100%{transform:scale(1) rotate(0)}50%{transform:scale(1.12) rotate(-8deg)}}
.cursor.tap .body{animation:tap .45s ease-out}
@keyframes tap{0%{transform:scale(1)}40%{transform:scale(.82)}100%{transform:scale(1)}}
.ring{position:absolute;left:0;top:0;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:2px solid var(--a);opacity:0;pointer-events:none}
.ring.go{animation:ring .9s ease-out}
@keyframes ring{0%{opacity:.9;transform:scale(.3)}100%{opacity:0;transform:scale(1.6)}}
.reduce .cursor .body,.reduce .ring{animation:none!important}
.tag{position:absolute;left:0;top:0;background:var(--a);color:#fff;padding:3px 10px;border-radius:16px;font-size:13px;font-weight:500;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.2),0 2px 2px rgba(0,0,0,.14);opacity:0;transition:opacity .2s}
.tag.on{opacity:1}
.caption{position:absolute;max-width:min(560px,80vw);background:#323232;color:#fff;padding:10px 16px;border-radius:4px;box-shadow:0 3px 5px -1px rgba(0,0,0,.2),0 6px 10px 0 rgba(0,0,0,.14),0 1px 18px 0 rgba(0,0,0,.12);opacity:0;transition:opacity .25s}
.caption.bottom{left:50%!important;top:auto!important;bottom:28px;transform:translateX(-50%)}
.caption.on{opacity:1}
.caption.partial{color:rgba(255,255,255,.7)}
.chip{position:absolute;bottom:24px;right:24px;max-width:340px;background:#fff;color:rgba(0,0,0,.87);border-radius:4px;padding:12px 16px;box-shadow:0 5px 5px -3px rgba(0,0,0,.2),0 8px 10px 1px rgba(0,0,0,.14),0 3px 14px 2px rgba(0,0,0,.12);pointer-events:auto}
.chip .n{font-size:12px;font-weight:500;color:var(--a);text-transform:uppercase;letter-spacing:1.25px}
.chip .t{margin:6px 0 10px;font-size:14px}
.chip button{font:inherit;font-size:13px;font-weight:500;letter-spacing:1.25px;text-transform:uppercase;border:0;background:transparent;color:var(--a);border-radius:4px;padding:5px 10px;margin-right:4px;cursor:pointer}
.chip button:hover{background:rgba(0,128,128,.08)}
.chip button.primary{background:var(--a);color:#fff;box-shadow:0 1px 3px rgba(0,0,0,.2),0 2px 2px rgba(0,0,0,.14)}
@keyframes pulse{0%{stroke-opacity:.95}50%{stroke-opacity:.45}100%{stroke-opacity:.95}}
.pulse{animation:pulse 1.4s ease-in-out infinite}
.reduce .pulse{animation:none}
.spark{position:absolute;left:0;top:0;width:var(--s,12px);height:var(--s,12px);margin:calc(var(--s,12px)/-2) 0 0 calc(var(--s,12px)/-2);opacity:0;animation:spark var(--d,.75s) ease-out forwards}
.spark svg{display:block;width:100%;height:100%}
@keyframes spark{0%{opacity:1;transform:translate(var(--x0),var(--y0)) scale(.2) rotate(0)}55%{opacity:1}100%{opacity:0;transform:translate(var(--x1),var(--y1)) scale(1) rotate(100deg)}}
`;

function cursorSVG(outline: CompanionLook["outline"]): string {
  const stroke = outline === "none" ? "none" : outline === "black" ? "#000" : "#fff";
  // Wisp's arrow silhouette with a fluid two-accent fill; the hotspot is the tip (top left).
  return `<svg class="body" viewBox="0 0 30 30" xmlns="${NS}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--a)"/><stop offset="1" style="stop-color:var(--b)"><animate attributeName="offset" values="1;.55;1" dur="4s" repeatCount="indefinite"/></stop></linearGradient></defs><path d="M4 2 L4 24 L9.6 18.6 L13.4 27 L17 25.4 L13.3 17.2 L21.4 17 Z" fill="url(#g)" stroke="${stroke}" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
}

const pathD = (s: Stroke) => s.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
const center = (r: DOMRect): Pt => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

interface Flight { from: Pt; to: () => Pt | null; t0: number; dur: number; bend: number }

export class Overlay {
  private host: HTMLElement;
  private root: ShadowRoot;
  private layer: HTMLElement;
  private svg: SVGSVGElement;
  private cursor: HTMLElement;
  private ring: HTMLElement;
  private tag: HTMLElement;
  private caption: HTMLElement;
  private chip: HTMLElement | null = null;
  private items: Item[] = []; // drawn or drawing
  private queue: Item[] = []; // waiting for the companion
  private current: Item | null = null;
  private raf = 0;
  private captionTimer: ReturnType<typeof setTimeout> | undefined;
  private look: CompanionLook = { ...DEFAULT_LOOK };
  private userPointer: Pt | null = null;
  private pos: Pt = { x: innerWidth - 80, y: innerHeight - 80 };
  private visible = false;
  private flight: Flight | null = null;
  private idleSince = 0;
  private summoned = false; // a question is in progress
  holdShapes = false; // walkthroughs keep marks until the step changes

  constructor() {
    this.host = document.createElement("div");
    this.host.id = "aprimo-wisp-overlay-host";
    this.root = this.host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = CSS_TEXT;
    this.layer = document.createElement("div");
    this.layer.className = "layer";
    this.svg = document.createElementNS(NS, "svg");
    this.svg.setAttribute("class", "marks");
    this.ring = document.createElement("div");
    this.ring.className = "ring";
    this.cursor = document.createElement("div");
    this.cursor.className = "cursor";
    this.cursor.style.opacity = "0";
    this.tag = document.createElement("div");
    this.tag.className = "tag";
    this.caption = document.createElement("div");
    this.caption.className = "caption";
    this.layer.append(this.svg, this.ring, this.cursor, this.tag, this.caption);
    this.root.append(style, this.layer);
    document.documentElement.appendChild(this.host);
    this.setLook(this.look);
  }

  setLook(look: Partial<CompanionLook>) {
    this.look = { ...this.look, ...Object.fromEntries(Object.entries(look).filter(([, v]) => v !== undefined)) };
    const t = THEMES[this.look.theme] ?? THEMES.aprimo;
    this.layer.style.setProperty("--a", t.a);
    this.layer.style.setProperty("--b", t.b);
    this.cursor.innerHTML = cursorSVG(this.look.outline);
    this.layer.classList.toggle("reduce", this.reduced());
    this.caption.style.fontSize = `${15 * CAPTION_SCALE[this.look.captionSize]}px`;
    this.caption.classList.toggle("bottom", this.look.captionPosition === "bottom");
    if (this.look.keepOnScreen && this.userPointer) { this.visible = true; this.kick(); }
    this.place();
  }

  private reduced() {
    return this.look.reduceMotion === "on" || (this.look.reduceMotion === "system" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  private ensureAttached() {
    if (!this.host.isConnected) document.documentElement.appendChild(this.host);
  }

  private kick() { if (!this.raf) this.loop(); }

  // ── The companion ─────────────────────────────────────────────────────────
  private beside(): Pt {
    const p = this.userPointer ?? { x: innerWidth * 0.66, y: innerHeight * 0.6 };
    return { x: Math.min(innerWidth - 30, p.x + BESIDE.x), y: Math.min(innerHeight - 30, p.y + BESIDE.y) };
  }

  /** A question started: appear beside the user's pointer and look busy. */
  summon(thinking = true) {
    this.ensureAttached();
    this.summoned = true;
    if (!this.visible) { this.pos = this.beside(); this.visible = true; }
    this.cursor.classList.toggle("thinking", thinking);
    this.kick();
  }

  /** The answer finished: the companion goes back beside the pointer once its visuals are done. */
  release() {
    this.summoned = false;
    this.cursor.classList.remove("thinking");
    this.idleSince = performance.now();
    this.kick();
  }

  private flyTo(to: () => Pt | null, now: number) {
    const dest = to() ?? this.pos;
    const dist = Math.hypot(dest.x - this.pos.x, dest.y - this.pos.y);
    const dur = this.reduced() ? 0 : Math.min(0.95, Math.max(0.32, dist / 1300)) * 1000;
    this.flight = { from: { ...this.pos }, to, t0: now, dur, bend: (Math.random() < 0.5 ? -1 : 1) * Math.min(120, dist * 0.18) };
  }

  /** Where the companion goes for an item (its first point) and where it rests after (its anchor). */
  private startOf(item: Item): Pt | null {
    if (item.kind === "STROKES") return item.strokes?.[0]?.[0] ?? null;
    const rs = item.rects.map((g) => g()).filter((r): r is DOMRect => !!r);
    if (!rs.length) return null;
    if (item.kind === "POINT") return center(rs[0]);
    if (item.kind === "CIRCLE") return gestureCircle({ x: rs[0].x, y: rs[0].y, w: rs[0].width, h: rs[0].height }, item.seed)[0];
    if (item.kind === "UNDERLINE") return { x: rs[0].x, y: rs[0].y + rs[0].height + 3 };
    return center(rs[0]); // ARROW and PATH start at their first target
  }

  /** A burst of little four-point stars around a point (the header button's click). */
  sparkle(at: Pt, count = 10, spread = 48, size = 12) {
    if (this.reduced()) return;
    this.ensureAttached();
    const fills = ["var(--a)", "var(--b)", "#80CBC4", "#ffffff"];
    for (let i = 0; i < count; i++) {
      const s = document.createElement("div");
      s.className = "spark";
      const ang = (i / count) * Math.PI * 2 + Math.random() * 0.6;
      const dist = spread * (0.55 + Math.random() * 0.6);
      const sz = size * (0.6 + Math.random() * 0.7);
      s.style.setProperty("--s", `${sz.toFixed(1)}px`);
      s.style.setProperty("--d", `${(0.55 + Math.random() * 0.35).toFixed(2)}s`);
      s.style.setProperty("--x0", `${at.x}px`); s.style.setProperty("--y0", `${at.y}px`);
      s.style.setProperty("--x1", `${(at.x + Math.cos(ang) * dist).toFixed(1)}px`); s.style.setProperty("--y1", `${(at.y + Math.sin(ang) * dist).toFixed(1)}px`);
      const fill = fills[i % fills.length];
      s.innerHTML = `<svg viewBox="0 0 12 12"><path d="M6 0 L7.3 4.7 L12 6 L7.3 7.3 L6 12 L4.7 7.3 L0 6 L4.7 4.7 Z" fill="${fill}" stroke="${fill === "#ffffff" ? "var(--a)" : "none"}" stroke-width=".8"/></svg>`;
      this.layer.appendChild(s);
      setTimeout(() => s.remove(), 1000);
    }
  }

  setPointer(p: Pt | null) {
    if (!p) return;
    this.userPointer = p;
    if (this.look.keepOnScreen && !this.visible) { this.visible = true; this.pos = this.beside(); this.kick(); }
    if (this.visible && !this.flight && !this.current && !this.queue.length) this.kick();
  }

  // ── Visuals ───────────────────────────────────────────────────────────────
  add(kind: Kind, rects: Getter[], label?: string) {
    // "Circle" highlight style: a point at a control is drawn as the pen-traced circle (as in the intro). A bare spot
    // (no control, just a position) keeps the tap ring.
    if (kind === "POINT" && this.look.highlight === "circle") {
      const r = rects[0]?.();
      if (r && (r.width > 30 || r.height > 30)) kind = "CIRCLE";
    }
    this.enqueue({ kind, rects, label, seed: Math.floor(Math.random() * 1000), els: [], start: null, added: performance.now() });
  }

  /** Freehand strokes in viewport px (drawings and sketches), traced one after another. */
  addStrokes(strokes: Stroke[], label?: string) {
    this.enqueue({ kind: "STROKES", rects: [], strokes: strokes.map((s) => smooth(s)), label, seed: 0, els: [], start: null, added: performance.now() });
  }

  private enqueue(item: Item) {
    this.ensureAttached();
    this.cursor.classList.remove("thinking");
    if (!this.visible) { this.pos = this.beside(); this.visible = true; }
    this.queue.push(item);
    this.kick();
  }

  clearShapes() {
    for (const i of [...this.items, ...this.queue]) i.els.forEach((e) => e.remove());
    this.items = [];
    this.queue = [];
    this.current = null;
    this.flight = null;
    this.svg.replaceChildren();
    this.tag.classList.remove("on");
    this.idleSince = performance.now();
    this.kick();
  }

  clearAll() {
    this.clearShapes();
    this.setCaption("");
    this.setChip(null);
  }

  setCaption(text: string, hold = false, partial = false) {
    this.ensureAttached();
    clearTimeout(this.captionTimer);
    if (!this.look.showCaptions) text = "";
    this.caption.textContent = text;
    this.caption.classList.toggle("on", !!text);
    this.caption.classList.toggle("partial", partial);
    this.placeCaption();
    if (text && !hold) this.captionTimer = setTimeout(() => this.caption.classList.remove("on"), Math.min(12000, 2500 + text.length * 60));
  }

  private placeCaption() {
    if (this.look.captionPosition === "bottom") return;
    const p = this.visible ? this.pos : this.beside();
    const w = Math.min(560, innerWidth * 0.8);
    this.caption.style.left = `${Math.max(12, Math.min(p.x + 26, innerWidth - w - 12))}px`;
    const below = this.tag.classList.contains("on") ? 62 : 34; // under the label when one shows
    this.caption.style.top = `${Math.max(12, Math.min(p.y + below, innerHeight - 90))}px`;
  }

  setChip(step: { label: string; text: string; onNext?: () => void; onStop: () => void; last: boolean } | null) {
    this.chip?.remove();
    this.chip = null;
    if (!step) return;
    this.ensureAttached();
    const c = document.createElement("div");
    c.className = "chip";
    const n = document.createElement("div"); n.className = "n"; n.textContent = step.label;
    const t = document.createElement("div"); t.className = "t"; t.textContent = step.text;
    c.append(n, t);
    if (step.onNext) { const next = document.createElement("button"); next.className = "primary"; next.textContent = step.last ? "Done" : "Next"; next.onclick = step.onNext; c.append(next); }
    const stop = document.createElement("button"); stop.textContent = "Stop"; stop.onclick = step.onStop;
    c.append(stop);
    this.layer.appendChild(c);
    this.chip = c;
  }

  // ── Animation loop ────────────────────────────────────────────────────────
  private loop = () => {
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      const now = performance.now();
      const busy = this.tick(now);
      if (busy) this.loop();
    });
  };

  /** One frame. Returns whether anything is still moving or showing. */
  private tick(now: number): boolean {
    // Expire old marks.
    if (!this.holdShapes) {
      const keep = this.items.filter((i) => i === this.current || i.start === null || (now - i.start) / 1000 < LIFETIME + (i.kind === "STROKES" ? 8 : 0));
      for (const gone of this.items.filter((i) => !keep.includes(i))) gone.els.forEach((e) => e.remove());
      this.items = keep;
    }

    // The current item is done once its point has been held or its trace finished; then take the next.
    if (this.current && this.current.start !== null && (now - this.current.start) / 1000 >= this.durationOf(this.current)) {
      this.current = null;
      this.idleSince = now;
    }
    if (!this.current && !this.flight && this.queue.length) {
      const next = this.queue.shift()!;
      this.current = next;
      this.items.push(next);
      this.tag.classList.remove("on");
      this.flyTo(() => this.startOf(next), now);
    }

    // Fly.
    if (this.flight) {
      const f = this.flight;
      const t = f.dur ? Math.min(1, (now - f.t0) / f.dur) : 1;
      const dest = f.to() ?? this.pos;
      const k = ease(t);
      const mx = (f.from.x + dest.x) / 2, my = (f.from.y + dest.y) / 2;
      const dx = dest.x - f.from.x, dy = dest.y - f.from.y, len = Math.hypot(dx, dy) || 1;
      const cx = mx - (dy / len) * f.bend, cy = my + (dx / len) * f.bend; // arc control point
      const u = 1 - k;
      this.pos = { x: u * u * f.from.x + 2 * u * k * cx + k * k * dest.x, y: u * u * f.from.y + 2 * u * k * cy + k * k * dest.y };
      if (t >= 1) {
        this.flight = null;
        if (this.current && this.current.start === null) {
          this.current.start = now;
          if (this.current.kind === "POINT") this.tap();
        }
      }
    }

    // Draw marks; the companion follows the pen while tracing, or rests on its item.
    let tip: Pt | null = null;
    for (const item of this.items) {
      const r = this.drawItem(item, now);
      if (item === this.current && r) tip = r;
    }
    if (!this.flight && tip) this.pos = tip;

    // Idle: go back beside the user's pointer, then fade (unless kept on screen).
    const idle = !this.flight && !this.current && !this.queue.length;
    if (idle && this.visible) {
      const home = this.beside();
      if (!this.summoned && now - this.idleSince > (this.items.length ? 1600 : 400)) {
        this.pos = { x: this.pos.x + (home.x - this.pos.x) * 0.12, y: this.pos.y + (home.y - this.pos.y) * 0.12 };
        if (!this.look.keepOnScreen && Math.hypot(home.x - this.pos.x, home.y - this.pos.y) < 6 && now - this.idleSince > 2200) this.visible = false;
      } else if (this.summoned && !this.items.length) {
        this.pos = { x: this.pos.x + (home.x - this.pos.x) * 0.2, y: this.pos.y + (home.y - this.pos.y) * 0.2 };
      }
    }

    // Tag next to the companion while it rests on a labelled item.
    const labelled = this.current && this.current.start !== null && this.current.label ? this.current.label : "";
    if (labelled) {
      this.tag.textContent = labelled;
      this.tag.classList.add("on");
    } else if (idle) this.tag.classList.remove("on");

    this.place();
    if (this.caption.classList.contains("on")) this.placeCaption();
    const showing = this.visible || this.items.length > 0 || this.queue.length > 0;
    if (!showing) { this.svg.replaceChildren(); }
    return showing || this.look.keepOnScreen;
  }

  private place() {
    const opacity = !this.visible ? 0 : this.look.keepOnScreen && !this.summoned && !this.current && !this.flight ? this.look.idleOpacity : 1;
    this.cursor.style.opacity = String(opacity);
    this.cursor.style.transform = `translate(${this.pos.x}px, ${this.pos.y}px) scale(${this.look.scale * 1.05})`;
    this.tag.style.transform = `translate(${Math.min(this.pos.x + 20, innerWidth - 240)}px, ${this.pos.y + 22}px)`;
  }

  private tap() {
    this.cursor.classList.remove("tap");
    void this.cursor.offsetWidth;
    this.cursor.classList.add("tap");
    if (this.reduced()) return;
    this.ring.style.transform = `translate(${this.pos.x}px, ${this.pos.y}px)`;
    this.ring.classList.remove("go");
    void this.ring.offsetWidth;
    this.ring.classList.add("go");
  }

  private durationOf(item: Item): number {
    if (this.reduced()) return item.kind === "POINT" ? POINT_HOLD : 0.2;
    if (item.kind === "POINT") return POINT_HOLD;
    if (item.kind === "STROKES") return item.strokes!.reduce((s, st) => s + drawDuration(strokeLength(st)) + 0.12, 0);
    const rs = item.rects.map((g) => g()).filter((r): r is DOMRect => !!r);
    if (!rs.length) return 0.2;
    if (item.kind === "ARROW" && rs.length >= 2) { const a = gestureArrow(center(rs[0]), center(rs[1])); return a ? markDuration(strokeLength(a[0])) + 0.2 : 0.2; }
    if (item.kind === "PATH") return drawDuration(strokeLength(smooth(rs.map(center))));
    if (item.kind === "CIRCLE") return markDuration(strokeLength(gestureCircle({ x: rs[0].x, y: rs[0].y, w: rs[0].width, h: rs[0].height }, item.seed)));
    return markDuration(rs[0].width);
  }

  private pen(item: Item, i: number, d: string, len: number, progress: number, width = 3.5) {
    let el = item.els[i] as SVGPathElement | undefined;
    if (!el) {
      el = document.createElementNS(NS, "path");
      el.setAttribute("fill", "none");
      el.style.stroke = "var(--a)";
      el.setAttribute("stroke-width", String(width));
      el.setAttribute("stroke-linecap", "round");
      el.setAttribute("stroke-linejoin", "round");
      item.els[i] = el;
      this.svg.appendChild(el);
    }
    el.setAttribute("d", d);
    el.setAttribute("stroke-dasharray", `${len + 1}`);
    el.setAttribute("stroke-dashoffset", `${(len + 1) * (1 - progress)}`);
    return el;
  }

  /** Draws an item at its current progress; returns where the companion should be (pen tip or resting point). */
  private drawItem(item: Item, now: number): Pt | null {
    if (item.start === null) return null;
    const t = (now - item.start) / 1000;
    const reduce = this.reduced();
    const tipOf = (s: Stroke, p: number) => s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
    if (item.kind === "STROKES") {
      let start = 0;
      let tip: Pt | null = null;
      item.strokes!.forEach((s, i) => {
        const len = strokeLength(s), dur = reduce ? 0.01 : drawDuration(len);
        const prog = Math.max(0, Math.min(1, (t - start) / dur));
        this.pen(item, i, pathD(s), len, prog, 3);
        if (prog > 0) tip = tipOf(s, prog);
        start += dur + 0.12;
      });
      return tip;
    }
    const rs = item.rects.map((g) => g()).filter((r): r is DOMRect => !!r);
    if (!rs.length) return null;
    const r = rs[0];
    if (item.kind === "POINT") {
      let ring = item.els[0];
      if (!ring) {
        ring = document.createElementNS(NS, "rect");
        ring.setAttribute("rx", "6");
        ring.setAttribute("fill", "none");
        ring.style.stroke = "var(--a)";
        ring.setAttribute("stroke-width", "2.5");
        ring.setAttribute("class", "pulse");
        item.els[0] = ring;
        this.svg.appendChild(ring);
      }
      const small = r.width <= 30 && r.height <= 30; // a bare point: no outline
      ring.setAttribute("x", String(r.x - 4)); ring.setAttribute("y", String(r.y - 4));
      ring.setAttribute("width", String(r.width + 8)); ring.setAttribute("height", String(r.height + 8));
      ring.setAttribute("opacity", small ? "0" : String(Math.min(1, t * 4)));
      return center(r);
    }
    if (item.kind === "CIRCLE") {
      const s = gestureCircle({ x: r.x, y: r.y, w: r.width, h: r.height }, item.seed);
      const len = strokeLength(s), p = reduce ? 1 : Math.min(1, t / markDuration(len));
      this.pen(item, 0, pathD(s), len, p);
      return tipOf(s, p);
    }
    if (item.kind === "UNDERLINE") {
      const s = gestureUnderline({ x: r.x, y: r.y + r.height + 3 }, { x: r.x + r.width, y: r.y + r.height + 3 });
      const len = strokeLength(s), p = reduce ? 1 : Math.min(1, t / markDuration(len));
      this.pen(item, 0, pathD(s), len, p);
      return tipOf(s, p);
    }
    if (item.kind === "ARROW" && rs.length >= 2) {
      const strokes = gestureArrow(center(rs[0]), center(rs[1]));
      if (!strokes) return center(rs[1]);
      const len0 = strokeLength(strokes[0]), d0 = markDuration(len0);
      const p0 = reduce ? 1 : Math.min(1, t / d0);
      this.pen(item, 0, pathD(strokes[0]), len0, p0);
      this.pen(item, 1, pathD(strokes[1]), strokeLength(strokes[1]), reduce ? 1 : Math.max(0, Math.min(1, (t - d0) / 0.2)));
      return tipOf(strokes[0], p0);
    }
    if (item.kind === "PATH" && rs.length >= 2) {
      const s = smooth(rs.map(center));
      const len = strokeLength(s), p = reduce ? 1 : Math.min(1, t / drawDuration(len));
      this.pen(item, 0, pathD(s), len, p, 3);
      return tipOf(s, p);
    }
    return center(r);
  }
}
