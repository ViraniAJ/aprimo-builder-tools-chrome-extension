// Wisp's GuideSession: after a how-to answer, watch the user do the step, then ask for the next one with a fresh
// look at the page. Wisp watches the screen with a pixel fingerprint and global input events; in the browser the page
// agent watches clicks, keys, DOM mutations and route changes instead (see agent/main.ts "watch").
import { norm } from "./intents";

export const MAX_STEPS = 12;
export const IDLE_TIMEOUT_MS = 180_000;
export const MAX_ACTIONS_PER_STEP = 8;

const TASK_STARTS = ["how do i", "how can i", "how to", "how would i", "how should i", "how do we", "how do you", "where do i", "where can i", "help me", "walk me through", "show me how", "i want to", "i need to", "i'd like to", "can you show me how", "can you help me", "can you walk me", "teach me", "guide me", "what do i do to", "what do i click to", "how am i supposed to"];
const MORE_TASK_STARTS = ["what are the steps", "what's the process", "whats the process", "what is the process", "steps to", "steps for", "the steps to", "process to", "process for", "how would one", "how does one", "how can we", "how should we", "where do we", "show me where", "take me through", "can you show me", "could you show me", "please show me", "i'm trying to", "im trying to", "i am trying to", "trying to", "i want to know how", "i'd like to know how", "let's", "lets"];
// Said as a command ("create a classification", "set up a workflow"): Wspr can't do it, so it walks them through it.
const DO_VERBS = /^(?:please |can you |could you )?(?:create|add|set up|setup|configure|upload|edit|change|delete|remove|rename|move|share|publish|import|export|assign|build|enable|disable|turn on|turn off|update|download|archive|approve|submit|schedule|invite|duplicate|attach|tag|translate|review|find|locate|open|navigate to|go to|get to)\b/;
export const isTask = (q: string) => {
  const t = norm(q).replace(/^(?:(?:hey|hi|ok|okay|so|um|uh|wisp)[,!]? )+/, "");
  return TASK_STARTS.some((p) => t.startsWith(p)) || MORE_TASK_STARTS.some((p) => t.startsWith(p)) || DO_VERBS.test(t);
};

