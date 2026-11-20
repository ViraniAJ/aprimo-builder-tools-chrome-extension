// Runs in the DAM page's own JavaScript context (MAIN world). Looks for the bearer token the DAM UI uses for
// Aprimo APIs and hands it to token-relay.js via postMessage. It never changes any request.
// Two ways to find it:
//   1. Watching fetch/XHR calls for an "Authorization: Bearer ..." header to *.aprimo.com.
//   2. Reading the OAuth/OIDC sign-in data the page keeps in localStorage/sessionStorage
//      (e.g. the "oidc.user:..." entry written by oidc-client libraries).
// It also announces itself, so the extension can tell "page seen, no token" apart from "page not seen".
// Only used by the experimental "Use my open DAM tab" mode; token-relay.js ignores it otherwise.
(() => {
  if (window.__armTokenHook) return;
  window.__armTokenHook = true;
  let last = null;
  const post = (data) => { try { window.postMessage({ __arm: true, ...data }, location.origin); } catch {} };

  const isJwt = (s) => typeof s === 'string' && /^[\w-]{10,}\.[\w-]{10,}\.[\w-]*$/.test(s);
  const report = (token, source) => {
    if (!isJwt(token) || token === last) return;
    last = token;
    post({ type: 'token', token, source });
  };

  // ---- 1. request headers ----
  const fromHeader = (url, value) => {
    try {
      if (!value || !/^Bearer\s+/i.test(value)) return;
      if (!/\.aprimo\.com$/i.test(new URL(url, location.href).hostname)) return;
      report(value.replace(/^Bearer\s+/i, ''), 'request');
    } catch {}
  };
  const headerValue = (headers) => {
    if (!headers) return null;
    if (headers instanceof Headers) return headers.get('Authorization');
    if (Array.isArray(headers)) return headers.find(([k]) => /^authorization$/i.test(k))?.[1] || null;
    return Object.entries(headers).find(([k]) => /^authorization$/i.test(k))?.[1] || null;
  };
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      const url = input instanceof Request ? input.url : String(input);
      fromHeader(url, headerValue(init?.headers) || (input instanceof Request ? input.headers.get('Authorization') : null));
    } catch {}
    return origFetch.apply(this, arguments);
  };
  const origOpen = XMLHttpRequest.prototype.open;
  const origSet = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (method, url) { this.__armUrl = url; return origOpen.apply(this, arguments); };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (/^authorization$/i.test(name)) fromHeader(this.__armUrl, value);
    return origSet.apply(this, arguments);
  };

  // ---- 2. stored sign-in data ----
  // Prefer entries that look like OAuth results ({ access_token, expires_at }) and pick the one expiring last.
  // If this tab had a stored sign-in and it's now gone, the user signed out here: say so, so the extension
  // forgets the site's token immediately instead of using it until it expires.
  let hadStored = false;
  function scanStorage() {
    const found = [];
    for (const store of [window.sessionStorage, window.localStorage]) {
      let n = 0;
      try { n = store.length; } catch { continue; }
      for (let i = 0; i < n; i++) {
        try {
          const key = store.key(i);
          const raw = store.getItem(key);
          if (!raw || raw.length > 50_000 || !/token/i.test(key + raw.slice(0, 2000))) continue;
          let v = raw;
          try { v = JSON.parse(raw); } catch {}
          const token = typeof v === 'object' && v ? (v.access_token || v.accessToken || v.token?.access_token) : v;
          if (isJwt(token)) found.push({ token, key, exp: jwtExp(token) });
        } catch {}
      }
    }
    found.sort((a, b) => (b.exp || 0) - (a.exp || 0));
    const usable = found[0] && (!found[0].exp || found[0].exp * 1000 > Date.now()) ? found[0] : null;
    if (usable) { hadStored = true; report(usable.token, `storage:${usable.key.slice(0, 40)}`); }
    else if (hadStored) { hadStored = false; last = null; post({ type: 'token-gone' }); }
    return found.length;
  }
  // Signing out usually clears storage in this tab; check right away when that happens.
  window.addEventListener('storage', () => setTimeout(scanStorage, 200));
  function jwtExp(t) {
    try { return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp || null; } catch { return null; }
  }

  post({ type: 'hello' });
  // Sign-in data can appear after the page finishes logging in, so look a few times.
  for (const ms of [0, 2000, 6000, 15000]) setTimeout(scanStorage, ms);
  // Tokens are renewed while the page stays open; re-check now and then.
  setInterval(scanStorage, 20_000);
})();
