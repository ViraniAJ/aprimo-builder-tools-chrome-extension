// Wisp's Notes, Timers, WebAction, WritingHelp and History, ported for the browser. Notes and history stay in
// chrome.storage.local and are never sent to the AI; timers run as chrome.alarms in the service worker.
import { norm, normP } from "./intents";

// ── Notes ────────────────────────────────────────────────────────────────────
export const NOTES_CAPACITY = 100;
export type NoteCommand = { kind: "add"; text: string } | { kind: "list" } | { kind: "forget"; topic: string } | { kind: "clear" };
const NOTE_LEADS = ["remember that ", "please remember that ", "note that ", "make a note that ", "make a note: ", "make a note ", "take a note: ", "take a note that ", "take a note ", "wisp, remember that ", "wisp remember that "];
export const toSecondPerson = (s: string) => s.replace(/\bmy\b/gi, "your").replace(/\bI am\b/g, "you are").replace(/\bI'm\b/g, "you're").replace(/\bI\b/g, "you");

export function noteCommand(q: string): NoteCommand | null {
  const t = normP(q);
  if (/^(?:wisp,? )?(?:clear|delete|forget|erase) (?:all )?(?:my |the |your )?notes$|^forget everything i (?:told|asked) you to remember$/.test(t)) return { kind: "clear" };
  const f = t.match(/^(?:wisp,? )?(?:forget|delete|remove) (?:the |my )?note (?:about|on|that says) (.+)$/);
  if (f) return { kind: "forget", topic: f[1] };
  if (/^(?:wisp,? )?(?:what are my notes|read (?:me )?my notes|show (?:me )?my notes|what did i (?:ask|tell) you to remember|what do you remember|my notes)$/.test(t)) return { kind: "list" };
  const raw = q.trim().replace(/[’]/g, "'");
  const lower = raw.toLowerCase();
  for (const lead of NOTE_LEADS) {
    if (lower.startsWith(lead)) {
      const body = raw.slice(lead.length).trim().replace(/[.!]+$/, "");
      if (body.split(/\s+/).length >= 2) return { kind: "add", text: toSecondPerson(body) };
      return null;
    }
  }
  return null;
}

export interface Note { text: string; at: number }
export async function loadNotes(): Promise<Note[]> { return ((await chrome.storage.local.get("wisp.notes"))["wisp.notes"] as Note[]) ?? []; }
export async function saveNotes(n: Note[]) { await chrome.storage.local.set({ "wisp.notes": n.slice(0, NOTES_CAPACITY) }); }

export async function runNoteCommand(c: NoteCommand): Promise<{ say: string; card?: { title: string; lines: string[] } }> {
  const notes = await loadNotes(); // newest first
  if (c.kind === "add") {
    await saveNotes([{ text: c.text, at: Date.now() }, ...notes]);
    return { say: `Okay, I'll remember that ${c.text}.` };
  }
  if (c.kind === "list") {
    if (!notes.length) return { say: "You haven't asked me to remember anything yet. Say “remember that…” and I will." };
    const first = notes.slice(0, 5).map((n) => n.text).join(". And: ");
    const more = notes.length > 5 ? ` There are ${notes.length - 5} more in the card.` : "";
    return { say: `You asked me to remember: ${first}.${more}`, card: notes.length > 1 ? { title: "Your notes", lines: notes.map((n) => n.text) } : undefined };
  }
  if (c.kind === "forget") {
    const words = toSecondPerson(c.topic).toLowerCase().split(/\s+/).filter(Boolean);
    const i = notes.findIndex((n) => words.every((w) => n.text.toLowerCase().includes(w)));
    if (i < 0) return { say: `I don't have a note about ${c.topic}.` };
    const [gone] = notes.splice(i, 1);
    await saveNotes(notes);
    return { say: `Okay, I've forgotten that ${gone.text}.` };
  }
  if (!notes.length) return { say: "There were no notes to forget." };
  await saveNotes([]);
  return { say: "Done. I've forgotten your notes." };
}

// ── Timers ───────────────────────────────────────────────────────────────────
export type TimerCommand =
  | { kind: "set"; seconds: number; label?: string }
  | { kind: "at"; hour: number; minute: number; label?: string }
  | { kind: "cancel" } | { kind: "status" } | { kind: "snooze"; seconds: number } | { kind: "extend"; seconds: number };

const NUMW: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, ninety: 90 };
export function timerNumber(raw: string): number | null {
  const s = raw.trim().toLowerCase().replace(/-/g, " ");
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  if (s === "half an" || s === "half a") return 0.5;
  if (s === "a couple of" || s === "a couple" || s === "couple of") return 2;
  if (s === "forty five") return 45;
  const parts = s.split(/\s+/);
  if (parts.length === 2 && parts[0] in NUMW && parts[1] in NUMW && NUMW[parts[0]] >= 20 && NUMW[parts[1]] < 10) return NUMW[parts[0]] + NUMW[parts[1]];
  return s in NUMW ? NUMW[s] : null;
}
const unitSecs = (u: string) => (u.startsWith("h") ? 3600 : u.startsWith("m") ? 60 : 1);
const cleanLabel = (l?: string) => l?.trim().replace(/[.!?]+$/, "").replace(/\bmy\b/gi, "your") || undefined;
const LEAD = "^(wisp,? |hey wisp,? |can you |could you |please )*";

