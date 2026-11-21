// Messages between the side panel, the page agent (content script) and the service worker.
import type { CompanionLook } from "../agent/overlay";
import type { Pt } from "../core/drawing";
import type { GuideAction } from "../core/guide";
import type { PageFacts } from "../core/prompt";
import type { Target } from "../core/reply-parser";

export interface Descriptor { role: string; text: string; aria?: string; auto?: string; testid?: string; name?: string; tag: string }

export type DrawCommand =
  | { kind: "shape"; shape: "POINT" | "CIRCLE" | "UNDERLINE"; target: Target; label?: string }
  | { kind: "arrow"; from: Target; to: Target; label?: string }
  | { kind: "path"; targets: Target[]; label?: string }
  | { kind: "strokes"; strokes: Pt[][]; label?: string };

export interface PlanStep { index: number; total: number; text: string; target?: Target; until?: string }

export type AgentRequest =
  | { kind: "wisp"; op: "ping" }
  | { kind: "wisp"; op: "snapshot"; max?: number }
  | { kind: "wisp"; op: "draw"; turn: string; cmd: DrawCommand }
  | { kind: "wisp"; op: "caption"; text: string; final?: boolean; hold?: boolean }
  | { kind: "wisp"; op: "clear" }
  | { kind: "wisp"; op: "companion"; state: "thinking" | "done" }
  | { kind: "wisp"; op: "look"; look: Partial<CompanionLook> }
  | { kind: "wisp"; op: "steps"; turn: string; steps: PlanStep[] }
  | { kind: "wisp"; op: "watch"; turn: string; target?: Target; label?: string; caption?: string }
  | { kind: "wisp"; op: "watch-stop" }
  | { kind: "wisp"; op: "page-text"; max?: number }
  | { kind: "wisp"; op: "record-start" }
  | { kind: "wisp"; op: "record-stop" }
  | { kind: "wisp"; op: "navigate"; route: string };

export type AgentEvent =
  | { kind: "wisp-event"; op: "step-advanced"; turn: string; index: number }
  | { kind: "wisp-event"; op: "step-lost"; turn: string; index: number; text: string }
  | { kind: "wisp-event"; op: "steps-finished"; turn: string }
  | { kind: "wisp-event"; op: "steps-stopped"; turn: string }
  | { kind: "wisp-event"; op: "guide-settled"; turn: string; actions: GuideAction[]; clickedTarget: boolean; changed: boolean }
  | { kind: "wisp-event"; op: "guide-stopped"; turn: string; reason: "esc" | "idle" | "button" }
  | { kind: "wisp-event"; op: "recorded-action"; at: number; route: string; action: string; target?: Descriptor; title: string }
  | { kind: "wisp-event"; op: "page-changed"; route: string };

export interface SnapshotResult { facts: PageFacts }
