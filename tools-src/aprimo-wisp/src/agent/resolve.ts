// Finds the element behind an id from the last snapshot. Aprimo (Angular) re-renders often, so when the original
// element is gone we look it up again: automation id first, then aria label + role, then visible text.
import type { Descriptor } from "../shared/messages";
import { describe } from "./snapshot";

export interface Known { el: WeakRef<Element>; desc: Descriptor; frame: Element | null }

function sameText(a?: string, b?: string) {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

export function findByDescriptor(desc: Descriptor, root: Document = document): Element | null {
  const live = (el: Element | null) => (el && el.isConnected && el.getBoundingClientRect().width > 0 ? el : null);
  if (desc.auto) {
    const hits = [...root.querySelectorAll(`[data-automation-id="${CSS.escape(desc.auto)}"]`)];
    const exact = hits.find((h) => sameText(describe(h).text, desc.text)) ?? (hits.length === 1 ? hits[0] : null);
    if (live(exact)) return exact;
  }
  if (desc.testid) { const el = root.querySelector(`[data-testid="${CSS.escape(desc.testid)}"]`); if (live(el)) return el; }
  const pool = [...root.querySelectorAll(desc.tag)].concat(desc.role ? [...root.querySelectorAll(`[role="${desc.role}"]`)] : []);
  if (desc.aria) { const el = pool.find((p) => sameText(p.getAttribute("aria-label") ?? p.getAttribute("title") ?? "", desc.aria)); if (live(el ?? null)) return el!; }
  if (desc.text) {
    const el = pool.find((p) => sameText(describe(p).text, desc.text)) ?? pool.find((p) => describe(p).text.toLowerCase().includes(desc.text.toLowerCase()));
    if (live(el ?? null)) return el!;
  }
  return null;
}

export function resolve(k: Known | undefined): Element | null {
  if (!k) return null;
  const el = k.el.deref();
  if (el && el.isConnected && el.getBoundingClientRect().width > 0) return el;
  const doc = (k.frame as HTMLIFrameElement | null)?.contentDocument ?? document;
  return findByDescriptor(k.desc, doc);
}

/** Viewport rectangle of an element, including the offset of the iframe it lives in. */
export function rectOf(el: Element): DOMRect {
  const r = el.getBoundingClientRect();
  let x = r.x, y = r.y;
  let win: Window | null = el.ownerDocument.defaultView;
  while (win && win !== window && win.frameElement) {
    const fr = win.frameElement.getBoundingClientRect();
    x += fr.x; y += fr.y;
    win = win.parent;
  }
  return new DOMRect(x, y, r.width, r.height);
}