export function parseClock(raw: string, now = new Date()): { hour: number; minute: number } | null {
  const m = raw.toLowerCase().replace(/[.\s]/g, "").match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (h > 23 || min > 59) return null;
  if (m[3]) { if (h === 12) h = 0; if (m[3] === "pm") h += 12; }
  else if (h <= 12) {
    // The next of h and h+12.
    const cand = [h % 24, (h + 12) % 24].map((hh) => { const d = new Date(now); d.setHours(hh, min, 0, 0); if (d <= now) d.setDate(d.getDate() + 1); return { hh, d }; });
    cand.sort((a, b) => a.d.getTime() - b.d.getTime());
    h = cand[0].hh;
  }
  return { hour: h, minute: min };
}

export function timerCommand(q: string, now = new Date()): TimerCommand | null {
  const t = q.trim().replace(/[’]/g, "'").replace(/[?!.]+$/, "");
  const i = "i";
  if (new RegExp("^(please )?(cancel|stop|delete|clear) (my |the |all (my |the )?)?(timers?|reminders?)$", i).test(t)) return { kind: "cancel" };
  if (new RegExp("^(how much time is left|how long is left|how long until my (timer|reminder)|what's left on my timer|time left)( on my timer)?$", i).test(t)) return { kind: "status" };
  if (new RegExp("^(please )?snooze( it)?$|^remind me again( later)?$", i).test(t)) return { kind: "snooze", seconds: 600 };
  let m = t.match(new RegExp("^(?:please )?snooze(?: it)? (?:for )?(?<n>[\\w.\\- ]+?) (?<u>seconds?|minutes?|mins?|hours?)$", i));
  if (m?.groups) { const n = timerNumber(m.groups.n); if (n !== null) return { kind: "snooze", seconds: Math.round(n * unitSecs(m.groups.u.toLowerCase())) }; }
  m = t.match(new RegExp("^(?:please )?add (?<n>[\\w.\\- ]+?) (?<u>seconds?|minutes?|mins?|hours?) (?:to|on) (?:my|the) timer$", i));
  if (m?.groups) { const n = timerNumber(m.groups.n); if (n !== null) return { kind: "extend", seconds: Math.round(n * unitSecs(m.groups.u.toLowerCase())) }; }
  const sets = [
    `${LEAD}(set|start) (a |an )?timer (for )?(?<n>[\\w.\\- ]+?) (?<u>seconds?|secs?|minutes?|mins?|hours?|hrs?)( called (?<label>.+))?$`,
    `${LEAD}(set|start) (a |an )?(?<n>[\\w.\\-]+)[ -](?<u>second|minute|hour)s? timer( (for|called) (?<label>.+))?$`,
    `${LEAD}timer (for )?(?<n>[\\w.\\- ]+?) (?<u>seconds?|minutes?|hours?)$`,
    `${LEAD}remind me in (?<n>[\\w.\\- ]+?) (?<u>seconds?|minutes?|mins?|hours?|hrs?)( to | that | about )(?<label>.+)$`,
    `${LEAD}remind me (to |that |about )(?<label>.+?) in (?<n>[\\w.\\- ]+?) (?<u>seconds?|minutes?|mins?|hours?|hrs?)$`,
  ];
  for (const p of sets) {
    const r = t.match(new RegExp(p, i));
    if (r?.groups) {
      const n = timerNumber(r.groups.n);
      if (n === null) continue;
      return { kind: "set", seconds: Math.round(n * unitSecs(r.groups.u.toLowerCase())), label: cleanLabel(r.groups.label) };
    }
  }
  const ats = [
    `${LEAD}remind me at (?<t>\\d{1,2}(:\\d{2})?\\s*(am|pm|a\\.m\\.|p\\.m\\.)?)( to | that | about )(?<label>.+)$`,
    `${LEAD}remind me (to |that |about )(?<label>.+?) at (?<t>\\d{1,2}(:\\d{2})?\\s*(am|pm|a\\.m\\.|p\\.m\\.)?)$`,
  ];
  for (const p of ats) {
    const r = t.match(new RegExp(p, i));
    if (r?.groups) { const c = parseClock(r.groups.t, now); if (c) return { kind: "at", ...c, label: cleanLabel(r.groups.label) }; }
  }
  return null;
}

