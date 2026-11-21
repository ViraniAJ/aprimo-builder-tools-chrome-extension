// Lists the visible controls on the page with short ids (e1, e2, …): the browser version of Wisp's accessibility
// tree. Same-origin iframes are included with their offsets. Input values are never read; text that looks like a
// secret is masked.
import type { PageElement, PageFacts } from "../core/prompt";
import type { Descriptor } from "../shared/messages";

const INTERACTIVE = [
  "a[href]", "button", "input:not([type=hidden])", "select", "textarea", "summary", "label[for]",
  "[role=button]", "[role=link]", "[role=menuitem]", "[role=menuitemcheckbox]", "[role=tab]", "[role=checkbox]", "[role=radio]",
  "[role=switch]", "[role=option]", "[role=treeitem]", "[role=combobox]", "[role=searchbox]", "[role=textbox]", "[role=gridcell]",
  "[contenteditable=true]", "[tabindex]:not([tabindex='-1'])", "[onclick]",
  "mat-expansion-panel-header", "mat-option", "mat-select", "mat-checkbox", "mat-slide-toggle", "mat-tab", ".mat-mdc-tab", "[mat-menu-item]",
].join(",");

const SECRET = /\b(eyJ[\w-]{10,}\.[\w-]+|[A-Za-z0-9+/]{32,}={0,2}|sk-[\w-]{10,}|bearer\s+\S+)\b/gi;
export const mask = (s: string) => s.replace(SECRET, "•••");
const clean = (s: string | null | undefined) => mask((s ?? "").replace(/\s+/g, " ").trim());

function roleOf(el: Element): string {
  const r = el.getAttribute("role");
  if (r) return r;
  const tag = el.tagName.toLowerCase();
  if (tag === "a") return "link";
  if (tag === "input") { const t = (el as HTMLInputElement).type; return t === "checkbox" || t === "radio" ? t : t === "button" || t === "submit" ? "button" : "input"; }
  if (tag === "select" || tag === "mat-select") return "select";
  if (tag === "textarea") return "input";
  if (tag === "mat-option") return "option";
  if (tag === "mat-checkbox") return "checkbox";
  if (tag.startsWith("h") && tag.length === 2) return "heading";
  if (tag === "mat-expansion-panel-header") return "section";
  return tag === "button" ? "button" : "control";
}

function labelOf(el: Element): string {
  const tag = el.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") {
    const i = el as HTMLInputElement;
    const lbl = i.id ? el.ownerDocument.querySelector(`label[for="${CSS.escape(i.id)}"]`)?.textContent : "";
    return clean(lbl || i.placeholder || el.getAttribute("aria-label") || i.name || "");
  }
  const text = clean(visibleText(el)).slice(0, 80);
  if (text) return text;
  // Icon-only controls: their tooltip or label, else the icon's name ("icon: help").
  const tip = el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("mattooltip") || el.getAttribute("ng-reflect-message") || "";
  if (tip) return clean(tip).slice(0, 80);
  const icon = clean(el.querySelector(ICON)?.textContent || el.querySelector(ICON)?.getAttribute("fonticon") || "");
  return icon ? `icon: ${icon.replace(/_/g, " ")}` : "";
}

// Material icon fonts render their names as text ("arrow_forward"); leave those out of labels.
const ICON = "mat-icon, .mat-icon, .material-icons, .material-icons-outlined, .material-symbols-outlined, .material-symbols-rounded, [fonticon], [data-mat-icon-name]";
function visibleText(el: Element): string {
  if (!el.querySelector(ICON)) return (el as HTMLElement).innerText ?? el.textContent ?? "";
  const copy = el.cloneNode(true) as Element;
  copy.querySelectorAll(ICON).forEach((i) => i.remove());
  return copy.textContent ?? "";
}

