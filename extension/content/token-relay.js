// Isolated-world bridge between page-token.js and the extension.
// - "hello": always recorded (no data, just "a DAM page of this site was seen"), so the manager can explain
//   why no token arrived.
// - "token": forwarded only when the "Use my open DAM tab" sign-in mode is chosen in Settings. The background
//   worker files it under this page's site and forgets it when the site's last tab closes.
window.addEventListener('message', async (e) => {
  if (e.source !== window || e.origin !== location.origin || !e.data?.__arm) return;
  try {
    if (e.data.type === 'hello') chrome.runtime.sendMessage({ type: 'page-seen' });
    if (e.data.type === 'token-gone') chrome.runtime.sendMessage({ type: 'token-gone' });
    if (e.data.type === 'token') {
      const { authMode } = await chrome.storage.local.get('authMode');
      if (authMode === 'session') chrome.runtime.sendMessage({ type: 'page-token', token: e.data.token, source: e.data.source });
    }
  } catch {}
});