export function spokenDuration(secs: number): string {
  const s = Math.max(0, Math.round(secs));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h} hour${h === 1 ? "" : "s"}`);
  if (m) parts.push(`${m} minute${m === 1 ? "" : "s"}`);
  if (r && !h) parts.push(`${r} second${r === 1 ? "" : "s"}`);
  return parts.join(" ") || "0 seconds";
}

// ── Web actions ──────────────────────────────────────────────────────────────
const SITE_SEARCH: Record<string, [string, string]> = {
  youtube: ["YouTube", "https://www.youtube.com/results?search_query="], instagram: ["Instagram", "https://www.instagram.com/explore/search/keyword/?q="],
  amazon: ["Amazon", "https://www.amazon.com/s?k="], reddit: ["Reddit", "https://www.reddit.com/search/?q="],
  wikipedia: ["Wikipedia", "https://en.wikipedia.org/w/index.php?search="], github: ["GitHub", "https://github.com/search?q="],
  "google maps": ["Google Maps", "https://www.google.com/maps/search/"], maps: ["Google Maps", "https://www.google.com/maps/search/"],
  twitter: ["X", "https://x.com/search?q="], x: ["X", "https://x.com/search?q="], spotify: ["Spotify", "https://open.spotify.com/search/"],
  linkedin: ["LinkedIn", "https://www.linkedin.com/search/results/all/?keywords="], netflix: ["Netflix", "https://www.netflix.com/search?q="],
  tiktok: ["TikTok", "https://www.tiktok.com/search?q="], pinterest: ["Pinterest", "https://www.pinterest.com/search/pins/?q="],
  google: ["Google", "https://www.google.com/search?q="],
  // Aprimo additions
  "aprimo developers": ["Aprimo Developers", "https://developers.aprimo.com/search?q="], "aprimo help": ["Aprimo Help", "https://help.aprimo.com/?q="],
};
const OPEN_SITES: Record<string, [string, string]> = {
  youtube: ["YouTube", "https://www.youtube.com"], google: ["Google", "https://www.google.com"], gmail: ["Gmail", "https://mail.google.com"],
  "google maps": ["Google Maps", "https://maps.google.com"], maps: ["Google Maps", "https://maps.google.com"], "google drive": ["Google Drive", "https://drive.google.com"],
  "google docs": ["Google Docs", "https://docs.google.com"], wikipedia: ["Wikipedia", "https://www.wikipedia.org"], amazon: ["Amazon", "https://www.amazon.com"],
  netflix: ["Netflix", "https://www.netflix.com"], github: ["GitHub", "https://github.com"], reddit: ["Reddit", "https://www.reddit.com"],
  facebook: ["Facebook", "https://www.facebook.com"], instagram: ["Instagram", "https://www.instagram.com"], linkedin: ["LinkedIn", "https://www.linkedin.com"],
  twitter: ["X", "https://x.com"], x: ["X", "https://x.com"], chatgpt: ["ChatGPT", "https://chatgpt.com"], claude: ["Claude", "https://claude.ai"],
  outlook: ["Outlook", "https://outlook.live.com"], spotify: ["Spotify", "https://open.spotify.com"], weather: ["the weather", "https://www.google.com/search?q=weather"],
  news: ["Google News", "https://news.google.com"],
  // Aprimo additions
  "aprimo help": ["Aprimo Help", "https://help.aprimo.com/"], "aprimo developers": ["Aprimo Developers", "https://developers.aprimo.com/"],
  "developer docs": ["Aprimo Developers", "https://developers.aprimo.com/"],
};
const enc = (q: string) => encodeURIComponent(q.trim().replace(/^["“”]+|["“”]+$/g, ""));
const SCREENY = [" this ", " it ", " that ", " button ", " menu ", " icon ", " setting ", " settings ", " tab ", " on screen ", " on the screen ", " on my screen ", " in this app ", " on this page ", " here "];

export interface WebAction { url: string; say: string }
export function webAction(question: string): WebAction | null {
  let t = question.trim().replace(/[’]/g, "'").replace(/^[\s?.!]+|[\s?.!]+$/g, "");
  t = t.replace(/^(?:hey wisp,? |wisp,? )?(?:can you |could you |please |go ahead and |would you )*/i, "").replace(/\s+(?:for me|please)$/i, "");
  t = t.replace(/^(?:open(?: up)? (?:the |my )?(?:web )?browser|go online|get online) and (?=(?:open|go to|search|look|find|google|pull up))/i, "");
  const lower = t.toLowerCase();
  const orig = (m: RegExpMatchArray, g: string) => { const v = m.groups![g]; const at = lower.indexOf(v); return at >= 0 ? t.slice(at, at + v.length) : v; };
  const siteRes = [
    /^(?:open(?: up)?|go to|pull up) (?:the )?(?<s>[a-z ]+?)(?: website| site| app)? and (?:search|look)(?: up)?(?: for)? (?<q>.+)$/,
    /^search (?:on )?(?<s>[a-z ]+?) for (?<q>.+)$/,
    /^(?:search|look) (?:up )?(?:for )?(?<q>.+?) on (?<s>[a-z ]+?)$/,
    /^find (?<q>.+?) on (?<s>[a-z ]+?)$/,
  ];
  for (const r of siteRes) {
    const m = lower.match(r);
    const site = m?.groups && SITE_SEARCH[m.groups.s.trim()];
    if (m && site) { const q = orig(m, "q"); return { url: site[1] + enc(q), say: `Here's ${site[0]} with results for ${q}.` }; }
  }
  const webRes = [
    /^(?:go online and |open (?:the |my )?browser and |open (?:safari|chrome) and )?(?:search|look)(?: up)? (?:online |the web |the internet |google |on google |on the web |on the internet )?for (?<q>.+)$/,
    /^(?:go online and |open (?:the |my )?browser and )search(?: up)? (?<q>.+)$/,
    /^search (?:online|the web|the internet|google|on google) (?:for )?(?<q>.+)$/,
    /^google (?<q>.+)$/,
    /^look up (?<q>.+?) (?:online|on the web|on the internet|on google)$/,
    /^find (?<q>.+?) (?:online|on the web|on the internet|on google)$/,
  ];
  for (const r of webRes) {
    const m = lower.match(r);
    if (!m) continue;
    const q = orig(m, "q").replace(/^["“”]+|["“”]+$/g, "");
    if (SCREENY.some((w) => ` ${q.toLowerCase()} `.includes(w))) return null;
    return { url: "https://www.google.com/search?q=" + enc(q), say: `Here are the results for ${q}.` };
  }
  const o = lower.match(/^(?:open(?: up)?|go to|take me to|pull up|launch) (?:the )?(?<s>[a-z0-9 .\-]+?)(?: website| site| in (?:the |my )?browser| in safari| in chrome)?$/);
  if (o?.groups) {
    const s = o.groups.s.trim();
    const known = OPEN_SITES[s];
    if (known) return { url: known[1], say: `Here's ${known[0]}.` };
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(s)) return { url: `https://${s}`, say: `Here's ${s}.` };
  }
  return null;
}