/** The title of the card, row or section a control sits in, for controls whose own label repeats ("GET STARTED"). */
const HEADING = "h1, h2, h3, h4, h5, [role=heading], legend, mat-card-title, [class*=card-title], [class*=-title], [class*=header]";
function contextOf(el: Element, label: string): string | undefined {
  let box: Element | null = el.parentElement;
  for (let depth = 0; box && depth < 8 && box !== document.body; depth++, box = box.parentElement) {
    if (box.matches("main, [role=main], mat-sidenav-content")) break;
    const h = [...box.querySelectorAll(HEADING)].find((x) => !x.contains(el) && clean(visibleText(x)));
    if (h) {
      const t = clean(visibleText(h)).slice(0, 60);
      return t.toLowerCase() !== label.toLowerCase() ? t : undefined;
    }
    if (box.matches("tr, [role=row]")) { const first = box.querySelector("td, [role=gridcell]"); const t = clean(first ? visibleText(first) : "").slice(0, 60); if (t && !first?.contains(el)) return t; }
  }
  return undefined;
}

export function describe(el: Element): Descriptor {
  return {
    tag: el.tagName.toLowerCase(),
    role: roleOf(el),
    text: labelOf(el),
    aria: clean(el.getAttribute("aria-label") || el.getAttribute("title") || "") || undefined,
    auto: el.getAttribute("data-automation-id") || el.closest("[data-automation-id]")?.getAttribute("data-automation-id") || undefined,
    testid: el.getAttribute("data-testid") || undefined,
    name: el.getAttribute("name") || undefined,
  };
}

function visible(el: Element, rect: DOMRect, vw: number, vh: number): boolean {
  if (rect.width < 4 || rect.height < 4) return false;
  if (rect.bottom < 0 || rect.right < 0 || rect.top > vh || rect.left > vw) return false;
  const st = getComputedStyle(el);
  if (st.visibility === "hidden" || st.display === "none" || Number(st.opacity) < 0.05) return false;
  return !el.closest("[aria-hidden=true], [hidden], .cdk-visually-hidden");
}

function regionOf(el: Element): string | undefined {
  if (el.closest("[role=dialog], mat-dialog-container, .cdk-overlay-pane")) return "dialog";
  if (el.closest("[role=menu], .mat-mdc-menu-panel, mat-menu")) return "menu";
  if (el.closest("nav, [role=navigation], mat-sidenav, .sidebar, aside")) return "nav";
  if (el.closest("header, [role=banner], mat-toolbar, .toolbar")) return "toolbar";
  return undefined;
}

function stateOf(el: Element): string | undefined {
  const a = (n: string) => el.getAttribute(n);
  const i = el as HTMLInputElement;
  if (el.tagName === "INPUT" && (i.type === "checkbox" || i.type === "radio")) return i.checked ? "checked" : "unchecked";
  if (a("aria-checked") === "true") return "checked";
  if (a("aria-checked") === "false") return "unchecked";
  if (a("aria-selected") === "true" || el.classList.contains("mat-mdc-tab-active") || el.classList.contains("active")) return "selected";
  if (a("aria-pressed") === "true") return "on";
  if (a("aria-expanded") === "true") return "expanded";
  if (a("aria-expanded") === "false") return "collapsed";
  return undefined;
}
const isDisabled = (el: Element) => (el as HTMLButtonElement).disabled === true || el.getAttribute("aria-disabled") === "true" || el.classList.contains("mat-mdc-button-disabled");

/** Wisp's cleanSelection: collapse whitespace, cut at a word, mark with " …". */
export function cleanSelection(s: string, max = 1200): string {
  const t = mask(s.replace(/\s+/g, " ").trim());
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut) + " …";
}

let pointer: { x: number; y: number } | undefined;
document.addEventListener("mousemove", (e: MouseEvent) => { pointer = { x: e.clientX, y: e.clientY }; }, { passive: true, capture: true });
export const lastPointer = () => pointer;

export interface Snapshot { facts: PageFacts; byId: Map<string, { el: WeakRef<Element>; desc: Descriptor; frame: Element | null }> }

