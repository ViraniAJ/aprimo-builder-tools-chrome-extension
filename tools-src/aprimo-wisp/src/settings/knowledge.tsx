// The Knowledge tab: what Wisp knows and how to feed it more. Index the Aprimo help center with your sign-in, crawl
// any site, add single pages, upload files, link video demos with captions, and manage or export what you added.
import { useEffect, useRef, useState } from "react";
import { addDocs, exportDocs, kbStats, listDocs, removeDoc } from "../kb/kb-client";
import { HELP_CENTER, crawl, docId, fileToDocs, htmlToMarkdown, videoDoc } from "../kb/ingest";
import { deleteMedia } from "../kb/media";
import { videoLink } from "../kb/transcript";
import type { KnowledgeDoc, KnowledgeSource } from "../kb/types";
import { Button, Field, Progress, Section, inputCls } from "../ui/components";

const SOURCE_NAMES: Record<string, string> = { help: "Aprimo Help", crawl: "Crawled site", user: "Web page", file: "File", recording: "Recording", video: "Video", dev: "Developer docs" };

async function hostPermission(url: string): Promise<boolean> {
  const u = new URL(url);
  const origins = [`${u.protocol}//${u.hostname}/*`];
  return (await chrome.permissions.contains({ origins })) || chrome.permissions.request({ origins });
}

