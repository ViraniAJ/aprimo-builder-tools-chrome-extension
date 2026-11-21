// Pieces shared by the side panel and the on-page bar: opening settings inside Aprimo, and one answer as a card.
import { useMemo } from "react";
import { modelInfo } from "../core/catalog";
import type { ChatEntry } from "../core/controller";
import { activeTab, toTab } from "../core/turn";
import { videoLink } from "../kb/transcript";
import { Button, cx } from "../ui/components";

// Settings open inside Aprimo (Administration › Aprimo Wspr Settings) in the Aprimo tab of this window; a section
// such as "#ai" goes straight to that tab of the settings. Without an Aprimo tab, they open as a page of their own.
export const isAprimoShell = (u?: string) => !!u && /^https:\/\/[^/]+\.aprimo\.com\//i.test(u) && !/^https:\/\/[^/]+\.dam\.aprimo\.com\//i.test(u);
export const openSettings = async (hash = "") => {
  const section = hash.replace(/^#/, "");
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = isAprimoShell(active?.url) ? active : (await chrome.tabs.query({ currentWindow: true, url: "https://*.aprimo.com/*" })).find((t) => isAprimoShell(t.url));
  if (!tab?.id || !tab.url) { chrome.tabs.create({ url: chrome.runtime.getURL(`app/wisp/settings.html${hash}`) }); return; }
  const u = new URL(tab.url);
  await chrome.tabs.update(tab.id, { active: true, url: `${u.origin}${u.pathname}#/management/home?arm=wisp${section ? `&section=${section}` : ""}` });
};
export const sourceLabel: Record<string, string> = { dev: "Developer docs", help: "Aprimo Help", user: "Your articles", crawl: "Your sites", file: "Your files", recording: "Your recording", video: "Video demo" };

export function Entry({ e }: { e: ChatEntry }) {
  const r = e.result ?? {};
  const cited = useMemo(() => (r.notes ?? []).filter((n) => (r.cited ?? []).includes(n.id)), [r.notes, r.cited]);
  const shown = (e.say || "").replace(/\s*\[k\d+(?:\s*,\s*k\d+)*\]/gi, "");
  const go = async (route: string) => {
    if (!confirm(`Open ${route} in this Aprimo tab?`)) return;
    const t = await activeTab();
    if (t?.id) toTab(t.id, { kind: "wisp", op: "navigate", route }).catch(() => {});
  };
  return (
    <div className="space-y-1.5">
      {e.kind !== "guide" && <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-white">{e.question}</div>}
      <div className={cx("max-w-[95%] rounded-lg border border-line bg-white px-3 py-2 text-sm", r.error && "border-danger/40")}>
        {e.kind === "guide" && <div className="wisp-label mb-1 !text-[11px] text-primary">Next step</div>}
        {shown ? <div className="whitespace-pre-wrap">{shown}</div> : <div className="text-muted">{e.status || "…"}</div>}
        {e.card && (
          <div className="mt-2 rounded-lg border border-line bg-page p-2">
            <div className="mb-1 text-xs font-medium">{e.card.title}</div>
            {e.card.lines.map((l, i) => <div key={i} className="text-xs">{/^[•\-]/.test(l) || e.card!.lines.length < 2 ? l : `• ${l}`}</div>)}
          </div>
        )}
        {e.image && <img src={e.image} alt="A closer look" className="mt-2 w-full rounded-lg border border-line" />}
        {!!r.steps?.length && (
          <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-xs">{r.steps.map((s) => <li key={s.index}>{s.text}</li>)}</ol>
        )}
        {!!r.videos?.length && (
          <div className="mt-2 space-y-1">
            {r.videos.map((v, i) => {
              const note = r.notes?.find((n) => n.id === v.id);
              if (!note?.video) return null;
              return <a key={i} href={videoLink(note.video.url, v.at ?? note.video.start ?? 0)} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-xs">▶ {v.label || note.title}{v.at ? ` (${Math.floor(v.at / 60)}:${String(Math.floor(v.at % 60)).padStart(2, "0")})` : ""}</a>;
            })}
          </div>
        )}
        {r.nav && <div className="mt-2"><Button small onClick={() => go(r.nav!)}>Open that page</Button></div>}
        {!!cited.length && (
          <div className="mt-2 flex flex-wrap gap-1">
            {cited.map((n) => (
              <a key={n.id} href={n.video ? videoLink(n.video.url, n.video.start ?? 0) : n.url} target="_blank" rel="noreferrer" title={n.title}
                className="max-w-full truncate rounded-full bg-black/[.08] px-2.5 py-0.5 text-[12px] text-fg no-underline hover:bg-black/[.12]">
                <span className="text-muted">{sourceLabel[n.source] ?? n.source}:</span> {n.title.split(" > ").slice(-1)[0]}
              </a>
            ))}
          </div>
        )}
        {e.done && r.raw !== undefined && (
          <details className="mt-1.5 text-[11px] text-muted">
            <summary className="cursor-pointer select-none">Details</summary>
            <div className="mt-1">Topic: {r.topic || "–"} · Pointed: {r.pointed ? `yes${r.firstLabel ? ` (${r.firstLabel})` : ""}` : "no"}{r.stepsMore !== undefined ? ` · Steps: ${r.stepsMore ? "more" : "done"}` : ""}{r.pageTitle ? ` · Page: ${r.pageTitle}` : " · Not on an Aprimo page"}{r.shot ? " · Screenshot sent" : " · No screenshot"}</div>
            {r.pointNotes?.map((n) => <div key={n} className="mt-0.5 text-[#b26a00]">{n}</div>)}
            <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-page p-2 font-mono text-[11px] text-fg">{r.raw || "(empty reply)"}</pre>
          </details>
        )}
        {e.done && r.model && <div className="mt-1.5 text-[10px] text-muted">{r.provider === "local" ? "Offline model" : modelInfo(r.model).displayName}{r.firstTokenMs ? ` · ${(r.firstTokenMs / 1000).toFixed(1)} s to first words` : ""}</div>}
      </div>
    </div>
  );
}

