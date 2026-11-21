// Draws Wisp's companion cursor, hand-drawn marks, captions and the walkthrough chip over the page. Everything lives
// in a closed shadow root on a fixed full-viewport layer with pointer-events: none (only the chip buttons take
// clicks). Marks follow their elements as the page scrolls or re-renders, and are drawn like a pen (Wisp's
// GesturePlanner): circles overshoot, underlines sag, arrows bow, drawings trace at a steady speed.
import { drawDuration, gestureArrow, gestureCircle, gestureUnderline, markDuration, smooth, strokeLength, type Pt, type Stroke } from "../core/drawing";

type Getter = () => DOMRect | null;
type Kind = "POINT" | "CIRCLE" | "UNDERLINE" | "ARROW" | "PATH" | "STROKES";
interface Item { kind: Kind; rects: Getter[]; label?: string; born: number; seed: number; strokes?: Stroke[]; els: SVGElement[] }

export interface CompanionLook {
  theme: string; // Wisp theme id
  scale: number; // 0.6–2
  outline: "white" | "black" | "none";
  reduceMotion: "system" | "on" | "off";
  captionSize: "small" | "medium" | "large";
  captionPosition: "pointer" | "bottom";
  showCaptions: boolean;
}

/** Wisp's companion themes: accent, secondary accent (the palette's two ends). */
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

const DEFAULT_LOOK: CompanionLook = { theme: "aprimo", scale: 1, outline: "white", reduceMotion: "system", captionSize: "medium", captionPosition: "pointer", showCaptions: true };
const CAPTION_SCALE = { small: 0.87, medium: 1, large: 1.3 };
const NS = "http://www.w3.org/2000/svg";

const CSS_TEXT = `
:host{all:initial}
.layer{position:fixed;inset:0;pointer-events:none;z-index:2147483646;font:400 14px/1.43 Roboto,"Helvetica Neue",Helvetica,Arial,sans-serif;letter-spacing:.25px;--a:#008080;--b:#4DB6AC}
svg.marks{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.cursor{position:absolute;width:30px;height:30px;margin:-4px 0 0 -8px;transform-origin:8px 4px;transition:left .45s cubic-bezier(.2,.8,.2,1),top .45s cubic-bezier(.2,.8,.2,1),opacity .3s;filter:drop-shadow(0 2px 5px rgba(0,0,0,.35))}
.reduce .cursor{transition:opacity .2s}
.tag{position:absolute;background:var(--a);color:#fff;padding:3px 10px;border-radius:16px;font-size:13px;font-weight:500;white-space:nowrap;transform:translate(16px,18px);box-shadow:0 1px 3px rgba(0,0,0,.2),0 2px 2px rgba(0,0,0,.14)}
.caption{position:absolute;max-width:min(560px,80vw);background:#323232;color:#fff;padding:10px 16px;border-radius:4px;box-shadow:0 3px 5px -1px rgba(0,0,0,.2),0 6px 10px 0 rgba(0,0,0,.14),0 1px 18px 0 rgba(0,0,0,.12);opacity:0;transition:opacity .25s}
.caption.bottom{left:50%;bottom:28px;transform:translateX(-50%)}
.caption.on{opacity:1}
.caption.partial{color:rgba(255,255,255,.7)}
.chip{position:absolute;top:16px;right:16px;max-width:360px;background:#fff;color:rgba(0,0,0,.87);border-radius:4px;padding:12px 16px;box-shadow:0 5px 5px -3px rgba(0,0,0,.2),0 8px 10px 1px rgba(0,0,0,.14),0 3px 14px 2px rgba(0,0,0,.12);pointer-events:auto}
.chip .n{font-size:12px;font-weight:500;color:var(--a);text-transform:uppercase;letter-spacing:1.25px}
.chip .t{margin:6px 0 10px;font-size:14px}
.chip button{font:inherit;font-size:13px;font-weight:500;letter-spacing:1.25px;text-transform:uppercase;border:0;background:transparent;color:var(--a);border-radius:4px;padding:5px 10px;margin-right:4px;cursor:pointer}
.chip button:hover{background:rgba(0,128,128,.08)}
.chip button.primary{background:var(--a);color:#fff;box-shadow:0 1px 3px rgba(0,0,0,.2),0 2px 2px rgba(0,0,0,.14)}
@keyframes pulse{0%{stroke-opacity:.95}50%{stroke-opacity:.5}100%{stroke-opacity:.95}}
.pulse{animation:pulse 1.4s ease-in-out infinite}
.reduce .pulse{animation:none}
`;

