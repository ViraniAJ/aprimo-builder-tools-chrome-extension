// WebGPU check, kept apart from WebLLM so pages can call it without loading the model runtime.
export function webgpuAvailable(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

export async function gpuSummary(): Promise<{ ok: boolean; reason?: string }> {
  if (!webgpuAvailable()) return { ok: false, reason: "This browser has no WebGPU (often turned off by policy on managed computers)." };
  try {
    const adapter = await (navigator as any).gpu.requestAdapter();
    if (!adapter) return { ok: false, reason: "WebGPU is present but no graphics adapter is available." };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}
