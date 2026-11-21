// The on-page Wspr bar: Wspr's chat as a small floating card at the bottom of the Aprimo page, like Siri, instead
// of Chrome's side panel. The card itself is an extension page (app/wisp/bar.html) in a transparent frame, so it
// has everything the side panel has (the AI providers, knowledge, speech, the walkthrough controller); this file
// only places that frame, sizes it to the card, shows and hides it, and keeps it out of screenshots.

const ORIGIN = new URL(chrome.runtime.getURL("")).origin;
const ID = "aprimo-wspr-bar";
let frame: HTMLIFrameElement | null = null;
let shown = false;
let ready = false;
let pending: Record<string, unknown>[] = [];

function post(msg: Record<string, unknown>) {
  if (frame?.contentWindow && ready) frame.contentWindow.postMessage({ wspr: true, ...msg }, ORIGIN);
  else pending.push(msg);
}

function ensure(): HTMLIFrameElement {
  if (frame?.isConnected) return frame;
  frame = document.createElement("iframe");
  frame.id = ID;
  frame.title = "Aprimo Wspr";
  frame.src = chrome.runtime.getURL("app/wisp/bar.html");
  frame.allow = "microphone; clipboard-read; clipboard-write";
  frame.setAttribute("allowtransparency", "true");
  // Bottom centre, above Aprimo's content and below Wspr's own cursor layer. Height follows the card.
  frame.style.cssText = [
    "position:fixed", "left:50%", "bottom:0", "transform:translate(-50%,24px)", "width:min(800px,100vw)",
    "height:0", "border:0", "background:transparent", "color-scheme:normal", "z-index:2147483645", "opacity:0",
    "pointer-events:none", "transition:opacity .22s ease,transform .32s cubic-bezier(.2,.9,.3,1.2)",
  ].join(";");
  ready = false;
  document.documentElement.appendChild(frame);
  return frame;
}

addEventListener("message", (e: MessageEvent) => {
  if (e.origin !== ORIGIN || !frame || e.source !== frame.contentWindow || !e.data?.wspr) return;
  const d = e.data;
  if (d.type === "ready") { ready = true; const q = pending; pending = []; q.forEach(post); }
  if (d.type === "size" && typeof d.height === "number") frame.style.height = `${Math.ceil(d.height)}px`;
  if (d.type === "hide") hideBar();
});

/** Shows the bar (creating it the first time) and optionally starts listening. A second call while it's open toggles
 * listening, like pressing the shortcut again. */
export function showBar(talk: boolean) {
  const f = ensure();
  if (shown) { post({ type: talk ? "toggle-talk" : "focus" }); return; }
  shown = true;
  f.style.display = "block";
  requestAnimationFrame(() => { f.style.opacity = "1"; f.style.transform = "translate(-50%,0)"; f.style.pointerEvents = "auto"; });
  post({ type: "show", talk });
}

export function hideBar() {
  if (!frame || !shown) return;
  shown = false;
  const f = frame;
  f.style.opacity = "0";
  f.style.transform = "translate(-50%,24px)";
  f.style.pointerEvents = "none";
  post({ type: "hidden" });
}

export const barShown = () => shown;

/** Hidden for a moment while Wspr takes a screenshot of the page. Returns whether it was visible. */
export function barForShot(hide: boolean): boolean {
  if (!frame || !shown) return false;
  frame.style.visibility = hide ? "hidden" : "visible";
  return true;
}
