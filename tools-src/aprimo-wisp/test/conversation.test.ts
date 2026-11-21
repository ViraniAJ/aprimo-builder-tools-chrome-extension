import { describe, expect, it } from "vitest";
import { Conversation, IDLE_MS, historyMessages, isNewChat, type Exchange } from "../src/core/conversation";

const ex = (i: number, at = Date.now(), extra: Partial<Exchange> = {}): Exchange => ({ question: `q${i}`, answer: `a${i}`, page: "Administration", topic: "screen", at, ...extra });

describe("conversation memory", () => {
  it("sends earlier exchanges as user/assistant pairs in the reply format", () => {
    const m = historyMessages([ex(1), ex(2, Date.now(), { topic: "other", page: undefined })], false);
    expect(m).toEqual([
      { role: "user", content: '(On the Aprimo page "Administration") q1' },
      { role: "assistant", content: "TOPIC: screen\nSAY: a1" },
      { role: "user", content: "q2" },
      { role: "assistant", content: "TOPIC: other\nSAY: a2" },
    ]);
  });
  it("keeps the newest within the budget", () => {
    const many = Array.from({ length: 20 }, (_, i) => ex(i));
    const cloud = historyMessages(many, false);
    expect(cloud.length).toBe(16);
    expect(cloud[cloud.length - 2].content).toContain("q19");
    expect(historyMessages(many, true).length).toBe(6);
    const long = Array.from({ length: 8 }, (_, i) => ex(i, Date.now(), { answer: "x".repeat(2000) }));
    const m = historyMessages(long, false);
    expect(m.length).toBeLessThan(16);
    expect(m[m.length - 1].content.length).toBeLessThan(760); // answers are trimmed
  });
  it("forgets after the idle time", async () => {
    const c = new Conversation(null);
    c.add({ question: "q", answer: "a" });
    expect((await c.messages(false)).length).toBe(2);
    expect(historyMessages([ex(1, Date.now() - IDLE_MS - 1)], false)).toEqual([]);
  });
  it("drops the rejected answer on try again, and clears on new chat", async () => {
    const c = new Conversation(null);
    c.add({ question: "first", answer: "a" });
    c.add({ question: "second", answer: "b" });
    c.dropLast("second");
    expect((await c.messages(false)).map((m) => m.content).join(" ")).not.toContain("second");
    c.clear();
    expect(await c.messages(false)).toEqual([]);
  });
  it("recognises new chat", () => {
    for (const q of ["new chat", "Start over", "okay, start a new conversation", "clear the chat", "forget this conversation", "let's start over."]) expect(isNewChat(q), q).toBe(true);
    for (const q of ["start a new classification", "how do I start over a workflow", "new user"]) expect(isNewChat(q), q).toBe(false);
  });
});