export function KnowledgeTab() {
  const [stats, setStats] = useState<{ bundled: { count: number; builtAt?: string }; user: number } | null>(null);
  const [docs, setDocs] = useState<any[]>([]);
  const [busy, setBusy] = useState<{ label: string; value: number; cancel?: () => void } | null>(null);
  const [msg, setMsg] = useState("");
  const [filter, setFilter] = useState("");

  const refresh = async () => { setStats(await kbStats()); setDocs(await listDocs()); };
  useEffect(() => {
    refresh().catch((e) => setMsg(`The knowledge index didn't load: ${e.message}`));
    // Knowledge added elsewhere (a Teach recording saved in the side panel, another Settings tab) shows up here too.
    const ch = new BroadcastChannel("wisp-kb");
    ch.onmessage = () => { refresh().catch(() => {}); };
    return () => ch.close();
  }, []);
  const recordings = docs.filter((d) => d.source === "recording");

  // Closing the page stops the crawl and the indexing, so ask first while either is running.
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    addEventListener("beforeunload", warn);
    return () => removeEventListener("beforeunload", warn);
  }, [!!busy]);

  const ingest = async (label: string, docsIn: KnowledgeDoc[]) => {
    if (!docsIn.length) { setMsg("Nothing readable was found."); return; }
    // Skip documents already indexed with the same text, so re-running after an interruption only redoes what's missing.
    const have = new Map((await listDocs()).map((d: any) => [d.id, d.textLength]));
    const fresh = docsIn.filter((d) => have.get(d.id) !== d.text.length);
    const kept = docsIn.length - fresh.length;
    const docsWord = (n: number) => `${n} document${n === 1 ? "" : "s"}`;
    if (!fresh.length) { setBusy(null); setMsg(`All ${docsWord(docsIn.length)} were already up to date.`); refresh(); return; }
    setBusy({ label: `Adding ${docsWord(fresh.length)} to Wspr's knowledge…`, value: 0 });
    await addDocs(fresh, (p) => setBusy({ label: `${label}: indexing ${p.done}/${p.total} documents…`, value: p.done / Math.max(1, p.total) }));
    setBusy(null);
    setMsg(`Added ${docsWord(fresh.length)}${kept ? `; ${docsWord(kept)} were already up to date` : ""}.`);
    refresh();
  };

  const runCrawl = async (o: { start: string; source: KnowledgeSource; maxPages: number; maxDepth: number; withCredentials?: boolean; prefixes?: string[] }) => {
    setMsg("");
    if (!(await hostPermission(o.start))) { setMsg("Wspr needs permission to read that site."); return; }
    const ctl = new AbortController();
    setBusy({ label: "Starting…", value: 0, cancel: () => ctl.abort() });
    try {
      const found = await crawl({ ...o, delayMs: 250, signal: ctl.signal, onPage: (i) => setBusy({ label: `Reading ${i.url} (${i.count} pages, ${i.queued} queued)${i.error ? ` – ${i.error}` : ""}`, value: i.count / o.maxPages, cancel: () => ctl.abort() }) });
      await ingest(o.source === "help" ? "Aprimo Help" : "Crawl", found);
    } catch (e) {
      setBusy(null);
      setMsg((e as Error).name === "AbortError" ? "Stopped." : (e as Error).message);
    }
  };

  const shown = docs.filter((d) => !filter || `${d.title} ${d.url}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <>
      <Section title="What Wspr knows">
        {stats ? (
          <ul className="space-y-1 text-sm">
            <li>Built in: Aprimo developer documentation and the DAM API reference, {stats.bundled.count.toLocaleString()} passages{stats.bundled.builtAt ? ` (built ${new Date(stats.bundled.builtAt).toLocaleDateString()})` : ""}.</li>
            <li>Added by you: {docs.length} document{docs.length === 1 ? "" : "s"}, {stats.user.toLocaleString()} passages, kept only in this browser.</li>
          </ul>
        ) : <div className="text-sm text-muted">Loading…</div>}
        {busy && (
          <div className="mt-3 space-y-1">
            <div className="truncate text-xs text-muted">{busy.label}</div>
            <Progress value={busy.value} />
            {busy.cancel && <Button small onClick={busy.cancel}>Stop</Button>}
          </div>
        )}
        {msg && <div className="mt-2 text-sm">{msg}</div>}
      </Section>

      <Section title="Aprimo Help">
        <p className="text-sm text-muted">help.aprimo.com asks you to sign in to Aprimo, so it can't be bundled. Sign in there in this browser, then index it here: Wspr reads it with your session and keeps the text only in this browser.</p>
        <div className="mt-2 flex gap-2">
          <Button onClick={() => chrome.tabs.create({ url: HELP_CENTER })}>Open Aprimo Help</Button>
          <Button kind="primary" disabled={!!busy} onClick={() => runCrawl({ start: HELP_CENTER, source: "help", maxPages: 600, maxDepth: 6, withCredentials: true, prefixes: ["https://help.aprimo.com/"] })}>Index Aprimo Help</Button>
        </div>
      </Section>

      <AddSources busy={!!busy} onCrawl={runCrawl} onDocs={ingest} setMsg={setMsg} />

      <Section title={`Your recordings (${recordings.length})`}>
        <p className="mb-2 text-xs text-muted">Made with Teach in the side panel (Wspr › ⋯ › Teach Wspr). Wspr uses the narration and your clicks when guiding, and offers the video when someone asks about it.</p>
        <div className="divide-y divide-line">
          {recordings.map((d) => (
            <div key={d.id} className="flex items-center gap-2 py-1.5 text-sm">
              <a className="flex min-w-0 flex-1 items-center gap-2 no-underline" href={videoLink(d.url)} target="_blank" rel="noreferrer" title="Play the recording">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-white"><svg width="12" height="12" viewBox="0 0 24 24"><path d="M7 4v16l13-8z" fill="currentColor" /></svg></span>
                <span className="truncate text-fg">{d.title}</span>
              </a>
              <span className="shrink-0 text-xs text-muted">{d.recipe?.length ? `${d.recipe.length} clicks` : ""}{d.recipe?.length && d.textLength ? " · " : ""}{d.textLength ? "narrated" : d.recipe?.length ? "" : "no narration or clicks"}</span>
              <span className="shrink-0 text-xs text-muted">{d.addedAt ? new Date(d.addedAt).toLocaleDateString() : ""}</span>
              <button className="shrink-0 rounded px-2 py-0.5 text-xs font-medium text-primary hover:bg-soft" title="Record it again; the new recording replaces this one" onClick={async () => {
                // Opening the side panel has to follow the click straight away; the panel switches to Teach when the
                // recording to replace is saved just after.
                const w = (await chrome.windows.getCurrent()).id;
                const opened = chrome.sidePanel.open({ windowId: w! });
                await chrome.storage.session.set({ "wisp.teachReplace": { id: d.id, title: d.title } });
                opened.then(() => setMsg(`Teach is open in the side panel: record “${d.title}” again and save to replace it.`)).catch(() => setMsg("Open Wspr's side panel (Wspr › ⋯ › Teach Wspr) to record the update; it will replace this recording."));
              }}>Update</button>
              <button className="shrink-0 rounded px-2 py-0.5 text-xs text-muted hover:bg-danger/10 hover:text-danger" title="Delete this recording" onClick={async () => {
                if (!confirm(`Delete the recording “${d.title}”? Wspr forgets what it learned from it, and the video is removed from this computer.`)) return;
                await removeDoc(d.id);
                await deleteMedia(String(d.url).slice(11));
                refresh();
              }}>Delete</button>
            </div>
          ))}
          {!recordings.length && <div className="py-2 text-sm text-muted">No recordings yet.</div>}
        </div>
      </Section>

      <Section title={`Your documents (${docs.length})`} right={
        <div className="flex gap-2">
          <Button small disabled={!docs.length} onClick={async () => {
            const all = await exportDocs();
            const blob = new Blob([JSON.stringify({ wispKnowledge: 1, docs: all }, null, 1)], { type: "application/json" });
            const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "aprimo-wisp-knowledge.wisp.json"; a.click();
          }}>Export knowledge pack</Button>
        </div>
      }>
        <p className="mb-2 text-xs text-muted">Share a knowledge pack with your team: they import it under “Upload files”. Recordings' videos stay on this computer; their transcripts and clicks travel in the pack.</p>
        {docs.length > 8 && <input className={inputCls + " mb-2"} placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />}
        <div className="max-h-96 divide-y divide-line overflow-y-auto">
          {shown.map((d) => (
            <div key={d.id} className="flex items-center gap-2 py-1.5 text-sm">
              <span className="w-24 shrink-0 text-xs text-muted">{SOURCE_NAMES[d.source] ?? d.source}</span>
              <a className="min-w-0 flex-1 truncate" href={d.video ? videoLink(d.url) : d.url} target="_blank" rel="noreferrer" title={d.url}>{d.title}</a>
              <span className="shrink-0 text-xs text-muted">{d.chunks ?? ""}</span>
              <button className="text-muted hover:text-danger" title="Remove" onClick={async () => {
                if (!confirm(`Remove “${d.title}” from Wspr's knowledge?`)) return;
                await removeDoc(d.id);
                if (String(d.url).startsWith("wisp-media:")) await deleteMedia(String(d.url).slice(11));
                refresh();
              }}>×</button>
            </div>
          ))}
          {!docs.length && <div className="py-2 text-sm text-muted">Nothing added yet.</div>}
        </div>
      </Section>
    </>
  );
}