const CONT_EXACT = new Set(["next", "ok", "okay", "done", "continue", "go on", "keep going", "and then", "then what", "now what", "what now", "what next", "whats next", "what's next", "ok what now", "okay what now", "okay now what", "ok now what", "okay next", "ok next", "got it", "next one", "what else", "i did it", "i did that", "i clicked it", "i clicked that", "it's open", "its open", "done now", "okay done", "ok done", "all right", "alright", "yep", "yes"]);
const CONT_PREFIX = ["what's the next step", "whats the next step", "what is the next step", "what do i do now", "what do i do next", "what should i do now", "what should i do next", "next step", "okay what's next", "ok what's next", "okay what do i", "ok what do i", "i did it", "i clicked it", "i've done that", "done what's next", "done whats next", "what's after that", "what comes next", "then what do i"];
export function isContinuation(q: string): boolean {
  const t = norm(q).replace(/[^a-z' ]/g, "").replace(/\s+/g, " ").trim();
  return CONT_EXACT.has(t) || CONT_PREFIX.some((p) => t.startsWith(p));
}

export const FIRST_STEP_TEXT =
  'They want to do this in Aprimo now, one step at a time, while you watch. If it is something to do in Aprimo, give ONLY the first action (one thing to click, choose or type), in one short sentence, and show where it is on this page, even if it is only the menu, card or link that leads to the right page. Do not say what comes after it, not even with "then", and do not list or number the steps, even if the notes list them all: once they have done this step you will see the page again and give the next one. End the reply with one more line: "STEPS: more" if there is more to do after this step, or "STEPS: done" if this step finishes it. If it is not something to do in Aprimo, answer it normally and end with "STEPS: done".';

/** Most sentences one walkthrough step may speak (the action, plus a short note about where it is). */
export const MAX_STEP_SENTENCES = 2;
// Where a reply runs on into the next action: ", then …", "and then …", "; next …", or a sentence starting "Then",
// "Next", "After that", "Once it opens", "When the dialog appears", "Finally"…
const NEXT_IN_SENTENCE = /(?:,\s*(?:and\s+)?then\b|\s+and\s+then\b|;\s*(?:then|next)\b|,\s*(?:and\s+)?(?:next|after that|afterwards)\b)/i;
const NEXT_SENTENCE = /^\s*(?:then|next|after that|afterwards|after this|once|when|from there|finally|lastly|now)\b/i;
/**
 * Keeps a walkthrough step to one action, so Wspr doesn't say the next one before the user has done this one (and
 * then say it again after). Cuts a numbered next step ("2.", "Step 2", "Secondly"), a clause or sentence that moves
 * on ("…, then click Users", "Then choose Reset password"), and anything past two sentences.
 */
export function capStep(text: string): { text: string; cut: boolean } {
  let t = text;
  let cut = false;
  const numbered = t.search(/(?:^|\s)(?:2[.)]\s|step (?:2|two)\b|secondly\b)/i);
  if (numbered > 0) { t = t.slice(0, numbered).trim(); cut = true; }
  const sentences = t.match(/[^.!?]+(?:[.!?]+["')\]]*|$)/g)?.filter((x) => x.trim()) ?? [t];
  const kept: string[] = [];
  for (const [i, sentence] of sentences.entries()) {
    if (i >= MAX_STEP_SENTENCES || (i > 0 && NEXT_SENTENCE.test(sentence))) { cut = true; break; }
    const m = sentence.search(NEXT_IN_SENTENCE);
    if (m > 0) { kept.push(sentence.slice(0, m).trimEnd() + "."); cut = true; break; }
    kept.push(sentence);
  }
  t = kept.join("").trim().replace(/(?:^|\s)1[.)]\s+/, " ").trim(); // a leftover "1." from a numbered list
  return { text: t, cut };
}

export type GuideAction =
  | { kind: "click-target"; label?: string }
  | { kind: "click-else"; label?: string }
  | { kind: "key"; name: string }
  | { kind: "typing" }
  | { kind: "page-changed"; route: string };

export interface GuideStepRecord { said: string; did: string }

export function actionsText(actions: GuideAction[]): string {
  if (!actions.length) return "did nothing yet";
  const out: string[] = [];
  for (const a of actions.slice(-MAX_ACTIONS_PER_STEP)) {
    const s = a.kind === "click-target" ? `clicked the highlighted ${a.label ? `"${a.label}"` : "spot"}`
      : a.kind === "click-else" ? `clicked somewhere else${a.label ? ` ("${a.label}")` : ""}`
      : a.kind === "key" ? `pressed ${a.name}`
      : a.kind === "typing" ? "typed something"
      : "the page changed";
    if (s === "typed something" && out[out.length - 1] === s) continue; // collapse typing
    out.push(s);
  }
  return out.join(", then ");
}

export function requestText(o: { goal: string; history: GuideStepRecord[]; current: string; actions: GuideAction[]; clickedTarget: boolean; targetLabel?: string }): string {
  const lines = [`They're doing a task step by step while you watch: "${o.goal}".`];
  if (o.history.length) {
    lines.push("Steps so far:");
    o.history.slice(-6).forEach((h, i) => lines.push(`${i + 1}. You said: "${h.said}" They ${h.did}.`));
  }
  lines.push(`Just now you said: "${o.current}" Since then they ${actionsText(o.actions)}. The screenshot and control list show the page now.`);
  if (o.clickedTarget) {
    const used = o.targetLabel ? `"${o.targetLabel}", the control you showed` : "what you showed";
    lines.push(`They clicked ${used}, so that step is done: don't ask them to do it again. Give the step after it and show where it is. If what it opens isn't on the page yet, say what to do in it once it appears and show nothing.`);
  }
  lines.push('Look at it carefully. If the task is finished, say so in a few words and show nothing. If they clearly did something else and the step still needs doing, say it once more in different words and show it again. Otherwise give only the next action (one thing to click, choose or type) in one short sentence, and show where it is. Do not repeat steps they have already done, and do not say what comes after this one, not even with "then". End with "STEPS: more" if more steps follow, or "STEPS: done" if the task is finished or this step finishes it.');
  return lines.join("\n");
}

/** Should a walkthrough start after this answer? (Wisp: guideSteps on, a task, and STEPS more, or no STEPS line but it pointed.) */
export function shouldStartGuide(o: { guideSteps: boolean; question: string; steps?: boolean; pointed: boolean }): boolean {
  if (!o.guideSteps || !isTask(o.question)) return false;
  return o.steps === true || (o.steps === undefined && o.pointed);
}
/** Should it end after a step answer? (STEPS done, or no STEPS line and nothing shown, or the step limit.) */
export function shouldEndGuide(o: { steps?: boolean; pointed: boolean; stepCount: number }): boolean {
  return o.steps === false || (o.steps === undefined && !o.pointed) || o.stepCount >= MAX_STEPS;
}

export const GUIDE_CAPTIONS = {
  start: "Go ahead, I'll watch and tell you the next step. Esc stops.",
  allSet: "That's it, you're all set.",
  lost: "I lost track of the steps. Ask me again to pick up where you are.",
  waiting: "Waiting for that to open…",
};
