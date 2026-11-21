import { describe, expect, it } from "vitest";
import { applyVoiceCommand, asksBack, asksCapabilities, deniesPresence, isAboutAssistant, isCopyScreenText, isKeepReading, isReadPage, isRepeat, isRetry, isSmallTalk, littleHelper, readingChunk, recallTopic, sentenceNames, voiceCommand, withoutHedge } from "../src/core/intents";
import { quickMath, timeAnswer, wordsToDigits } from "../src/core/quickmath";
import { cleanedWriting, isWritingHelp, noteCommand, recall, timerCommand, toSecondPerson, webAction, spokenDuration, parseClock } from "../src/core/helpers";
import { actionsText, isContinuation, isTask, requestText, shouldEndGuide, shouldStartGuide } from "../src/core/guide";
import { builtInShape, isFreeSketch, parseStroke, shapeStrokes, sketchSubject } from "../src/core/drawing";
import { isDrawing, nimModelsFor, NIM_DRAWING, NIM_FAST, NIM_STRONG } from "../src/core/catalog";

describe("question intents", () => {
  it("recognises Wisp's intents", () => {
    expect(isAboutAssistant("Who are you?")).toBe(true);
    expect(isSmallTalk("Thanks!")).toBe(true);
    expect(isSmallTalk("thanks for the help with rules")).toBe(false);
    expect(isRetry("No, try again")).toBe(true);
    expect(isRepeat("Sorry, say that again?")).toBe(true);
    expect(isKeepReading("keep reading")).toBe(true);
    expect(isReadPage("Read this page to me")).toBe(true);
    expect(isCopyScreenText("copy the text on my screen")).toBe(true);
    expect(asksCapabilities("What can you do?")).toBe(true);
    expect(recallTopic("What did you say about renditions earlier?")).toBe("renditions");
  });
  it("applies the visual-decision helpers", () => {
    expect(deniesPresence("I don't see an Export button here.")).toBe(true);
    expect(deniesPresence("There's no need to save first.")).toBe(false);
    expect(asksBack("Do you mean the record?")).toBe(true);
    expect(sentenceNames("Save button", "Click Save to keep it.")).toBe(true);
    expect(sentenceNames("Save", "Click Saved searches.")).toBe(false);
    expect(withoutHedge("I can't see your settings, but the theme lives under Preferences in the profile menu.")).toBe("The theme lives under Preferences in the profile menu.");
  });
  it("handles voice commands", () => {
    expect(voiceCommand("Wisp, talk a little faster please")).toBe("faster");
    expect(voiceCommand("shh")).toBe("hush");
    expect(applyVoiceCommand("faster", 1.95)).toEqual({ rate: 2 });
    expect(applyVoiceCommand("mute", 1)).toEqual({ speak: false });
  });
  it("has little helpers", () => {
    expect(littleHelper("How do you spell rendition?")).toBe("Rendition is spelled R, E, N, D, I, T, I, O, N.");
    expect(littleHelper("flip a coin", () => 0.1)).toBe("Heads.");
    expect(littleHelper("pick a number between 5 and 5")).toBeNull();
  });
  it("cuts long reading at a sentence", () => {
    const text = "One. ".repeat(3000);
    const r = readingChunk(text);
    expect(r.first.length).toBeLessThanOrEqual(8000);
    expect(r.first.endsWith(".")).toBe(true);
    expect(r.rest).toBeTruthy();
  });
});

