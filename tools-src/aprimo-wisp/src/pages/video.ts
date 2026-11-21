// Plays a recording saved in Wisp's knowledge, starting at ?t= seconds, with its transcript and clicks alongside.
import { getMedia } from "../kb/media";
import { openDB, reqP } from "../kb/idb";
import { fmtTime } from "../kb/chunk";

const q = new URLSearchParams(location.search);
const id = q.get("id") ?? "";
const t = Number(q.get("t") ?? 0);
const video = document.getElementById("video") as HTMLVideoElement;
const title = document.getElementById("title")!;
const side = document.getElementById("side")!;

(async () => {
  const m = await getMedia(id);
  if (!m) { title.textContent = "This recording isn't in this browser."; return; }
  title.textContent = m.title;
  document.title = `${m.title} · Aprimo Wspr`;
  video.src = URL.createObjectURL(m.blob);
  video.addEventListener("loadedmetadata", () => { video.currentTime = Math.min(t, video.duration || t); video.play().catch(() => {}); }, { once: true });
  const db = await openDB();
  const doc: any = await reqP(db.transaction("docs").objectStore("docs").get(`recording:${id}`));
  const items: { at: number; text: string }[] = [
    ...((doc?.video?.segments ?? []) as { start: number; text: string }[]).map((s) => ({ at: s.start, text: s.text })),
    ...((doc?.recipe ?? []) as { at: number; action: string; target?: { role: string; text: string } }[]).map((r) => ({ at: r.at, text: `▸ ${r.action}${r.target ? ` ${r.target.role} “${r.target.text}”` : ""}` })),
  ].sort((a, b) => a.at - b.at);
  for (const it of items) {
    const row = document.createElement("button");
    row.className = "row";
    row.innerHTML = `<span class="ts">${fmtTime(it.at)}</span><span></span>`;
    (row.lastElementChild as HTMLElement).textContent = it.text;
    row.onclick = () => { video.currentTime = it.at; video.play().catch(() => {}); };
    side.appendChild(row);
  }
})();
