// Grants the extension the microphone once, in a normal tab (the side panel can't show Chrome's prompt).
const statusEl = document.getElementById("status")!;
const btn = document.getElementById("allow") as HTMLButtonElement;
async function ask() {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
    statusEl.textContent = "Done. You can close this tab and talk to Wisp.";
    btn.hidden = true;
    setTimeout(() => window.close(), 1500);
  } catch (e) {
    statusEl.textContent = `Chrome didn't allow the microphone (${(e as Error).name}). Click the camera icon in the address bar, allow the microphone, and try again.`;
  }
}
btn.onclick = ask;
export {};