describe("quick math and time", () => {
  const now = new Date(2026, 10, 20, 15, 30);
  it("does tips, conversions and arithmetic", () => {
    expect(quickMath("what's an 18% tip on $50")).toBe("An 18% tip on $50 is $9.00, for a total of $59.00.");
    expect(quickMath("tip on 40")).toBe("An 18% tip on $40 is $7.20, for a total of $47.20.");
    expect(quickMath("5 miles in km")).toBe("5 miles is 8.04672 kilometers.");
    expect(quickMath("how many feet in one mile")).toBe("1 mile is 5,280 feet.");
    expect(quickMath("100 fahrenheit to celsius")).toBe("100 degrees Fahrenheit is 37.7778 degrees Celsius.");
    expect(quickMath("what's 15% of 80")).toBe("15% of 80 is 12.");
    expect(quickMath("what is twenty five times four")).toBe("25 times 4 is 100.");
    expect(quickMath("calculate 2 ^ 10 + square root of 16")).toBe("2 to the power of 10 plus the square root of 16 is 1,028.");
    expect(quickMath("what is 5 divided by 0")).toBeNull();
    expect(quickMath("how do I create a classification")).toBeNull();
  });
  it("counts days", () => {
    expect(quickMath("how many days until christmas", now)).toBe("35 days, until Friday, December 25.");
    expect(quickMath("how many days until november 20th", now)).toBe("That's today!");
  });
  it("tells the time and date", () => {
    expect(timeAnswer("what time is it", now)).toBe("It's 3:30 PM.");
    expect(timeAnswer("what time is it in narnia", now)).toBeNull();
    expect(timeAnswer("what's the date today", now)).toBe("It's Friday, November 20, 2026.");
    expect(timeAnswer("what time is it in tokyo", now)).toMatch(/^It's \d{1,2}:\d{2} (AM|PM) in Tokyo/);
  });
  it("turns number words into digits", () => {
    expect(wordsToDigits("one hundred and two")).toBe("102");
    expect(wordsToDigits("twenty-five point five")).toBe("25.5");
  });
});

describe("notes, timers, web actions, writing", () => {
  it("parses notes", () => {
    expect(noteCommand("Remember that my test tenant is ps1")).toEqual({ kind: "add", text: "your test tenant is ps1" });
    expect(noteCommand("what are my notes")).toEqual({ kind: "list" });
    expect(noteCommand("forget the note about ps1")).toEqual({ kind: "forget", topic: "ps1" });
    expect(noteCommand("clear my notes")).toEqual({ kind: "clear" });
    expect(toSecondPerson("I am done with my upload")).toBe("you are done with your upload");
  });
  it("parses timers", () => {
    expect(timerCommand("set a timer for 5 minutes")).toEqual({ kind: "set", seconds: 300, label: undefined });
    expect(timerCommand("remind me in twenty five minutes to check my upload")).toEqual({ kind: "set", seconds: 1500, label: "check your upload" });
    expect(timerCommand("set a 10-minute timer")).toEqual({ kind: "set", seconds: 600, label: undefined });
    expect(timerCommand("remind me in half an hour to stretch")).toEqual({ kind: "set", seconds: 1800, label: "stretch" });
    expect(timerCommand("cancel my timers")).toEqual({ kind: "cancel" });
    expect(timerCommand("add 2 minutes to my timer")).toEqual({ kind: "extend", seconds: 120 });
    expect(parseClock("3pm")).toEqual({ hour: 15, minute: 0 });
    expect(parseClock("12:30 am")).toEqual({ hour: 0, minute: 30 });
    expect(spokenDuration(5400)).toBe("1 hour 30 minutes");
    expect(spokenDuration(0)).toBe("0 seconds");
  });
  it("parses web actions", () => {
    expect(webAction("search youtube for aprimo dam tutorial")).toEqual({ url: "https://www.youtube.com/results?search_query=aprimo%20dam%20tutorial", say: "Here's YouTube with results for aprimo dam tutorial." });
    expect(webAction("google Aprimo content types")).toEqual({ url: "https://www.google.com/search?q=Aprimo%20content%20types", say: "Here are the results for Aprimo content types." });
    expect(webAction("open aprimo help")).toEqual({ url: "https://help.aprimo.com/", say: "Here's Aprimo Help." });
    expect(webAction("search for this button online")).toBeNull();
    expect(webAction("how do I search for records")).toBeNull();
  });
  it("detects and cleans writing help", () => {
    expect(isWritingHelp("make this more polite")).toBe(true);
    expect(isWritingHelp("summarize this page")).toBe(true);
    expect(cleanedWriting('Here is the rewrite:\n"Hello there."')).toBe("Hello there.");
  });
  it("recalls history", () => {
    const h = [{ id: "1", at: 1, question: "what are renditions", answer: "Renditions are derived files.", typed: true }];
    expect(recall(h, "renditions")?.id).toBe("1");
    expect(recall(h, "the rendition")?.id).toBe("1");
    expect(recall(h, "workflows")).toBeNull();
  });
});

describe("guide", () => {
  it("knows tasks and continuations", () => {
    expect(isTask("How do I create a classification?")).toBe(true);
    expect(isTask("What is a classification?")).toBe(false);
    expect(isContinuation("OK, what now?")).toBe(true);
    expect(isContinuation("What's the next step here")).toBe(true);
    expect(isContinuation("how do I delete it")).toBe(false);
  });
  it("starts and ends like Wisp", () => {
    expect(shouldStartGuide({ guideSteps: true, question: "how do I add a field", steps: true, pointed: false })).toBe(true);
    expect(shouldStartGuide({ guideSteps: true, question: "how do I add a field", steps: undefined, pointed: true })).toBe(true);
    expect(shouldStartGuide({ guideSteps: true, question: "how do I add a field", steps: false, pointed: true })).toBe(false);
    expect(shouldStartGuide({ guideSteps: false, question: "how do I add a field", steps: true, pointed: true })).toBe(false);
    expect(shouldEndGuide({ steps: false, pointed: true, stepCount: 1 })).toBe(true);
    expect(shouldEndGuide({ steps: undefined, pointed: false, stepCount: 1 })).toBe(true);
    expect(shouldEndGuide({ steps: true, pointed: true, stepCount: 12 })).toBe(true);
  });
  it("describes what the user did", () => {
    expect(actionsText([])).toBe("did nothing yet");
    expect(actionsText([{ kind: "typing" }, { kind: "typing" }, { kind: "key", name: "Return" }])).toBe("typed something, then pressed Return");
    const t = requestText({ goal: "create a classification", history: [], current: "Click Administration.", actions: [{ kind: "click-target", label: "Administration" }], clickedTarget: true, targetLabel: "Administration" });
    expect(t).toContain('They clicked "Administration", the control you showed');
    expect(t).toContain('"STEPS: more"');
  });
});

describe("drawing", () => {
  it("finds built-in shapes and sketches", () => {
    expect(builtInShape("draw a smiley face")).toBe("smiley");
    expect(builtInShape("can you draw me a big star on the screen")).toBe("star");
    expect(builtInShape("draw a cat")).toBeNull();
    expect(isFreeSketch("draw a cat")).toBe(true);
    expect(isFreeSketch("draw a circle around the save button")).toBe(false);
    expect(sketchSubject("please draw a cat for me")).toBe("a cat");
    expect(shapeStrokes("smiley")).toHaveLength(4);
    expect(shapeStrokes("star")[0]).toHaveLength(11);
    expect(parseStroke("10,10 50,40; 90,10 200,200")).toEqual([{ x: 10, y: 10 }, { x: 50, y: 40 }, { x: 90, y: 10 }]);
  });
  it("routes NIM models like Wisp", () => {
    expect(isDrawing("Wisp, draw a house")).toBe(true);
    expect(nimModelsFor("draw a house", NIM_FAST, [], true)).toEqual([NIM_DRAWING, NIM_STRONG, NIM_FAST]);
    expect(nimModelsFor("where is save", NIM_FAST, [NIM_STRONG, NIM_FAST], true)).toEqual([NIM_STRONG, NIM_FAST]);
    expect(nimModelsFor("where is save", NIM_FAST, [NIM_STRONG, NIM_FAST], true, true)).toEqual([NIM_FAST, NIM_STRONG]);
    expect(nimModelsFor("where is save", "z-ai/glm-5.3-flash", [], false)).toEqual(["z-ai/glm-5.3-flash"]);
  });
});
