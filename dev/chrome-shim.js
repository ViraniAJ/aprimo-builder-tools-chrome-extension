// Development only: minimal stand-in for the chrome.* APIs the extension page uses, so it can run
// in a normal tab against dev/fake-aprimo.js. Never shipped in the extension.
(() => {
  const listeners = [];
  const tabListeners = [];
  window.__shimTabsChanged = () => tabListeners.forEach((fn) => fn(1));
  const area = (prefix, name) => {
    const read = () => { try { return JSON.parse(localStorage.getItem(prefix) || '{}'); } catch { return {}; } };
    const write = (o) => localStorage.setItem(prefix, JSON.stringify(o));
    const notify = (before, after) => {
      const changes = {};
      for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) changes[k] = { oldValue: before[k], newValue: after[k] };
      }
      if (Object.keys(changes).length) for (const fn of listeners) setTimeout(() => fn(changes, name));
    };
    return {
      async get(keys) {
        const all = read();
        if (keys == null) return all;
        const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
        return Object.fromEntries(list.filter((k) => k in all).map((k) => [k, all[k]]));
      },
      async set(obj) { const before = read(); const after = { ...before, ...obj }; write(after); notify(before, after); },
      async remove(keys) { const before = read(); const all = { ...before }; for (const k of [].concat(keys)) delete all[k]; write(all); notify(before, all); },
    };
  };
  const local = area('shim.local', 'local');
  // Point the extension at the fake tenant unless a test already configured something else.
  if (!localStorage.getItem('shim.local')) {
    localStorage.setItem('shim.local', JSON.stringify({ apiBase: `${location.origin}/api/core`, loginBase: `${location.origin}/login` }));
  }
  window.chrome = {
    storage: { local, session: area('shim.session', 'session'), onChanged: { addListener: (fn) => listeners.push(fn) } },
    identity: {
      getRedirectURL: () => 'https://dalgokbanekaibeabfhhhijlggnniimn.chromiumapp.org/',
      async launchWebAuthFlow({ url }) {
        window.__shimAuthCalls = (window.__shimAuthCalls || 0) + 1;
        const res = await fetch(`${url}&mock_json=1`);
        if (!res.ok) throw new Error(`authorize failed ${res.status}`);
        return (await res.json()).location;
      },
    },
    // The manager's own window is window 1.
    windows: {
      async getCurrent() { return { id: 1 }; },
      async update(id, props) { window.__shimWindow = { id, ...props }; return { id }; },
    },
    runtime: { getURL: (p) => `${location.origin}/ext/${p}`, getManifest: () => ({ version: 'dev' }) },
    // Simulated browser tabs: a list of URLs in localStorage "shim.tabs". Tests change it and call
    // window.__shimTabsChanged() to fire the tab events the extension listens to.
    // Entries may be a URL string, or { url, windowId, title, discarded }. tabs.update records the last
    // tab brought to the front in window.__shimShown.
    tabs: {
      async query(q = {}) {
        return JSON.parse(localStorage.getItem('shim.tabs') || '[]')
          .map((t) => (typeof t === 'string' ? { url: t } : t))
          .map((t, i) => ({ id: i + 1, windowId: 1, title: '', ...t }))
          .filter((t) => q.windowId === undefined || t.windowId === q.windowId);
      },
      async getCurrent() { return { id: 999, windowId: 1 }; },
      async update(id, props) { window.__shimShown = { id, ...props }; return { id }; },
      onRemoved: { addListener: (fn) => tabListeners.push(fn) },
      onUpdated: { addListener: (fn) => tabListeners.push((id) => fn(id, { status: 'complete' })) },
    },
  };
})();
