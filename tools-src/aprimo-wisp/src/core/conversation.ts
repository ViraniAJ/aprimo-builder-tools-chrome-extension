// The conversation so far, sent with each question so follow-ups make sense ("and the other one?", "where's that
// again?", "what did you mean?"). Only the words travel: each earlier question with the page it was asked on, and
// what Wspr said. Old screenshots and control lists are not resent, since the page has changed since and their
// element ids no longer mean anything.
//
// It resets after IDLE_MS without a question, on "new chat" (button or voice), and when the browser closes; it's
// kept in session storage so closing and reopening the panel keeps it.

export interface Exchange { question: string; answer: string; page?: string; topic?: string; at: number }
export type HistoryMessage = { role: "user" | "assistant"; content: string };

export const MAX_EXCHANGES = 8;
export const IDLE_MS = 15 * 60_000;
const BUDGET = { cloud: { exchanges: MAX_EXCHANGES, chars: 5000 }, local: { exchanges: 3, chars: 1500 } };
const ANSWER_CHARS = 700;
const KEY = "wisp.conversation";

/** Earlier exchanges as chat messages, newest kept when over budget. Answers use the reply format (TOPIC/SAY). */
export function historyMessages(all: Exchange[], local: boolean, now = Date.now()): HistoryMessage[] {
  const b = local ? BUDGET.local : BUDGET.cloud;
  const live = all.filter((e) => now - e.at < IDLE_MS && e.answer.trim()).slice(-b.exchanges);
  const pairs: HistoryMessage[][] = [];
  let used = 0;
  for (let i = live.length - 1; i >= 0; i--) {
    const e = live[i];
    const user = `${e.page ? `(On the Aprimo page "${e.page}") ` : ""}${e.question.trim()}`;
    const said = e.answer.trim().length > ANSWER_CHARS ? `${e.answer.trim().slice(0, ANSWER_CHARS)}…` : e.answer.trim();
    const assistant = `TOPIC: ${e.topic === "other" ? "other" : "screen"}\nSAY: ${said.replace(/\s*\n\s*/g, " ")}`;
    used += user.length + assistant.length;
    if (used > b.chars && pairs.length) break;
    pairs.unshift([{ role: "user", content: user }, { role: "assistant", content: assistant }]);
  }
  return pairs.flat();
}

/** "new chat", "start over", "clear the conversation", "forget this conversation"… */
export const isNewChat = (q: string) =>
  /^(?:(?:please|ok|okay|hey|wisp|wspr|whisper)[,!]? )*(?:(?:start )?(?:a )?new (?:chat|conversation|topic)|start (?:over|again|fresh)|clear (?:the |this |our )?(?:chat|conversation)|reset (?:the |this |our )?(?:chat|conversation)|forget (?:this|our|the) conversation|let'?s start over)(?: please)?[.!]?$/i.test(q.trim().toLowerCase().replace(/[’‘]/g, "'"));

export class Conversation {
  private all: Exchange[] = [];
  private loaded: Promise<void>;

  constructor(private store: chrome.storage.StorageArea | null = typeof chrome !== "undefined" ? chrome.storage?.session ?? null : null) {
    this.loaded = this.store
      ? this.store.get(KEY).then((r) => { const saved = r[KEY] as Exchange[] | undefined; if (Array.isArray(saved)) this.all = [...saved, ...this.all]; }).catch(() => {})
      : Promise.resolve();
  }

  private save() { void this.store?.set({ [KEY]: this.all }).catch(() => {}); }

  /** Messages to send before the new question. Starts fresh after IDLE_MS without a question. */
  async messages(local: boolean): Promise<HistoryMessage[]> {
    await this.loaded;
    const last = this.all[this.all.length - 1];
    if (last && Date.now() - last.at >= IDLE_MS) this.clear();
    return historyMessages(this.all, local);
  }

  add(e: Omit<Exchange, "at">) {
    if (!e.answer.trim()) return;
    this.all = [...this.all, { ...e, at: Date.now() }].slice(-MAX_EXCHANGES * 2);
    this.save();
  }

  /** "Try again": re-ask without the answer that was rejected. */
  dropLast(question: string) {
    const last = this.all[this.all.length - 1];
    if (last && last.question === question) { this.all = this.all.slice(0, -1); this.save(); }
  }

  clear() { this.all = []; this.save(); }

  get size() { return this.all.length; }
}
