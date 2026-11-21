// The intro that plays in the side panel when Wspr is opened with the header button or the shortcut: on a miniature
// Aprimo page, the cursor pops in with sparkles, points at the heading ("Ask me anything"), traces a hand-drawn
// circle around a card ("I'll show you where"), then the scene fades into the chat. About 3.5 s; a click skips it.
import { useEffect, useRef } from "react";

type Pt = { x: number; y: number };
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const arc = (a: Pt, b: Pt, bend: number, t: number): Pt => {
  const k = ease(clamp01(t)), u = 1 - k;
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
  const c = { x: mx - (dy / len) * bend, y: my + (dx / len) * bend };
  return { x: u * u * a.x + 2 * u * k * c.x + k * k * b.x, y: u * u * a.y + 2 * u * k * c.y + k * k * b.y };
};

/** A loose, slightly overshooting loop around a box, like Wspr's hand-drawn circles. */
function circlePath(r: DOMRect, pad = 10): string {
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2, rx = r.width / 2 + pad, ry = r.height / 2 + pad;
  const pts: string[] = [];
  for (let i = 0; i <= 44; i++) {
    const a = -Math.PI * 0.62 + (i / 44) * Math.PI * 2.12;
    const wobble = 1 + 0.035 * Math.sin(i * 0.9) + (i / 44) * 0.06;
    pts.push(`${i ? "L" : "M"}${(cx + Math.cos(a) * rx * wobble).toFixed(1)} ${(cy + Math.sin(a) * ry * wobble).toFixed(1)}`);
  }
  return pts.join(" ");
}