function AddSources({ busy, onCrawl, onDocs, setMsg }: { busy: boolean; onCrawl: (o: { start: string; source: KnowledgeSource; maxPages: number; maxDepth: number; prefixes?: string[] }) => void; onDocs: (label: string, d: KnowledgeDoc[]) => Promise<void>; setMsg: (m: string) => void }) {
  const [site, setSite] = useState("");
  const [pages, setPages] = useState(100);
  const [urls, setUrls] = useState("");
  const [vTitle, setVTitle] = useState("");
  const [vUrl, setVUrl] = useState("");
  const [vCaptions, setVCaptions] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const addUrls = async () => {
    const list = urls.split(/\s+/).map((u) => u.trim()).filter((u) => /^https?:\/\//.test(u));
    if (!list.length) return;
    const out: KnowledgeDoc[] = [];
    for (const u of list) {
      try {
        if (!(await hostPermission(u))) continue;
        const res = await fetch(u, { credentials: "include" });
        const html = await res.text();
        const { title, markdown } = htmlToMarkdown(html, u);
        out.push({ id: docId("user", u), source: "user", title, url: u, text: markdown, addedAt: Date.now() });
      } catch (e) { setMsg(`${u}: ${(e as Error).message}`); }
    }
    await onDocs("Web pages", out);
    setUrls("");
  };

  return (
    <Section title="Add knowledge">
      <Field label="Crawl a site" help="Reads pages under the address you give (same folder and below), up to the page limit.">
        <div className="flex gap-2">
          <input className={inputCls} placeholder="https://community.example.com/aprimo/" value={site} onChange={(e) => setSite(e.target.value)} />
          <input className={inputCls + " w-24"} type="number" min={1} max={2000} value={pages} onChange={(e) => setPages(Number(e.target.value))} title="Page limit" />
          <Button kind="primary" disabled={busy || !/^https?:\/\//.test(site)} onClick={() => onCrawl({ start: site, source: "crawl", maxPages: pages, maxDepth: 4 })}>Crawl</Button>
        </div>
      </Field>
      <Field label="Add web pages" help="One address per line.">
        <textarea className={inputCls + " min-h-16"} value={urls} placeholder={"https://…\nhttps://…"} onChange={(e) => setUrls(e.target.value)} />
        <div className="mt-1"><Button disabled={busy || !urls.trim()} onClick={addUrls}>Add pages</Button></div>
      </Field>
      <Field label="Upload files" help="Markdown, text, HTML, PDF, captions (.vtt, .srt), or a Wspr knowledge pack (.wisp.json).">
        <input ref={fileRef} type="file" multiple accept=".md,.markdown,.txt,.html,.htm,.pdf,.vtt,.srt,.json" className="text-sm" onChange={async (e) => {
          const files = [...(e.target.files ?? [])];
          const out: KnowledgeDoc[] = [];
          for (const f of files) { try { out.push(...(await fileToDocs(f))); } catch (err) { setMsg(`${f.name}: ${(err as Error).message}`); } }
          await onDocs("Files", out);
          if (fileRef.current) fileRef.current.value = "";
        }} />
      </Field>
      <Field label="Link a video demo" help="Paste the video's captions (WebVTT or SRT) so Wspr can find the right moment and link to it. YouTube: ⋯ › Show transcript, or download the captions file.">
        <div className="space-y-2">
          <div className="flex gap-2">
            <input className={inputCls} placeholder="Title, e.g. Setting up a rule" value={vTitle} onChange={(e) => setVTitle(e.target.value)} />
            <input className={inputCls} placeholder="https://www.youtube.com/watch?v=…" value={vUrl} onChange={(e) => setVUrl(e.target.value)} />
          </div>
          <textarea className={inputCls + " min-h-20 font-mono text-xs"} placeholder={"WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nOpen Administration…"} value={vCaptions} onChange={(e) => setVCaptions(e.target.value)} />
          <Button disabled={busy || !vUrl || !vCaptions.trim()} onClick={async () => {
            try { await onDocs("Video", [videoDoc(vTitle || vUrl, vUrl, vCaptions)]); setVTitle(""); setVUrl(""); setVCaptions(""); } catch (e) { setMsg((e as Error).message); }
          }}>Add video</Button>
        </div>
      </Field>
      <p className="text-xs text-muted">To teach Wspr a feature by showing it, use the Teach tab in the Wspr panel: record your screen while you talk it through.</p>
    </Section>
  );
}
