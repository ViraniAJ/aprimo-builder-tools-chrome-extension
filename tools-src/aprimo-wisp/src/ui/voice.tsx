// Wspr's voice visuals, from libraries.dev (MIT): Voice Glow, a colourful light rising from the bottom edge of the
// card, and Voice Ring, a ring of light on the talk button. Both follow one state:
//   idle        waiting
//   listening   your turn: they move with your actual voice (a microphone stream just for the visuals)
//   processing  Wspr is thinking: the glow gathers into one beam that sweeps side to side, the ring turns
//   speaking    Wspr's turn: Chrome's speech gives no audio to measure, so a speech-like level drives them
import { useEffect, useRef, useState, type ReactNode } from "react";
import { VoiceBeam, type VoiceBeamMotion } from "voice-glow";
import { VoiceRing } from "voice-ring";
import { isSpeaking } from "../voice/tts";

export type VoiceState = "idle" | "listening" | "processing" | "speaking";

export function voiceState(o: { listening: boolean; busy: boolean; speaking: boolean }): VoiceState {
  return o.listening ? "listening" : o.busy ? "processing" : o.speaking ? "speaking" : "idle";
}

/** A microphone stream for the visuals while Wspr listens. Speech recognition opens its own; Chrome shares the
 * device, and this one is never recorded or sent anywhere: it only feeds the level meters. */
export function useMicStream(on: boolean): MediaStream | null {
  const [stream, setStream] = useState<MediaStream | null>(null);
  useEffect(() => {
    if (!on || !navigator.mediaDevices?.getUserMedia) return;
    let live: MediaStream | null = null;
    let dead = false;
    navigator.mediaDevices.getUserMedia({ audio: true }).then(
      (s) => { if (dead) s.getTracks().forEach((t) => t.stop()); else { live = s; setStream(s); } },
      () => {}, // no meter, the visuals fall back to their calm motion
    );
    return () => { dead = true; live?.getTracks().forEach((t) => t.stop()); setStream(null); };
  }, [on]);
  return stream;
}

/** Whether Wspr is speaking an answer right now. */
export function useSpeaking(): boolean {
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setSpeaking(isSpeaking() || !!window.speechSynthesis?.speaking), 150);
    return () => clearInterval(t);
  }, []);
  return speaking;
}

/** A level that rises and falls like syllables, for Wspr's own voice. */
const speechLevel = () => {
  const t = performance.now() / 1000;
  return 0.22 + 0.5 * Math.abs(Math.sin(t * 6.1)) * (0.65 + 0.35 * Math.sin(t * 1.9));
};

/** The glow while thinking: gathers into one beam over half a second and sweeps from side to side. */
function useSweep(on: boolean) {
  const since = useRef(0);
  if (on && !since.current) since.current = performance.now();
  if (!on) since.current = 0;
  const fn = useRef<() => VoiceBeamMotion | null>(() => null);
  fn.current = () => {
    if (!since.current) return null;
    const t = (performance.now() - since.current) / 1000;
    const ease = Math.min(1, t / 0.5);
    return { gather: ease, offset: Math.sin(t * 1.5) * 0.75 * ease, stretch: 0.25 * Math.abs(Math.cos(t * 1.5)), heldLevel: 0.55 };
  };
  const stable = useRef(() => fn.current());
  return stable.current;
}

/** Voice Glow along the bottom edge of the wrapped card. */
export function VoiceGlow({ state, stream, children }: { state: VoiceState; stream: MediaStream | null; children: ReactNode }) {
  const sweep = useSweep(state === "processing");
  return (
    <VoiceBeam
      active={state !== "idle"}
      stream={state === "listening" ? stream : null}
      level={state === "speaking" ? speechLevel : state === "processing" ? 0.5 : 0}
      motion={sweep}
      theme="light"
      colorVariant="colorful"
    >
      {children}
    </VoiceBeam>
  );
}

/** Voice Ring for the talk button, with the mic icon showing through while it waits. */
export function TalkRing({ state, stream, size = 40 }: { state: VoiceState; stream: MediaStream | null; size?: number }) {
  return (
    <span className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <VoiceRing
        size={size}
        state={state}
        stream={state === "listening" ? stream : null}
        level={state === "speaking" ? speechLevel : undefined}
        theme="light"
        sensitivity={1}
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      />
      {state === "idle" && (
        <svg className="relative text-primary" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
        </svg>
      )}
    </span>
  );
}
