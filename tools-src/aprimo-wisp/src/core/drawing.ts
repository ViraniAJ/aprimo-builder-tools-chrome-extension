// Wisp's Drawing and GesturePlanner: built-in shapes drawn without the AI, free sketches from the drawing model,
// and the hand-drawn look of circles, underlines and arrows. Coordinates here are viewport CSS pixels.
import { norm } from "./intents";

export type Pt = { x: number; y: number };
export type Stroke = Pt[];

const DRAW_PREFIX = /^(?:wisp,? |hey wisp,? )?(?:can you |could you |please |now )*(?:draw|sketch|doodle)\s+(?:me\s+)?(?:an?\s+|the\s+|some\s+)?(?:big\s+|small\s+|little\s+|large\s+|nice\s+)?/;
const SUFFIX = "(?:\\s+(?:on|on my|on the)\\s+(?:the\\s+)?screen|\\s+here|\\s+for me|\\s+please)*$";
const NAMES: [string, string][] = [
  ["smiley face", "smiley"], ["smiley", "smiley"], ["happy face", "smiley"], ["smile", "smiley"], ["face", "smiley"],
  ["check mark", "check"], ["checkmark", "check"], ["tick", "check"], ["circle", "circle"], ["square", "square"],
  ["rectangle", "rectangle"], ["box", "square"], ["triangle", "triangle"], ["star", "star"], ["heart", "heart"],
  ["arrow", "arrow"], ["spiral", "spiral"], ["house", "house"], ["line", "line"],
];
export const isDrawRequest = (q: string) => /^(?:wisp,? |hey wisp,? )?(?:can you |could you |please |now )*(?:draw|sketch|doodle)\b/.test(norm(q));

export function builtInShape(q: string): string | null {
  const t = norm(q).replace(/[?.!]+$/, "");
  if (!isDrawRequest(t)) return null;
  const rest = t.replace(DRAW_PREFIX, "");
  for (const [name, shape] of NAMES) if (new RegExp(`^${name}${SUFFIX}`).test(rest)) return shape;
  return null;
}
export const shapeSpokenName = (s: string) => (s === "check" ? "check mark" : s === "smiley" ? "smiley face" : s);

const ellipse = (cx: number, cy: number, rx: number, ry: number, from: number, to: number, n: number): Stroke =>
  Array.from({ length: n + 1 }, (_, i) => { const a = from + ((to - from) * i) / n; return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) }; });

/** Strokes in a unit box (-1…1, y up). */
export function shapeStrokes(shape: string): Stroke[] {
  const P = (x: number, y: number) => ({ x, y });
  switch (shape) {
    case "circle": return [ellipse(0, 0, 1, 1, Math.PI / 2, Math.PI / 2 + 2 * Math.PI, 48)];
    case "square": return [[P(-1, 1), P(1, 1), P(1, -1), P(-1, -1), P(-1, 1)]];
    case "rectangle": return [[P(-1, 0.6), P(1, 0.6), P(1, -0.6), P(-1, -0.6), P(-1, 0.6)]];
    case "triangle": return [[P(0, 1), P(0.95, -0.75), P(-0.95, -0.75), P(0, 1)]];
    case "star": return [Array.from({ length: 11 }, (_, i) => { const a = Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 0.42 : 1; return P(r * Math.cos(a), r * Math.sin(a)); })];
    case "heart": return [Array.from({ length: 65 }, (_, i) => {
      const t = (i / 64) * 2 * Math.PI;
      const x = 16 * Math.sin(t) ** 3, y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
      return P(x / 17, (y + 2) / 17);
    })];
    case "smiley": return [
      ellipse(0, 0, 1, 1, Math.PI / 2, Math.PI / 2 + 2 * Math.PI, 48),
      ellipse(-0.35, 0.3, 0.1, 0.14, 0, 2 * Math.PI, 16),
      ellipse(0.35, 0.3, 0.1, 0.14, 0, 2 * Math.PI, 16),
      ellipse(0, -0.05, 0.55, 0.5, 1.15 * Math.PI, 1.85 * Math.PI, 24),
    ];
    case "check": return [[P(-0.9, 0), P(-0.3, -0.6), P(0.9, 0.8)]];
    case "arrow": return [[P(-1, 0), P(1, 0)], [P(0.5, 0.45), P(1, 0), P(0.5, -0.45)]];
    case "spiral": return [Array.from({ length: 97 }, (_, i) => { const t = i / 96, a = 6 * Math.PI * t, r = 0.08 + 0.92 * t; return P(r * Math.cos(a), r * Math.sin(a)); })];
    case "house": return [
      [P(-0.75, 0.1), P(-0.75, -0.9), P(0.75, -0.9), P(0.75, 0.1)],
      [P(-0.95, 0.05), P(0, 0.9), P(0.95, 0.05)],
      [P(-0.2, -0.9), P(-0.2, -0.35), P(0.2, -0.35), P(0.2, -0.9)],
    ];
    case "line": return [[P(-1, 0), P(1, 0)]];
  }
  return [];
}

/** Places unit-box strokes centred on a point (y flipped for the screen), clamped inside the viewport. */
export function placeShape(strokes: Stroke[], center: Pt, viewport: { width: number; height: number }, sizeCap = 170, frac = 0.2): Stroke[] {
  const size = Math.min(sizeCap, frac * viewport.height);
  const cx = Math.min(Math.max(center.x, size + 20), viewport.width - size - 20);
  const cy = Math.min(Math.max(center.y, size + 20), viewport.height - size - 20);
  return strokes.map((s) => s.map((p) => ({ x: cx + p.x * size, y: cy - p.y * size })));
}