// ── Writing help (selected text on the page) ─────────────────────────────────
const THIS = "(this|it|that|the (selected )?text|my (text|email|message|paragraph)|the (email|message|paragraph|sentence|page|article|document|post))( (page|article|email|document|post))?";
const WP = "^(can you |could you |please |wisp,? )*";
const WRITING = [
  `${WP}(rewrite|rephrase|reword|redo|polish|tidy up|clean up|improve|edit) ${THIS}`,
  `${WP}(fix|correct|check) (the )?(grammar|spelling|typos|punctuation|mistakes)`,
  `${WP}proofread ${THIS}`,
  `${WP}(summari[sz]e|shorten|condense|simplify|expand on) ${THIS}`,
  `${WP}translate ${THIS} (to|into) [a-z]+`,
  `${WP}make ${THIS} (sound )?(more |less |a (bit|little) (more |less )?)?(shorter|longer|formal|informal|friendlier|friendly|clearer|simpler|polite|professional|casual|concise|warmer|nicer|kinder|confident|persuasive|positive)`,
  `${WP}turn ${THIS} into (bullet points|a (bulleted )?list|an email|a tweet|a summary|a paragraph)`,
  `${WP}write a (reply|response|answer) to ${THIS}`,
  `${WP}(give me |what are )(the )?(key|main) (points|takeaways)( of ${THIS})?`,
  `${WP}(give me (a |the )|what's the |what is the )?(summary|tl;?dr|gist) of ${THIS}`,
].map((p) => new RegExp(p));
export const isWritingHelp = (q: string) => WRITING.some((r) => r.test(norm(q)));
export const isSummaryRequest = (q: string) => /summar|tl;?dr|gist|key points|main points|takeaways|shorten|condense/.test(norm(q));
export const WRITING_SYSTEM =
  "You help people with their writing. They selected some text in their browser and asked for a change. Reply with only the new text, ready to paste in place of theirs: no introduction, no quotation marks around it, no notes afterwards. Keep their language unless they ask for a translation, keep their meaning and any names, numbers and links, and keep line breaks and lists where they help. When they ask for a reply to a message, write the reply as them. A summary, gist or list of key points is much shorter than the original: only the few things that matter most, in two to four short sentences or up to five bullet points, easy to take in by ear.";