function cursorSVG(outline: CompanionLook["outline"]): string {
  const stroke = outline === "none" ? "none" : outline === "black" ? "#000" : "#fff";
  // Wisp's arrow silhouette: (0,0) (0.763,0.644) (0.295,0.644) (0,1), with a fluid two-accent fill.
  return `<svg viewBox="0 0 30 30" xmlns="${NS}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--a)"/><stop offset="1" style="stop-color:var(--b)"><animate attributeName="offset" values="1;.6;1" dur="4s" repeatCount="indefinite"/></stop></linearGradient></defs><path d="M4 2 L4 24 L9.6 18.6 L13.4 27 L17 25.4 L13.3 17.2 L21.4 17 Z" fill="url(#g)" stroke="${stroke}" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
}

const pathD = (s: Stroke) => s.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");

export class Overlay {
  private host: HTMLElement;
  private root: ShadowRoot;
  private layer: HTMLElement;
  private svg: SVGSVGElement;
  private cursor: HTMLElement;
  private tag: HTMLElement;
  private caption: HTMLElement;
  private chip: HTMLElement | null = null;
  private items: Item[] = [];
  private raf = 0;
  private captionTimer: ReturnType<typeof setTimeout> | undefined;
  private look: CompanionLook = { ...DEFAULT_LOOK };
  private lastPointer: Pt | null = null;
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
    this.cursor = document.createElement("div");
    this.cursor.className = "cursor";
    this.cursor.style.opacity = "0";
    this.cursor.style.left = `${innerWidth - 60}px`;
    this.cursor.style.top = `${innerHeight - 60}px`;
    this.tag = document.createElement("div");
    this.tag.className = "tag";
    this.tag.style.display = "none";
    this.caption = document.createElement("div");
    this.caption.className = "caption";
    this.layer.append(this.svg, this.cursor, this.tag, this.caption);
    this.root.append(style, this.layer);
    document.documentElement.appendChild(this.host);
    this.setLook(this.look);
  }

  setLook(look: Partial<CompanionLook>) {
    this.look = { ...this.look, ...look };
    const t = THEMES[this.look.theme] ?? THEMES.aurora;
    this.layer.style.setProperty("--a", t.a);
    this.layer.style.setProperty("--b", t.b);
    this.cursor.innerHTML = cursorSVG(this.look.outline);
    this.cursor.style.transform = `scale(${this.look.scale * 1.05})`;
    this.layer.classList.toggle("reduce", this.reduced());
    this.caption.style.fontSize = `${15 * CAPTION_SCALE[this.look.captionSize]}px`;
    this.caption.classList.toggle("bottom", this.look.captionPosition === "bottom");
  }

  private reduced() {
    return this.look.reduceMotion === "on" || (this.look.reduceMotion === "system" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  private ensureAttached() {
    if (!this.host.isConnected) document.documentElement.appendChild(this.host);
  }

  add(kind: Kind, rects: Getter[], label?: string) {
    this.ensureAttached();
    this.items.push({ kind, rects, label, born: performance.now(), seed: Math.floor(Math.random() * 1000), els: [] });
    if (!this.raf) this.loop();
  }

  /** Freehand strokes in viewport px (drawings and sketches), traced one after another. */
  addStrokes(strokes: Stroke[], label?: string) {
    this.ensureAttached();
    this.items.push({ kind: "STROKES", rects: [], strokes: strokes.map((s) => smooth(s)), label, born: performance.now(), seed: 0, els: [] });
    if (!this.raf) this.loop();
  }

  clearShapes() {
    for (const i of this.items) i.els.forEach((e) => e.remove());
    this.items = [];
    this.svg.replaceChildren();
    this.tag.style.display = "none";
    this.cursor.style.opacity = "0";
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
    if (this.look.captionPosition === "bottom") { this.caption.style.left = ""; this.caption.style.top = ""; return; }
    const p = this.lastPointer ?? { x: innerWidth / 2, y: innerHeight - 120 };
    const w = Math.min(560, innerWidth * 0.8);
    this.caption.style.left = `${Math.max(12, Math.min(p.x + 24, innerWidth - w - 12))}px`;
    this.caption.style.top = `${Math.max(12, Math.min(p.y + 34, innerHeight - 90))}px`;
  }

  /** Where captions follow when nothing is pointed at (the user's own pointer). */
  setPointer(p: Pt | null) { if (p && !this.items.length) this.lastPointer = p; }

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

  private loop = () => {
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      const now = performance.now();
      if (!this.holdShapes) {
        const keep = this.items.filter((i) => now - i.born < (i.kind === "STROKES" ? 20000 : 12000));
        for (const gone of this.items.filter((i) => !keep.includes(i))) gone.els.forEach((e) => e.remove());
        this.items = keep;
      }
      this.render(now);
      if (this.items.length) this.loop();
      else { this.svg.replaceChildren(); this.tag.style.display = "none"; this.cursor.style.opacity = "0"; }
    });
  };

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

  private render(now: number) {
    let pointerAt: { x: number; y: number; label?: string } | null = null;
    const reduce = this.reduced();
    for (const item of this.items) {
      const t = (now - item.born) / 1000;
      if (item.kind === "STROKES") {
        let start = 0;
        let tip: Pt | null = null;
        item.strokes!.forEach((s, i) => {
          const len = strokeLength(s), dur = reduce ? 0.01 : drawDuration(len);
          const prog = Math.max(0, Math.min(1, (t - start) / dur));
          this.pen(item, i, pathD(s), len, prog, 3);
          if (prog > 0 && prog < 1) tip = s[Math.min(s.length - 1, Math.floor(prog * (s.length - 1)))];
          start += dur + 0.12;
        });
        if (tip) pointerAt = { ...(tip as Pt) };
        continue;
      }
      const rs = item.rects.map((g) => g()).filter((r): r is DOMRect => !!r);
      if (!rs.length) continue;
      const r = rs[0];
      const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
      if (item.kind === "POINT") {
        let ring = item.els[0];
        if (!ring) {
          ring = document.createElementNS(NS, "rect");
          ring.setAttribute("rx", "8");
          ring.setAttribute("fill", "none");
          (ring as SVGElement).style.stroke = "var(--a)";
          ring.setAttribute("stroke-width", "2.5");
          ring.setAttribute("class", "pulse");
          item.els[0] = ring;
          this.svg.appendChild(ring);
        }
        const small = r.width <= 30 && r.height <= 30; // a bare point: no ring
        ring.setAttribute("x", String(r.x - 4)); ring.setAttribute("y", String(r.y - 4));
        ring.setAttribute("width", String(r.width + 8)); ring.setAttribute("height", String(r.height + 8));
        ring.setAttribute("opacity", small ? "0" : "1");
        pointerAt = { x: cx, y: cy, label: item.label };
      } else if (item.kind === "CIRCLE") {
        const s = gestureCircle({ x: r.x, y: r.y, w: r.width, h: r.height }, item.seed);
        const len = strokeLength(s);
        this.pen(item, 0, pathD(s), len, reduce ? 1 : Math.min(1, t / markDuration(len)));
        pointerAt ??= { x: s[0].x, y: s[0].y, label: item.label };
      } else if (item.kind === "UNDERLINE") {
        const s = gestureUnderline({ x: r.x, y: r.y + r.height + 3 }, { x: r.x + r.width, y: r.y + r.height + 3 });
        const len = strokeLength(s);
        this.pen(item, 0, pathD(s), len, reduce ? 1 : Math.min(1, t / markDuration(len)));
        pointerAt ??= { x: cx, y: r.y + r.height + 3, label: item.label };
      } else if (item.kind === "ARROW" && rs.length >= 2) {
        const a = { x: rs[0].x + rs[0].width / 2, y: rs[0].y + rs[0].height / 2 };
        const b = { x: rs[1].x + rs[1].width / 2, y: rs[1].y + rs[1].height / 2 };
        const strokes = gestureArrow(a, b);
        if (!strokes) continue;
        const len0 = strokeLength(strokes[0]), d0 = markDuration(len0);
        this.pen(item, 0, pathD(strokes[0]), len0, reduce ? 1 : Math.min(1, t / d0));
        this.pen(item, 1, pathD(strokes[1]), strokeLength(strokes[1]), reduce ? 1 : Math.max(0, Math.min(1, (t - d0) / 0.2)));
        pointerAt = { x: b.x, y: b.y, label: item.label };
      } else if (item.kind === "PATH" && rs.length >= 2) {
        const s = smooth(rs.map((q) => ({ x: q.x + q.width / 2, y: q.y + q.height / 2 })));
        const len = strokeLength(s);
        this.pen(item, 0, pathD(s), len, reduce ? 1 : Math.min(1, t / drawDuration(len)), 3);
      }
    }
    if (pointerAt) {
      this.lastPointer = pointerAt;
      this.cursor.style.opacity = "1";
      this.cursor.style.left = `${pointerAt.x}px`;
      this.cursor.style.top = `${pointerAt.y}px`;
      if (pointerAt.label) {
        this.tag.style.display = "block";
        this.tag.textContent = pointerAt.label;
        this.tag.style.left = `${Math.min(pointerAt.x, innerWidth - 220)}px`;
        this.tag.style.top = `${pointerAt.y}px`;
      } else this.tag.style.display = "none";
    }
  }
}
