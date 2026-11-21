// WebVTT / SRT parsing into transcript segments.
import type { TranscriptSegment } from "./types";

const ts = (s: string) => {
  const m = s.trim().replace(",", ".").match(/(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)/);
  return m ? (Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3])) : 0;
};

export function parseCaptions(text: string): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  const blocks = text.replace(/\r/g, "").split(/\n\n+/);
  for (const b of blocks) {
    const lines = b.split("\n").filter((l) => l.trim() && !/^WEBVTT|^NOTE|^\d+$/.test(l.trim()));
    const timeIdx = lines.findIndex((l) => l.includes("-->"));
    if (timeIdx < 0) continue;
    const [a, c] = lines[timeIdx].split("-->");
    const txt = lines.slice(timeIdx + 1).join(" ").replace(/<[^>]+>/g, "").trim();
    if (txt) out.push({ start: ts(a), end: ts(c.split(" ")[1] ?? c), text: txt });
  }
  // Merge consecutive duplicates (auto-captions repeat lines while scrolling).
  return out.filter((s, i) => i === 0 || s.text !== out[i - 1].text);
}

/** A link that opens the video at `sec`. Recordings stored in the extension open in Wisp's own player. */
export function videoLink(url: string, sec = 0): string {
  const t = Math.max(0, Math.floor(sec));
  if (url.startsWith("wisp-media:")) return chrome.runtime.getURL(`app/wisp/video.html?id=${encodeURIComponent(url.slice(11))}&t=${t}`);
  try {
    const u = new URL(url);
    if (/(^|\.)youtube\.com$/.test(u.hostname) || u.hostname === "youtu.be") { u.searchParams.set("t", `${t}s`); return u.toString(); }
    if (/(^|\.)vimeo\.com$/.test(u.hostname)) { u.hash = `t=${t}s`; return u.toString(); }
    u.hash = `t=${t}`;
    return u.toString();
  } catch { return url; }
}