export function writingUserText(request: string, selection: string): string {
  return `What they asked: "${request}"${isSummaryRequest(request) ? "\n(It will be read aloud: keep it to about 50 words.)" : ""}\n\nThe text they selected:\n${selection}`;
}
export function cleanedWriting(text: string): string {
  let t = text.trim().replace(/^(here('s| is) [^\n:]{0,60}:|sure[!,.][^\n:]{0,60}:)\s*/i, "");
  const q = t.match(/^"([\s\S]*)"$/) ?? t.match(/^“([\s\S]*)”$/);
  if (q) t = q[1];
  return t.split("\n").map((l) => l.replace(/\s+$/, "")).join("\n").trim();
}

// ── History ──────────────────────────────────────────────────────────────────
export interface HistoryEntry { id: string; at: number; question: string; answer: string; page?: string; typed: boolean }
export const HISTORY_CAPACITY = 300;
export const RECENT_CAPACITY = 10;

export function historyTitle(question: string, limit = 48): string {
  const q = question.trim();
  if (!q) return "(no words)";
  const cap = q.charAt(0).toUpperCase() + q.slice(1);
  if (cap.length <= limit) return cap;
  const cut = cap.slice(0, limit);
  const sp = cut.lastIndexOf(" ");
  return (sp > limit / 2 ? cut.slice(0, sp) : cut) + "…";
}

export function searchHistory(entries: HistoryEntry[], query: string): HistoryEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((e) => { const hay = `${e.question} ${e.answer} ${e.page ?? ""}`.toLowerCase(); return words.every((w) => hay.includes(w)); });
}

export function recall(entries: HistoryEntry[], topic: string): HistoryEntry | null {
  const stop = new Set(["the", "a", "an", "my", "this", "that"]);
  const stem = (w: string) => { for (const s of ["ping", "ing", "ed", "es", "s"]) if (w.endsWith(s) && w.length > s.length + 2) return w.slice(0, -s.length); return w; };
  const words = topic.toLowerCase().split(/\s+/).filter((w) => w && !stop.has(w)).map(stem);
  if (!words.length) return null;
  return entries.find((e) => { const hay = `${e.question} ${e.answer}`.toLowerCase(); return words.every((w) => hay.includes(w)); }) ?? null;
}
