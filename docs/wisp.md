# Aprimo Wspr

Aprimo Wspr (said "whisper") is an AI guide built into Aprimo Builder Tools. You ask a question by voice or by typing. Wspr answers out loud with captions, and when the answer is on the Aprimo page you're looking at, it moves a cursor to the right control. For a how-to question it walks you through the task one step at a time, waiting while you do each step.

It is a browser reimplementation of [Wisp](https://github.com/ZakVir/wisp), a native macOS push-to-talk helper, specialised for Aprimo. None of Wisp's Swift code is reused. Its behaviour is ported in TypeScript instead: the reply grammar, routing, local skills and guide. The parity table below lists what carries over and what doesn't.

## Using it

- **Open:**
  - Press **Alt+Shift+Space**. It opens the side panel and starts listening; press it again to stop. You can change the keys at `chrome://extensions/shortcuts`.
  - Or open **Administration › External Builder Tools › Aprimo Wspr Settings** and click **Open Wspr panel**.
- **Or click the teal cursor** in Aprimo's top bar, next to Help (?). It does the same as the shortcut, with a burst of sparkles. Opening Wspr with either one plays a short intro in the panel (the cursor points and circles on a miniature Aprimo page), then it starts listening. Click to skip it; Reduce motion turns it off. While a walkthrough runs, its card sits in the bottom-right corner.
- **Ask:**
  - Hold the mic button and talk, or type.
  - Esc stops an answer or a walkthrough.
- **Walkthroughs:** ask "how do I…". Wspr shows the first step, watches you do it, then shows the next one. Say "what now?" at any point to move on, or ask something else to end the walkthrough.
- **Teach:** the panel's **Teach** tab records your screen and narration while you do something in Aprimo:
  - Whisper transcribes the narration on your computer.
  - Wspr notes every click.
  - Wspr saves the transcript, the clicks and the video as knowledge. When someone later asks about that feature, Wspr answers from the recording and can link to the right moment in the video.

  This adds to Wspr's knowledge index. No model is retrained.
- **Knowledge:** under **Settings › Knowledge** you can:
  - index Aprimo Help with your own sign-in
  - crawl a site
  - add pages
  - upload files (Markdown, text, HTML, PDF, VTT/SRT)
  - link video demos with their captions
  - export or import a knowledge pack (`.wisp.json`) to share with your team

## How it works

| Part | Where | What it does |
|---|---|---|
| Side panel | `src/panel/` | Chat UI, push-to-talk (Chrome speech recognition), the controller that runs local skills, AI turns and the guide |
| Page agent | `src/agent/`, built to `content/wisp-agent.js` | Lists the page's visible controls with ids (`e17 button "Save" at 812, 64`), draws the cursor and hand-drawn marks in a closed shadow root, watches walkthrough steps, notes clicks while recording |
| Turn | `src/core/turn.ts` | Snapshot, screenshot (`captureVisibleTab`, long edge 1456 px) and top 6 knowledge passages, then the prompt. Streams the reply, parses it line by line, speaks each sentence and draws each visual after Wspr's visual-decision checks |
| Providers | `src/providers/` | NVIDIA NIM and OpenAI-compatible (chat-completions SSE), Anthropic (Messages SSE, direct browser access), and the offline WebLLM model in a worker. NVIDIA races Super VL against Nano |
| Knowledge | `src/kb/` | all-MiniLM-L6-v2 (q8) embeddings in a worker, int8 vectors plus BM25 fused by reciprocal rank. The bundled index is in `extension/kb/`; your additions are in IndexedDB |

Everything Wspr runs locally ships with the extension: the embedding model and ONNX Runtime. Two pieces are downloaded on first use: the Whisper model (for transcribing recordings), and the offline LLM (if you choose it).

## Defaults (from Wisp)

- **Provider:** NVIDIA NIM (free), at `https://integrate.api.nvidia.com/v1`.
- **Smart routing:**
  - Nemotron 3.5 Super VL first, with Nemotron 3 Nano Omni as the backup. The backup starts after 2.5 s, or immediately if the first model fails; the first real answer wins.
  - Drawings go to Step 5 Preview first.
  - "Try again" swaps the first two models (a second opinion).
- **Claude:** Sonnet 5.5 by default; Haiku 4.5 and Opus 5.5 are also offered.
- **Key names:**

  | Provider | Key name |
  |---|---|
  | NVIDIA NIM | `nvidia-nim-api-key` |
  | Anthropic | `anthropic-api-key` |
  | OpenAI-compatible | `openai-compatible-api-key` |

  Keys are kept in `chrome.storage.local`, or in `chrome.storage.session` for "only this session". Settings exports never include them.
- **Answers:** answer length is normal, timeout 20 s (first token within at most 20 s, the whole answer within timeout + 20 s), temperature 0.2.
- **Organizations:** they can set and lock any setting through Chrome policy (`chrome.storage.managed`, schema in `extension/wisp-managed-schema.json`). Locked controls show "Managed by your organization".

## Reply grammar

Wisp's grammar works as is, and the extension adds element ids and a few tags:

```
TOPIC: screen | other
SAY: Open Administration, then Classifications.
POINT: e17 | Administration          (or POINT: 812, 64 | Administration)
CIRCLE: e42 | Filters                (or CIRCLE: x, y, width, height | label; x, y is the top-left corner)
UNDERLINE: x1, y1, x2, y2 | label    ARROW: e4 -> e17 | label (or x1, y1, x2, y2)    PATH: x1,y1 x2,y2 …
STEPS: more | done
SOURCE: k1, k3                        VIDEO: k7 @83 | title                           NAV: #/route (the user confirms)
```

The parser follows Wisp's rules:

- `<think>` blocks are stripped, even when a tag is split across chunks.
- Several tags on one line are split apart.
- Untagged lines and unknown tags are spoken.
- Numbers are read leniently (`x=812 y=404`).
- Paths are capped at 64 points.
- Looping output is detected and dropped.

Coordinates may be pixels, 0 to 1000, or 0 to 1, per model. The control list is sent in the same coordinate space as the model's answers. A point whose label matches a control snaps to that control, so the cursor follows it when the page scrolls or re-renders.

## Parity with the Mac app

| Wisp (macOS) | Aprimo Wspr | Notes |
|---|---|---|
| Hold a chord to talk | Hold the mic button; Alt+Shift+Space toggles | Chrome commands fire on key press only, so the shortcut toggles instead of being held |
| Double-tap to type | Text box in the panel | |
| On-device speech recognition | Chrome speech recognition | |
| Kokoro voices | `chrome.tts` voices | Same rate, volume and mute controls |
| Captions, "what Wisp heard", earcons | Same | Captions can sit next to the pointer or at the bottom of the page |
| Screenshot plus accessibility tree | Tab screenshot plus DOM control list (role, label, state, disabled, position), selected text, element under the pointer | "Better answers" toggle |
| Several displays | One tab | Not applicable |
| Reply grammar, parser, degenerate detector | Same, plus element ids, SOURCE, VIDEO, NAV | |
| VisualDecision (snap, greyed-out note, deny/ask-back) | Same | Snaps to DOM elements |
| NVIDIA race, smart routing, second opinion, fallbacks | Same | |
| Anthropic, OpenAI-compatible, Find Models, connection test | Same | Same messages; custom servers ask for host permission |
| Spoken error messages | Same | |
| GuideSession (STEPS more/done, watch, settle, next step) | Same | Watches clicks, keys, DOM mutations and route changes instead of a screen fingerprint. The 70 px click reach, 0.8 s / 2 s settle times, 12-step limit and 180 s idle timeout are kept |
| Local intents: retry, repeat, capabilities, keep reading, read clipboard, read selection or page, copy screen text, magnify, voice commands, quick math, time, little helpers, notes, timers, history recall | Same | Timers use `chrome.alarms`, speak and notify. Magnify crops the tab screenshot around the pointer |
| Writing help on selected text | Same | Works on text selected on the Aprimo page; the result goes to the clipboard |
| Built-in shapes, free sketch | Same | Drawn on the page around the pointer |
| Companion flies out when you ask, moves to each visual as its sentence is spoken, returns beside the pointer | Same | Curved flight, a tap ring on points, labels beside the cursor; "Keep the companion on screen" with idle transparency |
| GesturePlanner hand-drawn marks, pen-traced by the cursor | Same | Circle overshoot, underline sag, arrow bow, constant-speed pen |
| Companion themes, size, outline, reduce motion | Same 14 themes (accent colours) | The cursor is an SVG, not Wisp's Metal fluid shader |
| Settings export and import, managed locks | Same | Uses `chrome.storage.managed` |
| History (300, opt-in) and recent answers (10) | Same | Without "Keep history", it lasts until the browser closes |
| Onboarding, Check-up | Same steps, minus macOS permissions | |
| Open apps, menu-bar commands, shortcut lists, Mac facts, system dictionary | Not ported | macOS only. Definitions and shortcut questions go to the AI |
| Web actions (search, open site) | Ported | Opens a new tab |

## Building

```
npm install
npm run wisp:assets   # ONNX Runtime and the embedding model into extension/ (once)
npm run build:tools   # panel, settings, workers and page agent
npm test              # parser, intents, math, guide, settings, knowledge
npm run kb:build      # optional: re-crawl developers.aprimo.com and rebuild extension/kb/
npm run kb:verify     # retrieval check: recall@5 on knowledge/golden.json (at least 0.85)
```

`kb:build` and `wisp:assets` run Node with `SSL_CERT_FILE` unset, because a custom CA bundle in that variable replaces Node's own CA list and breaks TLS to developers.aprimo.com and Hugging Face.

The built bundles, `vendor/` and `models/` are not committed. `npm run release` builds them and adds them to the zip.

## Not yet verified

- The extension has not yet been loaded and run in Chrome against a real tenant. The unit tests and typecheck pass, and retrieval passes its check.
- `captureVisibleTab` from the side panel may need the `activeTab` grant that comes with the shortcut. Without a screenshot, Wspr answers from the control list.
- Aprimo Help indexing needs a signed-in session in the same browser. Its page structure was not inspected, because it requires login.