export function snapshot(max = 150): Snapshot {
  const vw = innerWidth, vh = innerHeight;
  const candidates: { el: Element; rect: DOMRect; frame: Element | null; score: number }[] = [];
  const visit = (doc: Document, frame: Element | null, ox: number, oy: number) => {
    for (const el of doc.querySelectorAll(INTERACTIVE)) {
      if (el.closest("#aprimo-wisp-overlay-host")) continue;
      const r0 = el.getBoundingClientRect();
      const rect = new DOMRect(r0.x + ox, r0.y + oy, r0.width, r0.height);
      if (!visible(el, rect, vw, vh)) continue;
      // Skip elements fully nested inside another candidate with the same text (wrapper spans etc.).
      const text = labelOf(el);
      const aria = el.getAttribute("aria-label");
      if (!text && !aria && !el.getAttribute("data-automation-id") && !el.getAttribute("title")) continue;
      let score = 1;
      if (el.getAttribute("data-automation-id")) score += 2;
      if (regionOf(el) === "dialog") score += 3;
      if (text.length > 1 && text.length < 40) score += 1;
      candidates.push({ el, rect, frame, score });
    }
    for (const f of doc.querySelectorAll("iframe")) {
      try {
        const sub = (f as HTMLIFrameElement).contentDocument;
        if (!sub) continue;
        const fr = f.getBoundingClientRect();
        visit(sub, f, ox + fr.x, oy + fr.y);
      } catch { /* cross-origin frame */ }
    }
  };
  visit(document, null, 0, 0);

  // Drop parents whose only content is a child candidate with the same text.
  const set = new Set(candidates.map((c) => c.el));
  const kept = candidates.filter((c) => ![...set].some((o) => o !== c.el && c.el.contains(o) && labelOf(o) === labelOf(c.el)));
  kept.sort((a, b) => b.score - a.score || a.rect.y - b.rect.y || a.rect.x - b.rect.x);
  const chosen = kept.slice(0, max).sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);

  const byId: Snapshot["byId"] = new Map();
  const labelCount = new Map<string, number>();
  for (const c of chosen) { const l = labelOf(c.el).toLowerCase(); labelCount.set(l, (labelCount.get(l) ?? 0) + 1); }
  const elements: PageElement[] = chosen.map((c, i) => {
    const id = `e${i + 1}`;
    const desc = describe(c.el);
    byId.set(id, { el: new WeakRef(c.el), desc, frame: c.frame });
    return { id, role: desc.role, text: desc.text, aria: desc.aria, auto: desc.auto, state: stateOf(c.el), disabled: isDisabled(c.el) || undefined, x: c.rect.x, y: c.rect.y, w: c.rect.width, h: c.rect.height, region: regionOf(c.el), context: (labelCount.get(desc.text.toLowerCase()) ?? 0) > 1 || /^(get started|open|edit|view|more|details|select|go|learn more|icon: .*)$/i.test(desc.text) ? contextOf(c.el, desc.text) : undefined };
  });
  const under = pointer ? elements.filter((e) => pointer!.x >= e.x && pointer!.x <= e.x + e.w && pointer!.y >= e.y && pointer!.y <= e.y + e.h).sort((a, b) => a.w * a.h - b.w * b.h)[0] : undefined;
  const sel = String(getSelection()?.toString() ?? "");

  const host = location.hostname.toLowerCase();
  const headings = [...document.querySelectorAll("h1, h2, h3, [role=heading]")]
    .filter((h) => { const r = h.getBoundingClientRect(); return r.height > 0 && r.bottom > 0 && r.top < vh; })
    .map((h) => clean(h.textContent)).filter(Boolean).slice(0, 10);
  const crumbs = [...document.querySelectorAll("nav[aria-label*=readcrumb] a, nav[aria-label*=readcrumb] span, .breadcrumb a, .breadcrumb span, [data-automation-id*=breadcrumb]")]
    .map((b) => clean(b.textContent)).filter((t, i, a) => t && a.indexOf(t) === i).slice(0, 8);
  const dialog = document.querySelector("[role=dialog] h1, [role=dialog] h2, mat-dialog-container h1, mat-dialog-container h2, [mat-dialog-title]");

  return {
    byId,
    facts: {
      url: location.origin + location.pathname,
      title: document.title,
      route: location.hash,
      tenant: /\.aprimo\.com$/.test(host) ? host.split(".")[0] : null,
      area: /\.dam\.aprimo\.com$/.test(host) ? "dam" : /\.aprimo\.com$/.test(host) ? "marketing-ops" : "other",
      breadcrumbs: crumbs,
      dialog: dialog ? clean(dialog.textContent) : undefined,
      headings,
      viewport: { width: vw, height: vh },
      elements,
      truncated: Math.max(0, kept.length - chosen.length),
      selectedText: sel.trim() ? cleanSelection(sel) : undefined,
      pointer,
      underPointer: under?.id,
    },
  };
}
