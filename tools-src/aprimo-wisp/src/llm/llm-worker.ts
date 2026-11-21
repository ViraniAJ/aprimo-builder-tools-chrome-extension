/// <reference lib="webworker" />
// Runs the offline model (WebLLM) on the GPU, off the page's main thread.
import { WebWorkerMLCEngineHandler } from "@mlc-ai/web-llm";
const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg: MessageEvent) => handler.onmessage(msg);