export function Intro({ onDone }: { onDone: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const scene = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const cursor = useRef<HTMLDivElement>(null);
  const tag = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const loop = useRef<SVGPathElement>(null);
  const sparks = useRef<HTMLDivElement>(null);
  const done = useRef(false);

  useEffect(() => {
    const finish = () => { if (!done.current) { done.current = true; onDone(); } };
    const box = scene.current!.getBoundingClientRect();
    const rel = (el: HTMLElement) => { const r = el.getBoundingClientRect(); return new DOMRect(r.x - box.x, r.y - box.y, r.width, r.height); };
    const h = rel(heading.current!), c = rel(card.current!);
    const start: Pt = { x: box.width - 26, y: 18 }; // where the header button would be
    const atHeading: Pt = { x: h.x + h.width * 0.55, y: h.y + h.height / 2 };
    const path = loop.current!;
    path.setAttribute("d", circlePath(c));
    const len = path.getTotalLength();
    path.style.strokeDasharray = `${len + 1}`;
    path.style.strokeDashoffset = `${len + 1}`;
    const loopStart = path.getPointAtLength(0);

    const spark = (at: Pt, n: number, spread: number, size: number) => {
      const fills = ["#008080", "#4DB6AC", "#80CBC4", "#ffffff"];
      for (let i = 0; i < n; i++) {
        const s = document.createElement("div");
        const ang = (i / n) * Math.PI * 2 + Math.random() * 0.6, dist = spread * (0.55 + Math.random() * 0.6), sz = size * (0.6 + Math.random() * 0.7);
        const fill = fills[i % fills.length];
        s.className = "wspr-spark";
        s.style.cssText = `--s:${sz.toFixed(1)}px;--d:${(0.55 + Math.random() * 0.35).toFixed(2)}s;--x0:${at.x}px;--y0:${at.y}px;--x1:${(at.x + Math.cos(ang) * dist).toFixed(1)}px;--y1:${(at.y + Math.sin(ang) * dist).toFixed(1)}px`;
        s.innerHTML = `<svg viewBox="0 0 12 12"><path d="M6 0 L7.3 4.7 L12 6 L7.3 7.3 L6 12 L4.7 7.3 L0 6 L4.7 4.7 Z" fill="${fill}" stroke="${fill === "#ffffff" ? "#008080" : "none"}" stroke-width=".8"/></svg>`;
        sparks.current?.appendChild(s);
        setTimeout(() => s.remove(), 1000);
      }
    };
    const showTag = (text: string | null, at?: Pt) => {
      const t = tag.current!;
      if (!text || !at) { t.style.opacity = "0"; return; }
      t.textContent = text;
      t.style.transform = `translate(${Math.min(at.x + 16, box.width - t.offsetWidth - 8)}px, ${at.y + 20}px)`;
      t.style.opacity = "1";
    };
    const tap = (at: Pt) => {
      const r = ring.current!;
      r.style.transform = `translate(${at.x}px, ${at.y}px)`;
      r.classList.remove("go"); void r.offsetWidth; r.classList.add("go");
    };

    // The timeline, in seconds.
    const T = { pop: 0, fly1: 0.45, point: 1.05, fly2: 1.65, trace: 2.15, out: 3.0, end: 3.45 };
    let fired = new Set<string>();
    const once = (k: string, f: () => void) => { if (!fired.has(k)) { fired.add(k); f(); } };
    let lastTrail = 0;
    const t0 = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      const s = (now - t0) / 1000;
      let p: Pt = start;
      if (s < T.fly1) p = start;
      else if (s < T.point) p = arc(start, atHeading, -40, (s - T.fly1) / (T.point - T.fly1));
      else if (s < T.fly2) p = atHeading;
      else if (s < T.trace) p = arc(atHeading, loopStart, 30, (s - T.fly2) / (T.trace - T.fly2));
      else {
        const k = clamp01((s - T.trace) / (T.out - T.trace - 0.15));
        const q = path.getPointAtLength(len * ease(k));
        p = { x: q.x, y: q.y };
        path.style.strokeDashoffset = `${(len + 1) * (1 - ease(k))}`;
      }
      const flying = (s >= T.fly1 && s < T.point) || (s >= T.fly2 && s < T.trace);
      if (flying && now - lastTrail > 55) { lastTrail = now; spark(p, 2, 14, 7); }
      once("pop", () => { spark(start, 12, 46, 12); cursor.current!.classList.add("pop"); });
      if (s >= T.point) once("point", () => { tap(atHeading); heading.current!.classList.add("hit"); });
      if (s >= T.point + 0.05 && s < T.fly2) showTag("Ask me anything", atHeading);
      if (s >= T.fly2 && s < T.trace) showTag(null);
      if (s >= T.trace + 0.1 && s < T.out) showTag("I'll show you where", p);
      if (s >= T.out) once("out", () => { showTag(null); spark(p, 10, 34, 10); root.current!.classList.add("leaving"); });
      cursor.current!.style.transform = `translate(${p.x}px, ${p.y}px)`;
      if (s >= T.end) { finish(); return; }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const skip = () => { if (!done.current) { done.current = true; onDone(); } };

  return (
    <div ref={root} className="wspr-intro" onClick={skip} role="presentation" aria-hidden="true">
      <style>{`
        .wspr-intro{position:fixed;inset:0;z-index:50;background:#fafafa;display:flex;flex-direction:column;cursor:pointer;transition:opacity .4s}
        .wspr-intro.leaving{opacity:0}
        .wspr-intro .scene{position:relative;flex:1;margin:56px 16px 0;overflow:visible}
        .wspr-intro .bar{height:36px;border-radius:4px 4px 0 0;background:#fff;border:1px solid rgba(0,0,0,.08);display:flex;align-items:center;justify-content:flex-end;gap:10px;padding:0 10px}
        .wspr-intro .dot{width:14px;height:14px;border-radius:50%;background:rgba(0,0,0,.08)}
        .wspr-intro .page{border:1px solid rgba(0,0,0,.08);border-top:0;background:#fafafa;padding:18px 14px 22px}
        .wspr-intro .h{display:inline-block;font:400 18px/1.3 Roboto,Arial,sans-serif;color:rgba(0,0,0,.87);padding:2px 6px;border-radius:6px;border:2px solid transparent;transition:border-color .25s}
        .wspr-intro .h.hit{border-color:#008080}
        .wspr-intro .cards{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:16px}
        .wspr-intro .card{background:#fff;border:1px solid rgba(0,0,0,.12);border-radius:4px;padding:10px;height:78px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between}
        .wspr-intro .line{height:8px;border-radius:4px;background:rgba(0,0,0,.1)}
        .wspr-intro .cta{font:500 10px/1 Roboto,Arial,sans-serif;letter-spacing:1.1px;color:#008080}
        .wspr-intro svg.marks{position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none}
        .wspr-intro .cursor{position:absolute;left:0;top:0;width:30px;height:30px;margin:-3px 0 0 -6px;filter:drop-shadow(0 2px 5px rgba(0,0,0,.35))}
        .wspr-intro .cursor svg{transform:scale(0)}
        .wspr-intro .cursor.pop svg{animation:wspr-pop .5s cubic-bezier(.3,1.7,.5,1) forwards}
        @keyframes wspr-pop{0%{transform:scale(0) rotate(-30deg)}100%{transform:scale(1) rotate(0)}}
        .wspr-intro .tag{position:absolute;left:0;top:0;background:#008080;color:#fff;padding:3px 10px;border-radius:16px;font:500 12px/1.5 Roboto,Arial,sans-serif;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.2);opacity:0;transition:opacity .2s}
        .wspr-intro .ring{position:absolute;left:0;top:0;width:40px;height:40px;margin:-20px 0 0 -20px;border-radius:50%;border:2px solid #008080;opacity:0}
        .wspr-intro .ring.go{animation:wspr-ring .9s ease-out}
        @keyframes wspr-ring{0%{opacity:.9;scale:.3}100%{opacity:0;scale:1.6}}
        .wspr-spark{position:absolute;left:0;top:0;width:var(--s);height:var(--s);margin:calc(var(--s)/-2) 0 0 calc(var(--s)/-2);opacity:0;pointer-events:none;animation:wspr-spark var(--d) ease-out forwards}
        .wspr-spark svg{display:block;width:100%;height:100%}
        @keyframes wspr-spark{0%{opacity:1;transform:translate(var(--x0),var(--y0)) scale(.2) rotate(0)}55%{opacity:1}100%{opacity:0;transform:translate(var(--x1),var(--y1)) scale(1) rotate(100deg)}}
        .wspr-intro .title{text-align:center;padding:0 24px 40px;font:400 14px/1.5 Roboto,Arial,sans-serif;color:rgba(0,0,0,.6)}
        .wspr-intro .title b{display:block;font:500 20px/1.4 Roboto,Arial,sans-serif;color:rgba(0,0,0,.87);margin-bottom:2px}
        .wspr-intro .skip{position:absolute;top:12px;right:14px;font:500 12px/1 Roboto,Arial,sans-serif;letter-spacing:1.1px;text-transform:uppercase;color:rgba(0,0,0,.45)}
      `}</style>
      <div className="skip">Skip</div>
      <div ref={scene} className="scene">
        <div className="bar"><span className="dot" /><span className="dot" /><span className="dot" /></div>
        <div className="page">
          <div ref={heading} className="h">Administration</div>
          <div className="cards">
            <div className="card"><div className="line" style={{ width: "80%" }} /><span className="cta">GET STARTED</span></div>
            <div ref={card} className="card"><div className="line" style={{ width: "65%" }} /><span className="cta">GET STARTED</span></div>
            <div className="card"><div className="line" style={{ width: "55%" }} /><span className="cta">GET STARTED</span></div>
            <div className="card"><div className="line" style={{ width: "70%" }} /><span className="cta">GET STARTED</span></div>
          </div>
        </div>
        <svg className="marks"><path ref={loop} fill="none" stroke="#008080" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
        <div ref={ring} className="ring" />
        <div ref={sparks} />
        <div ref={cursor} className="cursor">
          <svg viewBox="0 0 30 30"><defs><linearGradient id="wspr-intro-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#008080" /><stop offset="1" stopColor="#4DB6AC" /></linearGradient></defs><path d="M4 2 L4 24 L9.6 18.6 L13.4 27 L17 25.4 L13.3 17.2 L21.4 17 Z" fill="url(#wspr-intro-g)" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" /></svg>
        </div>
        <div ref={tag} className="tag" />
      </div>
      <div className="title"><b>Aprimo Wspr</b>Ask out loud or type. On an Aprimo page, I'll point to the right spot.</div>
    </div>
  );
}

/** Whether the intro should be skipped: Wspr's Reduce motion setting, or the system's when set to follow it. */
export const introReduced = (reduceMotion: "system" | "on" | "off") =>
  reduceMotion === "on" || (reduceMotion === "system" && matchMedia("(prefers-reduced-motion: reduce)").matches);