// ── Free sketch ──
const NOT_SKETCH = [" around ", " under ", " underline", " over the ", " next to ", " pointing ", " arrow to ", " arrow at ", " circle the ", " on the button", " the title", " this button", " that button", " this text", " the text"];
export function isFreeSketch(q: string): boolean {
  const t = norm(q).replace(/[?.!]+$/, "");
  if (!isDrawRequest(t) || builtInShape(t)) return false;
  if (NOT_SKETCH.some((w) => ` ${t} `.includes(w))) return false;
  return !/ around (it|that)$/.test(t);
}
export function sketchSubject(q: string): string {
  const t = norm(q).replace(/[?.!]+$/, "")
    .replace(/^(?:wisp,? |hey wisp,? )?(?:can you |could you |please |now )*(?:draw|sketch|doodle)\s+(?:me\s+)?/, "")
    .replace(/(?:\s+(?:on|on my|on the)\s+(?:the\s+)?screen|\s+here|\s+for me|\s+please)+$/, "").trim();
  return t || "something nice";
}
export const SKETCH_SYSTEM =
  'You make simple line drawings, like a quick pen sketch. Reply with only the strokes, one per line, each a list of points "x,y x,y x,y ..." in a 100 by 100 box (x from the left, y from the top). Use 4 to 14 strokes and 3 to 30 points each, so the drawing is recognisable: the outline first, then the details. No words, no numbering, nothing else.';

export function parseStroke(line: string): Stroke | null {
  const pts: Stroke = [];
  for (const tok of line.trim().split(/[\s;]+/)) {
    const clean = tok.replace(/[^\d.,-]/g, "");
    const m = clean.match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/);
    if (!m) continue;
    const x = Number(m[1]), y = Number(m[2]);
    if (x < -5 || x > 105 || y < -5 || y > 105) continue;
    pts.push({ x, y });
    if (pts.length >= 60) break;
  }
  return pts.length >= 2 ? pts : null;
}
/** Sketch box (0…100, y down) to the screen, centred on a point. */
export function placeSketch(stroke: Stroke, center: Pt, viewport: { width: number; height: number }): Stroke {
  const size = Math.min(210, 0.26 * viewport.height);
  const cx = Math.min(Math.max(center.x, size + 20), viewport.width - size - 20);
  const cy = Math.min(Math.max(center.y, size + 20), viewport.height - size - 20);
  return stroke.map((p) => ({ x: cx + ((p.x - 50) / 50) * size, y: cy + ((p.y - 50) / 50) * size }));
}

// ── GesturePlanner: hand-drawn marks ──
export function gestureCircle(r: { x: number; y: number; w: number; h: number }, seed = 0, padding = 10): Stroke {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  // Wisp draws 1.48x the target, which suits buttons and links; on big targets (a card, a panel) that spills into
  // the neighbours, so the factor tapers to 1.18 by 240px (the oval then skims the corners).
  const k = (d: number) => 1.18 + 0.3 * Math.max(0, Math.min(1, (240 - d) / 180));
  const rx = Math.max((r.w / 2) * k(r.w) + padding * 0.5, 18), ry = Math.max((r.h / 2) * k(r.h) + padding * 0.5, 14);
  const phase = (seed % 7) * 0.9, start = 0.82 * Math.PI, sweep = -2.12 * Math.PI, n = 72;
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n, a = start + sweep * t, wob = 1 + 0.035 * Math.sin(3 * a + phase) + 0.05 * t;
    return { x: cx + rx * wob * Math.cos(a), y: cy - ry * wob * Math.sin(a) };
  });
}
export function gestureUnderline(a: Pt, b: Pt): Stroke {
  const [l, r] = a.x <= b.x ? [a, b] : [b, a];
  return Array.from({ length: 25 }, (_, i) => { const t = i / 24; return { x: l.x + (r.x - l.x) * t, y: l.y + (r.y - l.y) * t + 2.5 * Math.sin(Math.PI * t) }; });
}
export function gestureArrow(a: Pt, b: Pt): Stroke[] | null {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
  if (len < 8) return null;
  const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
  const shaft = Array.from({ length: 29 }, (_, i) => { const t = i / 28, bow = len * 0.06 * Math.sin(Math.PI * t); return { x: a.x + dx * t + nx * bow, y: a.y + dy * t + ny * bow }; });
  const head = Math.min(18, len * 0.3);
  const back = { x: b.x - ux * head, y: b.y - uy * head };
  return [shaft, [{ x: back.x + nx * head * 0.55, y: back.y + ny * head * 0.55 }, b, { x: back.x - nx * head * 0.55, y: back.y - ny * head * 0.55 }]];
}
/** Catmull-Rom through the points, 8 samples per segment. */
export function smooth(points: Stroke): Stroke {
  if (points.length < 3) return points;
  const out: Stroke = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(points.length - 1, i + 2)];
    for (let s = 0; s < 8; s++) {
      const t = s / 8, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  out.push(points[points.length - 1]);
  return out;
}
export const strokeLength = (s: Stroke) => s.reduce((n, p, i) => (i ? n + Math.hypot(p.x - s[i - 1].x, p.y - s[i - 1].y) : 0), 0);
/** Seconds per stroke: drawings at about 380 px/s, marks at about 650 px/s. */
export const drawDuration = (len: number) => Math.min(2.6, Math.max(0.6, len / 380));
export const markDuration = (len: number) => Math.min(1.6, Math.max(0.45, len / 650));
