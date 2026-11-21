import { describe, expect, it } from "vitest";
import { deepMerge, diffFrom, isLocked, leafPaths, mergeSettings, defaultSettings } from "../src/core/settings";
import { orderControls, systemPrompt, toModel, userText, type PageFacts } from "../src/core/prompt";
import { matchControl, normLabel } from "../src/core/turn";
import { dotInt8, decodeIndex, encodeIndex, quantize } from "../src/kb/int8";
import { BM25, rrf, tokenize } from "../src/kb/bm25";
import { chunkMarkdown, chunkTranscript } from "../src/kb/chunk";
import { parseCaptions } from "../src/kb/transcript";

describe("settings layers", () => {
  it("merges, deletes with null, and drops wrong types", () => {
    const warn: string[] = [];
    const m = deepMerge({ a: 1, b: { c: 2, d: 3 } }, { a: "x", b: { c: null, d: 4 } }, (p) => warn.push(p));
    expect(m).toEqual({ a: 1, b: { d: 4 } });
    expect(warn).toEqual(["a"]);
  });
  it("replaces retired models and clamps", () => {
    const s = mergeSettings({ providers: { "nvidia-nim": { model: "moonshotai/kimi-k3" } }, rate: 9, answerLength: "medium" });
    expect(s.providers["nvidia-nim"].model).toBe("nvidia/nemotron-3.5-super-vl-120b-a12b");
    expect(s.rate).toBe(2);
    expect(s.answerLength).toBe("normal");
  });
  it("locks managed paths and saves only changes", () => {
    const managed = { provider: "anthropic", providers: { anthropic: { model: "claude-sonnet-5-5" } } };
    const locked = leafPaths(managed);
    expect(locked).toEqual(["provider", "providers.anthropic.model"]);
    expect(isLocked(locked, "providers")).toBe(true);
    expect(isLocked(locked, "providers.anthropic.model")).toBe(true);
    expect(isLocked(locked, "providers.nvidia-nim.model")).toBe(false);
    const s = mergeSettings({ speak: false }, managed);
    expect(s.provider).toBe("anthropic");
    expect(diffFrom(defaultSettings(), { ...s, rate: 1.2 }, locked)).toEqual({ speak: false, rate: 1.2 });
  });
});

const page: PageFacts = {
  url: "https://ps1.aprimo.com/MarketingOps/", title: "Classifications", route: "#/management/classifications", tenant: "ps1", area: "marketing-ops",
  breadcrumbs: ["Administration", "Classifications"], headings: ["Classifications"], viewport: { width: 1000, height: 500 }, truncated: 0,
  elements: [
    { id: "e1", role: "button", text: "Save", x: 900, y: 10, w: 60, h: 30 },
    { id: "e2", role: "button", text: "New classification", x: 20, y: 80, w: 160, h: 30, disabled: true },
    { id: "e3", role: "button", text: "Save", x: 900, y: 450, w: 60, h: 30 },
  ],
};

describe("prompt", () => {
  it("converts control positions into the model's space", () => {
    expect(toModel(500, 250, page.viewport, { width: 1456, height: 728, space: "pixels" })).toEqual([728, 364]);
    expect(toModel(500, 250, page.viewport, { width: 1456, height: 728, space: "normalized1000" })).toEqual([500, 500]);
    const t = userText({ question: "where is save?", page, image: { width: 1000, height: 500, space: "pixels" }, notes: [{ id: "k1", title: "Classifications", url: "u", text: "About classifications.", source: "dev" }], answerLength: "short", instructions: "Be brief.", local: false, readControls: true });
    expect(t).toContain('- e1 button "Save" at 930, 25');
    expect(t).toContain("(disabled)");
    expect(t).toContain("[k1] Classifications");
    expect(t).toContain("one sentence whenever possible");
    expect(t.trim().endsWith('The user asked: "where is save?"')).toBe(true);
    expect(systemPrompt(false, "normalized1000")).toContain("0-1000 on both axes");
  });
  it("orders controls by rows", () => {
    expect(orderControls(page.elements).map((e) => e.id)).toEqual(["e1", "e2", "e3"]);
  });
  it("snaps a labelled point to the nearest matching control", () => {
    expect(normLabel("the Save button")).toBe("save");
    expect(matchControl("Save", { x: 920, y: 440 }, page)?.id).toBe("e3");
    expect(matchControl("Save button", { x: 100, y: 100 }, page)?.id).toBe("e1"); // two share it: any distance
    expect(matchControl("Delete", { x: 0, y: 0 }, page)).toBeNull();
  });
});

describe("knowledge index", () => {
  it("int8 dot products match float ones", () => {
    const a = Float32Array.from({ length: 384 }, (_, i) => Math.sin(i));
    const b = Float32Array.from({ length: 384 }, (_, i) => Math.cos(i * 0.7));
    const norm = (v: Float32Array) => { const n = Math.hypot(...v); return v.map((x) => x / n); };
    const na = norm(a), nb = norm(b);
    const exact = na.reduce((s, x, i) => s + x * nb[i], 0);
    const q = quantize(nb);
    const idx = decodeIndex(encodeIndex([q], 384).buffer as ArrayBuffer);
    expect(Math.abs(dotInt8(na, idx.mat, 0, 384, idx.scales[0]) - exact)).toBeLessThan(0.02);
  });
  it("ranks with BM25 and fuses with RRF", () => {
    const bm = new BM25();
    for (const d of ["create a classification in administration", "upload files to the DAM", "classification rules and permissions"]) bm.add(d);
    const s = bm.scores("classification");
    expect(s[1]).toBe(0);
    expect(s[0]).toBeGreaterThan(0);
    expect(tokenize("Hello, World")).toContain("hello");
    expect(rrf([Float32Array.from([0.5, 0.1, 0.9]), Float32Array.from([0.2, 0.1, 0.8])], 60, 2)).toEqual([2, 0]);
  });
  it("chunks markdown and transcripts", () => {
    const body = "This paragraph is long enough to be kept as a chunk on its own.";
    const c = chunkMarkdown("Guide", `# Guide\n\n## Setup\n\n${body}\n\n## Use\n\n${body}`);
    expect(c.map((x) => x.heading)).toEqual(["Guide > Setup", "Guide > Use"]);
    const say = "words spoken in the recording here";
    const t = chunkTranscript([{ start: 0, end: 30, text: say }, { start: 30, end: 61, text: say }, { start: 70, end: 80, text: say }], 60);
    expect(t.map((x) => x.start)).toEqual([0, 70]);
  });
  it("parses captions", () => {
    const vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nOpen Administration\n\n00:01:05.500 --> 00:01:08.000\nChoose <b>Classifications</b>";
    expect(parseCaptions(vtt)).toEqual([{ start: 1, end: 4, text: "Open Administration" }, { start: 65.5, end: 68, text: "Choose Classifications" }]);
  });
});
