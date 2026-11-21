// Wisp's QuestionIntent and the visual-decision helpers, ported regex for regex (WispCore/Assistant/QuestionIntent.swift,
// VisualDecision.swift). Everything runs on the lowercased question with ’ turned into '.

export const norm = (q: string) => q.toLowerCase().replace(/[’‘]/g, "'").trim()
  // Addressing it by name ("hey whisper, …", "…, wspr") matches the same commands as before the rename.
  .replace(/^(hey |hi |ok |okay )?(?:whisper|wspr)\b/, "$1wisp").replace(/,? (?:whisper|wspr)([?.!]*)$/, " wisp$1");
/** Lowercase and trim whitespace plus punctuation. */
export const normP = (q: string) => norm(q).replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, "");

const ABOUT_ASSISTANT = [
  /\bwhat (else )?can you do\b/, /\bwhat do you do( exactly)?\??$/, /\bwho are you\b/, /\bwhat are you( exactly| for| called)?\??$/,
  /\bwhat('s| is) your name\b/, /\bhow do you work\b/, /\bwhat are you able to\b/, /\bwhat can i ask you\b/, /\bhow (do|can) i use you\b/,
  /\bare you (an? )?(ai|robot|bot|human)\b/, /\byour (job|purpose|name)\b/, /\bare you (claude|siri|chatgpt|gemini|alexa|copilot)\b/,
  /\bwho (made|built|created) you\b/, /\bcan you (remember|see everything|always see)\b/, /\bcan you (click|type) (things|stuff|for me)\b/,
  /\bcan you see (my|the) screen\b/, /\bcan you do (the )?(math|maths|sums|stuff|things)\b/, /\bwhat can you help( me)?( with)?\??$/, /\bdo you remember\b/,
];
export const isAboutAssistant = (q: string) => ABOUT_ASSISTANT.some((r) => r.test(norm(q)));

export const isSmallTalk = (q: string) =>
  /^(hey|hi|hello|hello there|hey there|yo|thanks|thank you|thank you so much|thanks a lot|cool|ok|okay|great|nice|never ?mind|good (morning|afternoon|evening|night)|test|test test|testing|can you hear me|are you there|um+|uh+|hm+|oops|my bad|sorry|sorry,? wrong (button|key|thing)|wrong (button|key))( wisp)?$/.test(normP(q));

export const allowsPointing = (q: string) => !isAboutAssistant(q) && !isSmallTalk(q);

export const deniesPresence = (sentence: string) =>
  /\b(i (don't|do not|can't|cannot) (see|find)|there('s| is) no (?!need|problem|rush|worries|harm)|there (isn't|aren't)|(isn't|aren't|is not|are not) (shown|visible|here|on (this|the|your) (screen|page))|no [a-z ]{1,24} (here|on (this|the) (screen|page)))/i.test(sentence.replace(/’/g, "'"));

export const asksBack = (sentence: string) => /\?$/.test(sentence.trim().replace(/["”']+$/, ""));

const BANNED_NAMES = ["not visible", "none", "n/a", "nothing", "screen", "the screen", "window", "page", "not shown", "unknown"];
export function sentenceNames(label: string, sentence: string): boolean {
  const name = label.trim()
    .replace(/\s*\((button|icon|menu|tab|link|field|option|checkbox)\)$/i, "")
    .replace(/\s+(button|icon|menu item|menu|tab|link|field|option|checkbox|toggle)$/i, "").trim();
  if (BANNED_NAMES.includes(name.toLowerCase())) return false;
  if (name.length < 2 && !new RegExp(`["“']${escapeRe(name)}["”']`).test(sentence)) return false;
  if (!name) return false;
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(name)}(?![\\p{L}\\p{N}])`, "iu").test(sentence);
}
export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Strips "I can't see X, but …" when at least four words follow; capitalises the rest. */
export function withoutHedge(sentence: string): string {
  const m = sentence.match(/^\s*(i (can't|cannot|can not) help with [^,.;]{0,40}|i (don't|do not|can't|cannot) see [^,.;]{0,70}|i'm not (sure|able to [^,.;]{0,30})[^,.;]{0,20}),?\s+but\s+/i);
  if (!m) return sentence;
  const rest = sentence.slice(m[0].length);
  if (rest.trim().split(/\s+/).length < 4) return sentence;
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

const P = "^(can you |could you |please |wisp,? )*";
export const isReadAloud = (q: string) => new RegExp(`${P}read (this|that|it|the (selected|highlighted) (text|part|bit)|what i('ve| have)? (selected|highlighted)|the selection|my selection)( (out )?(loud|aloud))?( (to|for) me)?( please)?$`).test(normP(q));
export const isCopyScreenText = (q: string) =>
  new RegExp(`${P}(copy|grab|get) (all )?(the |of the )?(text|words|writing)( that's| that is)? (on|from|in) (my |the |this |that )?(screen|image|picture|photo|video|window|page|slide|screenshot)( for me)?( please)?$|^(can you |could you |please )*copy (what's|what is|everything) on (my |the )?screen( please)?$`).test(normP(q));
export const isShortcutList = (q: string) =>
  new RegExp(`${P}((show|list|tell) me (all )?(the |its |the app's )?(keyboard )?shortcuts|what are (all )?(the )?(keyboard )?shortcuts|(show|list) (all )?(the )?(keyboard )?shortcuts|(keyboard )?shortcuts)( (here|for this( app)?|in this( app)?|for (this|the) app|in (this|the) app))?( please)?$`).test(normP(q));
export const mentionsClipboard = (q: string) => /\b(clipboard|what i('ve| have)? (just )?copied|the (text|thing|stuff|link|code) i (just )?copied|what's copied|(i|i've) (just )?copied)\b/.test(norm(q));
export const isMagnify = (q: string) =>
  new RegExp(`${P}(magnify (this|that|it|here)|zoom in on (this|that|it|here) for me|(give me|take|show me) a closer look|closer look|(show|let) me (see )?(this|that|it) (bigger|larger|closer|up close)|magnifier|enlarge (this|that|it) for me)( please)?$`).test(normP(q));
export const asksCapabilities = (q: string) => /^(wisp,? |so,? |okay,? )?(what (else )?can you do|what can you help (me )?with|what are you able to do|how can you help( me)?|what do you do)( for me)?$/.test(normP(q));
export const isKeepReading = (q: string) => /^(please |wisp,? )*(keep reading|read more|continue reading|continue|go on|keep going|read the rest)( please)?$/.test(normP(q));
export const isReadClipboard = (q: string) => new RegExp(`${P}read (me )?(what i('ve| have)? (just )?copied|my clipboard|the clipboard|what's on my clipboard)( (out )?(loud|aloud))?( (to|for) me)?( please)?$`).test(normP(q));
export const isReadPage = (q: string) => new RegExp(`${P}read (me )?(this|the|my) (page|article|screen|window|document|email|message|story|post)( (out )?(loud|aloud))?( (to|for) me)?( please)?$`).test(normP(q));
export const isRetry = (q: string) => /^(no,? |nope,? |hmm,? |wisp,? )*(try again|try that again|ask again|that's (not right|wrong|incorrect)|that is (not right|wrong)|that's not it|wrong answer|you're wrong|(get|give me) a second opinion|second opinion|are you sure|check again|look again)( please)?$/.test(normP(q));
export const isRepeat = (q: string) => /^(sorry,? |wisp,? |can you |could you |please )*(say (that|it) again|repeat (that|it|yourself|the answer|your answer|what you (just )?said)|what did you (just )?say|come again|pardon( me)?|one more time|say again)( please)?$/.test(normP(q));

/** Cuts at the last sentence end or newline inside the first `limit` characters. */
export function readingChunk(text: string, limit = 8000): { first: string; rest?: string } {
  if (text.length <= limit) return { first: text };
  const head = text.slice(0, limit);
  const cut = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "), head.lastIndexOf("\n"));
  const at = cut > limit * 0.3 ? cut + 1 : limit;
  return { first: text.slice(0, at).trim(), rest: text.slice(at).trim() || undefined };
}

export const CAPABILITIES_SAY =
  "I answer questions about the Aprimo page you're on and point to the right spot, step by step if you like. I know Aprimo's help and developer docs, and anything you've taught me. I can also read text aloud, help with writing, do math and conversions, set timers, and keep notes.";

export const CAPABILITIES_CARD = {
  title: "What Aprimo Wspr can do",
  lines: [
    "Ask about the page: “how do I create a classification?” (Wspr points; click along for the next step)",
    "Aprimo knowledge: “what's the difference between a record and a file version?”, “how do I call the search API?”",
    "Read aloud: “read this to me” (with text selected), “read this page to me”, “read what I copied”",
    "Writing: “make this more polite”, “fix the grammar”, “summarize this page” (with text selected)",
    "Instant: “what's 15% of 80?”, “5 miles in km”, “what time is it in Tokyo?”",
    "Timers and notes: “remind me in 20 minutes to check the upload”, “remember that our test tenant is ps1”",
    "More: “copy the text on the page”, “magnify this”, “try again”, “what did you say about renditions?”",
  ],
};

// ── Voice commands ───────────────────────────────────────────────────────────
export type VoiceCommand = "faster" | "slower" | "normalSpeed" | "mute" | "hush" | "unmute";
const VC: [VoiceCommand, string][] = [
  ["faster", "(talk|speak|go|read) (a (little |bit )?)?(faster|quicker|more quickly)|speed up"],
  ["slower", "(talk|speak|go|read) (a (little |bit )?)?(slower|more slowly)|slow down"],
  ["normalSpeed", "(talk|speak) (at )?(normal|regular) speed|normal speed"],
  ["mute", "(stop talking out loud|stop speaking out loud|mute (your voice|yourself)|captions only|just show (me )?(the )?captions|don't talk out loud|no voice)"],
  ["hush", "(stop|stop it|stop that|stop talking|be quiet|quiet|shh+|hush|shut up|enough|that's enough|never ?mind|cancel|forget it|nothing)"],
  ["unmute", "(talk to me again|speak (out loud )?again|turn (your|the) voice (back )?on|unmute( yourself)?|use your voice again)"],
];
export function voiceCommand(q: string): VoiceCommand | null {
  const t = norm(q).replace(/[?.!]+$/, "").trim();
  for (const [cmd, body] of VC) if (new RegExp(`^(wisp,? |hey wisp,? |can you |could you |please )*(${body})( please)?( wisp)?$`).test(t)) return cmd;
  return null;
}
export const VOICE_REPLY: Record<VoiceCommand, string> = {
  faster: "Okay, I'll talk a little faster.",
  slower: "Okay, I'll talk a little slower.",
  normalSpeed: "Back to my normal speed.",
  mute: "Okay, captions only from now on. Say “turn your voice back on” any time.",
  hush: "",
  unmute: "Okay, I'll talk out loud again.",
};
export function applyVoiceCommand(cmd: VoiceCommand, rate: number): { rate?: number; speak?: boolean } {
  const r = (x: number) => Math.round(Math.min(2, Math.max(0.5, x)) * 100) / 100;
  if (cmd === "faster") return { rate: r(rate + 0.15) };
  if (cmd === "slower") return { rate: r(rate - 0.15) };
  if (cmd === "normalSpeed") return { rate: 1 };
  if (cmd === "mute") return { speak: false };
  if (cmd === "unmute") return { speak: true };
  return {};
}

// ── Little helpers ───────────────────────────────────────────────────────────
export function littleHelper(q: string, rand: () => number = Math.random): string | null {
  const t = norm(q).replace(/^[?.!\s]+|[?.!\s]+$/g, "");
  let m = t.match(/^(?:how do you spell|how do i spell|spell|how is) ([a-z][a-z'-]{1,30})(?: spelled| spelt)?$/);
  if (m) { const w = m[1]; return `${w.charAt(0).toUpperCase() + w.slice(1)} is spelled ${w.toUpperCase().split("").filter((c) => /[A-Z]/.test(c)).join(", ")}.`; }
  if (/^(?:can you |please )?(?:flip|toss) a coin$|^heads or tails$/.test(t)) return rand() < 0.5 ? "Heads." : "Tails.";
  if (/^(?:can you |please )?roll (?:a|the|one) (?:die|dice)$/.test(t)) return `You rolled a ${1 + Math.floor(rand() * 6)}.`;
  m = t.match(/^(?:can you |please )?(?:pick|choose|give me) a (?:random )?number (?:between|from) (\d{1,9}) (?:and|to) (\d{1,9})$/);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]);
    if (a === b) return null;
    const lo = Math.min(a, b), hi = Math.max(a, b);
    return `${lo + Math.floor(rand() * (hi - lo + 1))}.`;
  }
  return null;
}

// ── History recall ───────────────────────────────────────────────────────────
export function recallTopic(q: string): string | null {
  const m = normP(q).match(/^what did (?:you|wisp) (?:say|tell me|answer) (?:about|on|for) (.+?)(?: earlier| before| last time| today)?$/);
  return m ? m[1] : null;
}
