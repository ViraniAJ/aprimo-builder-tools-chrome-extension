// Brings an element into view by scrolling only the lists and menus that are meant to scroll (overflow auto or
// scroll), never Aprimo's own layout. Element.scrollIntoView also scrolls containers set to overflow: hidden and the
// page itself; on Aprimo that pushes the whole app (header and navigation included) out of place.
export function revealWithin(el: Element, block: "nearest" | "center" = "nearest") {
  const doc = el.ownerDocument;
  for (let p = el.parentElement; p && p !== doc.body && p !== doc.documentElement; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if (!(o === "auto" || o === "scroll" || o === "overlay") || p.scrollHeight <= p.clientHeight + 1) continue;
    const r = el.getBoundingClientRect(), b = p.getBoundingClientRect();
    const vh = doc.defaultView?.innerHeight ?? innerHeight;
    const top = Math.max(b.top, 0), bottom = Math.min(b.bottom, vh); // the part of the container on screen
    let delta = 0;
    if (block === "center") delta = r.top + r.height / 2 - (top + bottom) / 2;
    else if (r.top < top) delta = r.top - top - 8;
    else if (r.bottom > bottom) delta = r.bottom - bottom + 8;
    if (Math.abs(delta) >= 1) p.scrollTo({ top: p.scrollTop + delta, behavior: "smooth" });
  }
}
