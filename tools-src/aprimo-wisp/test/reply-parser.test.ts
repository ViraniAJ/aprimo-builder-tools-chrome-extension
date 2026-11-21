import { describe, expect, it } from "vitest";
import { ReplyParser, isDegenerate, numbers, parseLine, splitInline, targetToViewport, toViewport, type ReplyEvent } from "../src/core/reply-parser";

const all = (text: string, cut: number[] = []) => {
  const p = new ReplyParser();
  const out: ReplyEvent[] = [];
  let at = 0;
  for (const c of [...cut, text.length]) { out.push(...p.push(text.slice(at, c))); at = c; }
  out.push(...p.end());
  return out.filter((e) => e.type !== "say-partial");
};

describe("Wisp grammar", () => {
  it("parses the native examples", () => {
    expect(parseLine("SAY: Click Export in the top right.")).toEqual({ type: "say", text: "Click Export in the top right." });
    expect(parseLine("POINT: 1290, 790 | Export")).toMatchObject({ type: "shape", shape: "POINT", target: { kind: "point", x: 1290, y: 790 }, label: "Export" });
    expect(parseLine("CIRCLE: 1180, 760, 220, 60 | Export button")).toMatchObject({ shape: "CIRCLE", target: { kind: "rect", x: 1180, y: 760, w: 220, h: 60 } });
    expect(parseLine("ARROW: 900, 500, 1290, 790 | Export")).toMatchObject({ type: "arrow", from: { x: 900, y: 500 }, to: { x: 1290, y: 790 } });
    const path = parseLine("PATH: 10,10 50,40 90,10 | squiggle");
    expect(path).toMatchObject({ type: "path", label: "squiggle" });
    expect((path as any).targets).toHaveLength(3);
    expect(parseLine("UNDERLINE: 300, 140, 420, 140 | Crop")).toMatchObject({ shape: "UNDERLINE", target: { kind: "rect", x: 300, w: 120 } });
  });
  it("reads TOPIC and STEPS like Wisp", () => {
    expect(parseLine("TOPIC: screen")).toEqual({ type: "topic", text: "screen" });
    expect(parseLine("TOPIC: Wisp")).toEqual({ type: "topic", text: "you" });
    expect(parseLine("TOPIC: screenshot")).toEqual({ type: "topic", text: "screen" });
    expect(parseLine("STEPS: more")).toEqual({ type: "steps", more: true });
    expect(parseLine("STEPS: next")).toEqual({ type: "steps", more: true });
    expect(parseLine("STEPS: done")).toEqual({ type: "steps", more: false });
  });
  it("speaks untagged lines and unknown tags", () => {
    expect(parseLine("Sure, here you go.")).toEqual({ type: "text", text: "Sure, here you go." });
    expect(parseLine("NOTE: this is spoken")).toEqual({ type: "say", text: "this is spoken" });
  });
  it("reads numbers leniently and handles screens", () => {
    expect(numbers("x=812 y=404")).toEqual([812, 404]);
    expect(parseLine("POINT: (812, 404) | Save | screen 2")).toMatchObject({ target: { x: 812, y: 404 }, screen: 2, label: "Save" });
    expect(parseLine("POINT: 12 | nothing")).toBeNull();
  });
  it("caps paths at 64 points", () => {
    const pts = Array.from({ length: 100 }, (_, i) => `${i},${i}`).join(" ");
    expect((parseLine(`PATH: ${pts}`) as any).targets).toHaveLength(64);
  });
});

describe("extension grammar", () => {
  it("parses element ids, steps, sources, videos and nav", () => {
    expect(parseLine('POINT: e17 | "Administration"')).toMatchObject({ target: { kind: "element", id: "e17" }, label: "Administration" });
    expect(parseLine("ARROW: e4 -> e17 | Here")).toMatchObject({ from: { kind: "element", id: "e4" }, to: { kind: "element", id: "e17" } });
    expect((parseLine("PATH: e2, e9, e17") as any).targets.map((t: any) => t.id)).toEqual(["e2", "e9", "e17"]);
    expect(parseLine("STEP 2/3: Choose Classifications. | e42 ? hash~/classifications")).toMatchObject({ index: 2, total: 3, target: { id: "e42" }, until: "hash~/classifications" });
    expect(parseLine("SOURCE: k12, [k40]")).toEqual({ type: "source", ids: ["k12", "k40"] });
    expect(parseLine('VIDEO: k7 @1:23 | "Demo"')).toEqual({ type: "video", id: "k7", at: 83, label: "Demo" });
    expect(parseLine("NAV: #/management/classifications")).toEqual({ type: "nav", route: "#/management/classifications" });
    expect(parseLine("NAV: javascript:alert(1)")).toBeNull();
  });
});

describe("streaming", () => {
  const reply = "<think>let me look\nat this</think>TOPIC: screen\nSAY: Open Administration. POINT: e17 | Administration\nSAY: Then choose Classifications.\nSTEPS: more\nSOURCE: k1\n";
  const expected = all(reply);
  it("splits several tags on one line and strips reasoning", () => {
    expect(expected.map((e) => e.type)).toEqual(["topic", "say", "shape", "say", "steps", "source"]);
    expect(expected[1]).toEqual({ type: "say", text: "Open Administration." });
  });
  it("gives the same events however the stream is cut", () => {
    for (let n = 0; n < 200; n++) {
      const cuts = Array.from({ length: 1 + (n % 12) }, () => Math.floor(Math.random() * reply.length)).sort((a, b) => a - b);
      expect(all(reply, cuts)).toEqual(expected);
    }
  });
  it("drops an unclosed think block", () => {
    expect(all("SAY: Hi.\n<think>never closed SAY: hidden")).toEqual([{ type: "say", text: "Hi." }]);
  });
  it("shows a SAY line live while it arrives", () => {
    const p = new ReplyParser();
    expect(p.push("SAY: Open the")).toEqual([{ type: "say-partial", text: "Open the" }]);
  });
});

describe("degenerate output", () => {
  it("flags loops and symbol runs", () => {
    expect(isDegenerate("the the the the the the the the the the the the the")).toBe(true);
    expect(isDegenerate("!!!!!!!!!!")).toBe(true);
    expect(isDegenerate("SAY: Click Save in the toolbar, then confirm in the dialog that opens.")).toBe(false);
  });
});

describe("coordinates", () => {
  it("maps model space to the viewport", () => {
    expect(toViewport({ x: 500, y: 500 }, "normalized1000", { width: 1456, height: 800 }, { width: 1820, height: 1000 })).toEqual({ x: 910, y: 500 });
    expect(toViewport({ x: 728, y: 400 }, "pixels", { width: 1456, height: 800 }, { width: 1820, height: 1000 })).toEqual({ x: 910, y: 500 });
    expect(targetToViewport({ kind: "rect", x: 0, y: 0, w: 0.5, h: 0.5 }, "normalizedUnit", { width: 100, height: 100 }, { width: 200, height: 200 })).toEqual({ kind: "rect", x: 0, y: 0, w: 100, h: 100 });
  });
  it("splits inline tags only after whitespace", () => {
    expect(splitInline("SAY: Go. POINT: 1, 2")).toEqual(["SAY: Go.", "POINT: 1, 2"]);
    expect(splitInline("SAY: the SAYING: x")).toEqual(["SAY: the SAYING: x"]);
  });
});
