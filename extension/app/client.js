// Data client for the Chrome extension. Same call() routes as the local server, but it talks to the
// Aprimo DAM REST API directly with the signed-in user's own token.
//
// Auth modes:
//   pkce    - "Sign in with Aprimo": Authorization Code + PKCE through chrome.identity (needs one
//             Aprimo registration whose redirect URL is this extension's chromiumapp.org URL).
//   session - Experimental: reuse the bearer token the open DAM tab is already sending.

const qs = new URLSearchParams(location.search);
const EMBEDDED = qs.get('embedded') === '1';        // overlay on a DAM page (has a close button)
const IN_PAGE = qs.get('embedded') === 'page';      // shown as a page inside Aprimo's admin layout
const RULE_SELECT = 'conditions, actions, tag';
const MAX_BACKUPS = 200;

let cfg = {};
let ui = {};

class AuthError extends Error {}
class SiteError extends Error {} // the manager's site has no open tab (or none was chosen)

// ---------- config ----------
// The site (tenant) is never remembered: it is always the Aprimo tab the manager was opened from, and the
// manager only talks to it while a tab of that site is open. Settings that are not a connection are stored:
// sign-in mode, read-only, and for "Sign in with Aprimo" each site's own client ID (registrations are per site).
// Optional extension/app/defaults.json presets these (see defaults.example.json); saved Settings win.
const GLOBAL_KEYS = ['authMode', 'refreshScope', 'readOnly', 'apiBase', 'loginBase'];

async function loadDefaults() {
  try { const r = await fetch('./defaults.json'); return r.ok ? await r.json() : {}; } catch { return {}; }
}

async function loadConfig() {
  const store = await chrome.storage.local.get(null);
  await migrate(store);
  const defaults = await loadDefaults();
  cfg = { authMode: 'pkce', readOnly: false, refreshScope: true };
  for (const k of GLOBAL_KEYS) if (defaults[k] !== undefined && defaults[k] !== '') cfg[k] = defaults[k];
  for (const k of GLOBAL_KEYS) if (store[k] !== undefined && store[k] !== '') cfg[k] = store[k];
  cfg.clients = {
    ...(defaults.tenant && defaults.clientId ? { [defaults.tenant]: { clientId: defaults.clientId, clientSecret: defaults.clientSecret || '' } } : {}),
    ...(defaults.clients || {}),
    ...(store.clients || {}),
  };
  useSite((qs.get('tenant') || '').toLowerCase());
}

function useSite(tenant) {
  cfg.tenant = tenant;
  const c = cfg.clients[tenant] || {};
  cfg.clientId = c.clientId || '';
  cfg.clientSecret = c.clientSecret || '';
}

// Earlier versions remembered one site ("tenant", or v0.2 "profiles"). Keep their client IDs, forget the site.
async function migrate(store) {
  if (!('tenant' in store) && !store.profiles) return;
  const clients = { ...(store.clients || {}) };
  for (const [t, p] of Object.entries(store.profiles || {})) if (p.clientId) clients[t] = { clientId: p.clientId, clientSecret: p.clientSecret || '' };
  if (store.tenant && store.clientId) clients[store.tenant] = { clientId: store.clientId, clientSecret: store.clientSecret || '' };
  const last = store.profiles?.[store.lastTenant || store.tenant] || {};
  const globals = Object.fromEntries(GLOBAL_KEYS.filter((k) => last[k] !== undefined && store[k] === undefined).map((k) => [k, last[k]]));
  await chrome.storage.local.remove(['tenant', 'clientId', 'clientSecret', 'profiles', 'lastTenant', 'sessionCapture']);
  await chrome.storage.local.set({ clients, ...globals });
  Object.assign(store, globals, { clients });
  delete store.tenant;
}

const apiBase = () => cfg.apiBase || `https://${cfg.tenant}.dam.aprimo.com/api/core`;
const loginBase = () => cfg.loginBase || `https://${cfg.tenant}.aprimo.com/login`;
const tokenKey = () => `token:${cfg.tenant}`;
const configured = () => !!cfg.tenant && (cfg.authMode === 'session' || !!cfg.clientId);

// ---------- which Aprimo sites are open in tabs ----------
// The tenant is the first label of the host: ps1.dam.aprimo.com, ps1.aprimo.com -> "ps1".
const NOT_TENANTS = new Set(['www', 'developers', 'login', 'help', 'community', 'status', 'support', 'docs']);
function tenantOf(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (!/\.aprimo\.com$/.test(host)) return null;
    const t = host.split('.')[0];
    return NOT_TENANTS.has(t) ? null : t;
  } catch { return null; }
}

// A tab on Aprimo's sign-in / sign-out pages is not a signed-in site, so it doesn't count as open.
function signedInPage(url) {
  try { return !/^\/(login|logout|signin|sign-in|signout|sign-out|account\/log)/i.test(new URL(url).pathname); } catch { return false; }
}

// Only tabs in the manager's own browser window count; Aprimo tabs in other Chrome windows are ignored.
// Looked up every time, so dragging the manager to another window re-checks against that window.
async function currentWindowId() {
  try { return (await chrome.windows.getCurrent()).id; } catch { return undefined; }
}
async function aprimoTabs({ allWindows = false } = {}) {
  const windowId = allWindows ? undefined : await currentWindowId();
  return chrome.tabs.query({ url: 'https://*.aprimo.com/*', ...(windowId !== undefined ? { windowId } : {}) });
}

async function openSites() {
  const tabs = await aprimoTabs();
  return [...new Set(tabs.filter((t) => signedInPage(t.url)).map((t) => tenantOf(t.url)).filter(Boolean))].sort();
}

// Every request first checks the site is still open in a tab; the manager never talks to a site you've closed.
async function ensureSiteOpen() {
  if (!cfg.tenant) throw new SiteError('No Aprimo site selected.');
  if (!(await openSites()).includes(cfg.tenant)) {
    throw new SiteError(`No signed-in ${cfg.tenant} tab is open in this window, so the manager won't connect to it. Open (or sign in to) ` +
      `${cfg.tenant} in a tab of this window to continue; the rules load again on their own.`);
  }
}

// ---------- tokens ----------
async function storedToken() { return (await chrome.storage.session.get(tokenKey()))[tokenKey()] || null; }
async function saveToken(json) {
  const t = { access: json.access_token, refresh: json.refresh_token || null, expiresAt: Date.now() + (json.expires_in || 3600) * 1000 };
  await chrome.storage.session.set({ [tokenKey()]: t });
  return t;
}
async function clearToken() { await chrome.storage.session.remove(tokenKey()); }

async function getToken({ interactive = false } = {}) {
  if (await isSignedOut()) {
    throw new AuthError(`Signed out of ${cfg.tenant}. The manager won't connect to it until you click ` +
      `${cfg.authMode === 'pkce' ? '"Sign in"' : '"Connect again"'}.`);
  }
  if (cfg.authMode === 'session') return sessionToken();
  const t = await storedToken();
  if (t && Date.now() < t.expiresAt - 60_000) return t.access;
  if (t?.refresh) {
    try { return (await refresh(t.refresh)).access; } catch { await clearToken(); }
  }
  try { return (await signIn({ interactive: false })).access; } // silent SSO, if the IdP allows it
  catch (e) { if (!interactive) throw new AuthError(`Sign in to ${cfg.tenant} to continue.`); }
  return (await signIn({ interactive: true })).access;
}

async function sessionToken() {
  const { pageTokens = {} } = await chrome.storage.session.get('pageTokens');
  const pageToken = pageTokens[cfg.tenant];
  if (!pageToken) {
    const { pageSeen = {} } = await chrome.storage.session.get('pageSeen');
    if (pageSeen[cfg.tenant] && Date.now() - pageSeen[cfg.tenant].at < 20_000) {
      throw new AuthError(`Waiting for your ${cfg.tenant} DAM tab to hand over its sign-in… The rules will load on their own.`);
    }
    if (pageSeen[cfg.tenant]) {
      // The extension runs on the DAM page, but the page never exposed a usable token.
      throw new AuthError(`Your ${cfg.tenant} DAM tab is open and the extension can see it, but the page hasn't exposed a sign-in ` +
        `token the extension can use. If refreshing that tab and clicking Retry doesn't help, this mode won't work on ` +
        `this site: switch Settings to "Sign in with Aprimo" (needs an Aprimo PKCE registration).`);
    }
    throw new AuthError(`The extension can't see any ${cfg.tenant}.dam.aprimo.com page. Refresh that DAM tab (needed after ` +
      `every extension reload), then click Retry. If the ⚙︎ Rules button doesn't appear on the DAM page, open ` +
      `chrome://extensions → Aprimo Builder Tools → Details and set "Site access" to "On all sites"; if it's ` +
      `already set, your organisation may block extensions on aprimo.com.`);
  }
  if (pageToken.exp && Date.now() > pageToken.exp * 1000 - 30_000) {
    throw new AuthError('The DAM session token has expired. Refresh your DAM tab, then click Retry.');
  }
  return pageToken.token;
}

async function signIn({ interactive }) {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const redirectUri = chrome.identity.getRedirectURL();
  const url = `${loginBase()}/connect/authorize?` + new URLSearchParams({
    response_type: 'code', client_id: cfg.clientId, redirect_uri: redirectUri,
    scope: cfg.refreshScope ? 'api offline_access' : 'api', state, code_challenge: challenge, code_challenge_method: 'S256',
  });
  const result = await chrome.identity.launchWebAuthFlow({ url, interactive });
  const back = new URL(result);
  const params = new URLSearchParams(back.search || back.hash.slice(1));
  if (params.get('error')) throw new AuthError(`Aprimo sign-in failed: ${params.get('error_description') || params.get('error')}`);
  if (params.get('state') !== state) throw new AuthError('Sign-in response did not match this request (state mismatch).');
  const body = { grant_type: 'authorization_code', code: params.get('code'), redirect_uri: redirectUri, code_verifier: verifier, client_id: cfg.clientId };
  if (cfg.clientSecret) body.client_secret = cfg.clientSecret;
  return saveToken(await tokenRequest(body));
}

async function refresh(refreshToken) {
  const headers = {};
  const body = { grant_type: 'refresh_token', refresh_token: refreshToken };
  if (cfg.clientSecret) headers.Authorization = `Basic ${btoa(`${cfg.clientId}:${cfg.clientSecret}`)}`;
  else body.client_id = cfg.clientId;
  return saveToken(await tokenRequest(body, headers));
}

async function tokenRequest(body, headers = {}) {
  const res = await fetch(`${loginBase()}/connect/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new AuthError(`Token request failed: ${json.error_description || json.error || res.status}`);
  return json;
}

function tokenClaims(token) {
  try { return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return null; }
}

// What the tools are signed in with right now, read from the token itself (its client_id says which Aprimo
// registration issued it: "DamUI" is the DAM's own app, i.e. the token came from your open DAM tab). Never signs in
// or waits: returns { state: 'none' } when there's no current token.
async function currentSignIn() {
  if (!cfg.tenant) return { state: 'none' };
  if (await isSignedOut()) return { state: 'signed-out' };
  let token = null;
  if (cfg.authMode === 'session') {
    const { pageTokens = {} } = await chrome.storage.session.get('pageTokens');
    token = pageTokens[cfg.tenant]?.token || null;
  } else {
    const t = await storedToken();
    token = t?.access || null;
  }
  const c = token && tokenClaims(token);
  if (!c) return { state: 'none' };
  const clientId = String(c.client_id || '');
  return {
    state: 'ok', clientId, user: c.name || c.preferred_username || c.email || c.unique_name || null,
    expiresAt: c.exp ? c.exp * 1000 : null,
    // Your registration only when the token was issued to the client ID in Settings; anything else is a token the
    // extension picked up from an open Aprimo page (DamUI for the DAM, another client for other Aprimo pages).
    source: clientId && clientId === cfg.clientId && cfg.authMode === 'pkce' ? 'registration' : 'session',
  };
}

function describeSignIn(si) {
  if (si.state === 'signed-out') return { label: 'Signed out', tip: 'Signed out of this site in the extension.' };
  if (si.state !== 'ok') return { label: 'Not signed in', tip: 'No current sign-in for this site yet.' };
  const until = si.expiresAt ? ` · token valid until ${new Date(si.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : '';
  const who = si.user ? ` as ${si.user}` : '';
  if (si.source === 'registration') {
    return { label: `Via client ID ${si.clientId}`, tip: `Signed in${who} with your registration, client ID ${si.clientId}${until}` };
  }
  const client = /^damui$/i.test(si.clientId) ? "Aprimo's DAM app (DamUI)" : `Aprimo client ${si.clientId || 'unknown'}`;
  return {
    label: 'Via your current session',
    tip: `Signed in${who} with your current Aprimo session, from an open Aprimo tab (token issued to ${client})${until}`,
    warn: true,
  };
}

async function updateSignInBadge() {
  const el = document.querySelector('#signinBadge');
  if (!el) return;
  try {
    const d = describeSignIn(await currentSignIn());
    el.textContent = d.label; el.title = d.tip; el.classList.toggle('session', !!d.warn);
    const line = document.querySelector('#settingsSignIn');
    if (line) line.textContent = d.tip;
  } catch { el.textContent = ''; }
}

function tokenUser(token) {
  try {
    const p = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return p.name || p.preferred_username || p.email || p.unique_name || null;
  } catch { return null; }
}

// ---------- Aprimo REST ----------
async function aprimo(method, path, { body, headers = {}, query, retried = false } = {}) {
  await ensureSiteOpen();
  const url = new URL(apiBase() + path);
  if (query) for (const [k, v] of Object.entries(query)) if (v != null) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${await getToken()}`, 'API-VERSION': '1', Accept: 'application/hal+json',
      ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && !retried && cfg.authMode === 'pkce') {
    await clearToken();
    return aprimo(method, path, { body, headers, query, retried: true });
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { message: text }; }
  if (res.status === 401) throw await rejectedTokenError();
  if (!res.ok) throw new Error(data?.message || data?.title || `${res.status} ${res.statusText}`);
  return data;
}

async function rejectedTokenError() {
  if (cfg.authMode === 'session') {
    // Forget the stale page token so the next attempt waits for a fresh one from the DAM tab.
    const { pageTokens = {} } = await chrome.storage.session.get('pageTokens');
    delete pageTokens[cfg.tenant];
    await chrome.storage.session.set({ pageTokens });
    return new AuthError(`Aprimo no longer accepts the token from your ${cfg.tenant} DAM tab (401). Refresh ${cfg.tenant}.dam.aprimo.com in another tab, then click Retry.`);
  }
  return new AuthError('Aprimo rejected the token (401). Sign in again.');
}

// For tools whose requests don't go through aprimo() (aprimo-js): Aprimo answered 401 to the current token.
// Returns a new token to retry once with ("Sign in with Aprimo"), or throws the AuthError the banner shows.
export async function tokenRejected({ retried = false } = {}) {
  if (!retried && cfg.authMode === 'pkce') { await clearToken(); return getToken(); }
  throw await rejectedTokenError();
}

async function pages(path, headers, pageSize) {
  const all = [];
  for (let page = 1; ; page++) {
    const data = await aprimo('GET', path, { query: { page, pageSize }, headers });
    const items = data?._embedded?.items || data?.items || [];
    all.push(...items);
    if (!items.length || all.length >= (data?.totalCount ?? all.length)) return all;
  }
}

function normalizeRule(r) {
  const emb = r._embedded || {};
  const items = (x) => x?.items || x?._embedded?.items || [];
  const { _links, _embedded, ...rest } = r;
  // If the user isn't embedded, keep at least the id from the HAL link (…/user/{id}) so the name can be looked up.
  const linked = (l) => { const id = l?.href?.split('?')[0].split('/').filter(Boolean).pop(); return id ? { id, name: null, email: null } : null; };
  return {
    ...rest,
    conditions: items(emb.conditions || r.conditions).sort((a, b) => a.index - b.index),
    actions: items(emb.actions || r.actions).sort((a, b) => a.index - b.index),
    modifiedBy: person(emb.modifiedBy || r.modifiedBy) || linked(_links?.modifiedBy),
    createdBy: person(emb.createdBy || r.createdBy) || linked(_links?.createdBy),
  };
}

function person(u) {
  if (!u || typeof u !== 'object') return null;
  const name = u.name || [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || u.userName || null;
  return { id: u.id || null, name, email: u.email || null };
}

// Why "Modified by" names are unavailable, if they are (shown as a tooltip on the disabled filter).
export let namesNote = '';

// Rules are fetched with their last modifier and creator embedded (same request). If the tenant refuses
// that, fall back to the plain request so the list still loads; names are then looked up from the links.
const RULE_SELECT_USERS = `${RULE_SELECT}, modifiedBy, createdBy`;
let usersSelectOk = true;
async function withUsers(fn) {
  if (usersSelectOk) {
    try { return await fn(RULE_SELECT_USERS); }
    catch (e) {
      if (e instanceof AuthError) throw e;
      usersSelectOk = false;
      namesNote = `Aprimo refused to include users with the rules (${e.message}).`;
    }
  }
  return fn(RULE_SELECT);
}

// Fill in names for users that came back as ids only, a few requests at a time, cached per session.
const userCache = new Map();
async function fillNames(rules) {
  const people = rules.flatMap((r) => [r.modifiedBy, r.createdBy]).filter(Boolean);
  if (!people.length) {
    if (rules.length && !namesNote) namesNote = 'Aprimo returned the rules without any "modified by" information.';
    return rules;
  }
  const ids = [...new Set(people.filter((p) => p.id && !p.name && !userCache.has(p.id)).map((p) => p.id))].slice(0, 200);
  let failure = null;
  for (let i = 0; i < ids.length; i += 8) {
    await Promise.all(ids.slice(i, i + 8).map(async (id) => {
      try { userCache.set(id, person(await aprimo('GET', `/user/${id}`))); }
      catch (e) { if (e instanceof AuthError) throw e; failure = e.message; userCache.set(id, null); }
    }));
  }
  for (const r of rules) {
    for (const k of ['modifiedBy', 'createdBy']) {
      const p = r[k];
      if (p?.id && !p.name && userCache.get(p.id)) r[k] = { ...userCache.get(p.id) };
    }
  }
  if (rules.some((r) => r.modifiedBy?.name)) namesNote = '';
  else if (failure) namesNote = `${namesNote ? `${namesNote} ` : ''}Looking up users by id also failed (${failure}). Your Aprimo account may not be allowed to read user records.`;
  else if (!namesNote) namesNote = 'Aprimo returned users without names.';
  return rules;
}

const getRule = async (id) => (await fillNames([
  await withUsers(async (select) => normalizeRule(await aprimo('GET', `/rule/${id}`, { headers: { 'select-rule': select } }))),
]))[0];

// ---------- backups (kept in extension storage) ----------
async function backup(rule, reason) {
  const { backups = [] } = await chrome.storage.local.get('backups');
  backups.unshift({ at: new Date().toISOString(), tenant: cfg.tenant, reason, rule });
  await chrome.storage.local.set({ backups: backups.slice(0, MAX_BACKUPS) });
  return `saved in extension, ${Math.min(backups.length, MAX_BACKUPS)} kept`;
}

function guardWrite() { if (cfg.readOnly) throw new Error('Read-only mode is on (Settings). Edits are disabled.'); }

// ---------- routes (same paths as server.js) ----------
const classificationCache = new Map();
const routes = [
  ['GET', /^\/api\/status$/, async () => {
    let user = null;
    try { user = tokenUser(await getToken()); } catch {}
    return { mock: false, readOnly: !!cfg.readOnly, domain: cfg.tenant, user };
  }],
  ['GET', /^\/api\/rules$/, async () => fillNames(await withUsers(async (select) => (await pages('/rules', { 'select-rule': select }, 100)).map(normalizeRule)))],
  ['GET', /^\/api\/rules\/([\w-]+)$/, (m) => getRule(m[1])],
  ['PUT', /^\/api\/rules\/([\w-]+)$/, async (m, body) => {
    guardWrite();
    const file = await backup(await getRule(m[1]), 'before-edit');
    await aprimo('PUT', `/rule/${m[1]}`, { body });
    return { ok: true, backup: file, rule: await getRule(m[1]) };
  }],
  ['POST', /^\/api\/rules$/, async (_m, body) => {
    guardWrite();
    const created = await aprimo('POST', '/rules', { body, headers: { Accept: 'application/json' } });
    const id = created?.id || created?.Id;
    return { ok: true, id, rule: id ? await getRule(id) : null };
  }],
  ['DELETE', /^\/api\/rules\/([\w-]+)$/, async (m) => {
    guardWrite();
    const file = await backup(await getRule(m[1]), 'before-delete');
    await aprimo('DELETE', `/rule/${m[1]}`);
    return { ok: true, backup: file };
  }],
  ['GET', /^\/api\/fields$/, async () => (await pages('/fielddefinitions', {}, 500))
    .map((f) => ({ id: f.id, name: f.name, label: f.label || f.labels?.[0]?.value || f.name }))],
  ['POST', /^\/api\/classifications$/, async (_m, body) => {
    const out = {};
    await Promise.all((body?.ids || []).slice(0, 200).map(async (id) => {
      if (!classificationCache.has(id)) {
        try { const c = await aprimo('GET', `/classification/${id}`); classificationCache.set(id, { id, name: c.name, namePath: c.namePath || c.name }); }
        catch { classificationCache.set(id, { id, name: null, namePath: null }); }
      }
      out[id] = classificationCache.get(id);
    }));
    return out;
  }],
];

export async function call(method, url, body) {
  const route = routes.find(([m, re]) => m === method && re.test(url));
  if (!route) throw new Error(`Unknown route ${method} ${url}`);
  try {
    return await route[2](url.match(route[1]), body);
  } catch (e) {
    if (e instanceof AuthError) showAuthBanner(e.message);
    if (e instanceof SiteError) { showSiteBanner(e.message); connected = false; }
    throw e;
  }
}

// ---------- UI: site banner, settings dialog, sign-in banner, embedded close ----------
export async function setup({ reload, toast, clear }) {
  await loadConfig();
  ui = { reload, toast, clear };
  injectStyles();
  const actions = document.querySelector('.top-actions');
  actions.insertAdjacentHTML('afterbegin', '<button class="btn ghost" id="settingsBtn">Settings</button>');
  if (EMBEDDED) actions.insertAdjacentHTML('beforeend', '<button class="btn ghost" id="closeOverlay" title="Close">✕</button>');
  // Inside Aprimo's own page, Aprimo's header already says "Rules Manager": drop our title and sticky offset.
  if (IN_PAGE) {
    // Inside Aprimo's own page: switch to the Aprimo look (aprimo-theme.css) and drop our own title.
    document.head.insertAdjacentHTML('beforeend', '<link rel="stylesheet" href="aprimo-theme.css">');
    document.body.classList.add('in-aprimo-page');
    const newBtn = document.querySelector('#newBtn'); // Rules Manager only
    if (newBtn) newBtn.textContent = 'Create a rule'; // Aprimo's wording
  }
  document.querySelector('main').insertAdjacentHTML('afterbegin',
    '<div id="siteBanner" class="auth-banner" hidden><span id="siteMsg"></span><span id="siteChoices" class="site-choices"></span></div>' +
    '<div id="multiBanner" class="auth-banner warn-banner" hidden role="alert"><span id="multiMsg"></span></div>' +
    '<div id="authBanner" class="auth-banner" hidden><span id="authMsg"></span><button class="btn primary" id="authBtn">Sign in</button></div>');
  document.body.insertAdjacentHTML('beforeend', settingsHtml());

  document.querySelector('#settingsBtn').addEventListener('click', () => openSettings());
  document.querySelector('#closeOverlay')?.addEventListener('click', () => parent.postMessage({ type: 'arm-close' }, '*'));
  // Version in the header, so a screenshot shows which build is running.
  const version = chrome.runtime.getManifest?.().version;
  if (version) document.querySelector('.brand').insertAdjacentHTML('beforeend', `<span class="muted small" title="Extension version">v${version}</span>`);
  // Which sign-in is in use (from the token itself), next to the site and version; details on hover and in Settings.
  document.querySelector('.brand').insertAdjacentHTML('beforeend', '<span id="signinBadge" class="signin-badge"></span>');
  setInterval(updateSignInBadge, 15_000);
  chrome.storage.onChanged?.addListener((changes, area) => { if (area === 'session') updateSignInBadge(); });
  setTimeout(updateSignInBadge, 0);

  document.querySelector('#authBtn').addEventListener('click', async () => {
    try {
      await ensureSiteOpen();
      await setSignedOut(false);
      if (cfg.authMode === 'pkce') await signIn({ interactive: true });
      hideAuthBanner();
      await ui.reload();
    } catch (e) { if (e instanceof SiteError) showSiteBanner(e.message); else showAuthBanner(e.message); }
  });
  document.querySelector('#multiBanner').addEventListener('click', (e) => {
    const site = e.target.closest('button[data-show-site]')?.dataset.showSite;
    if (site) showSiteTab(site);
  });
  document.querySelector('#siteChoices').addEventListener('click', async (e) => {
    const t = e.target.closest('button[data-site]')?.dataset.site;
    if (!t) return;
    selectSite(t);
    hideSiteBanner();
    connected = true;
    if (configured()) await ui.reload(); else openSettings();
  });
  wireSettings();

  // "Use my open DAM tab": the DAM page hands over its token a few seconds after it loads. If we're waiting
  // for it (sign-in banner showing), load the rules as soon as it arrives instead of needing a Retry click.
  chrome.storage.onChanged?.addListener(async (changes, area) => {
    if (area !== 'session' || !changes.pageTokens || cfg.authMode !== 'session') return;
    if (await isSignedOut()) return; // after Sign out, only an explicit click reconnects
    const before = changes.pageTokens.oldValue?.[cfg.tenant]?.token;
    const after = changes.pageTokens.newValue?.[cfg.tenant]?.token;
    if (after && after !== before && !document.querySelector('#authBanner').hidden) {
      hideAuthBanner();
      ui.reload();
    }
  });

  // Follow the site's tabs: disconnect when the last one closes, reconnect when one is opened again.
  const recheck = debounce(watchSite, 300);
  chrome.tabs?.onRemoved?.addListener(recheck);
  chrome.tabs?.onUpdated?.addListener((_id, change) => { if (change.url || change.status === 'complete') recheck(); });
  window.addEventListener('focus', recheck);
  setInterval(recheck, 15_000);

  return chooseSite();
}

// Decide which site this manager window is for. Returns true when it can load rules now.
let connected = false;
async function chooseSite() {
  const sites = await openSites();
  if (!cfg.tenant) {
    if (sites.length === 1) selectSite(sites[0]);
    else {
      document.querySelector('#envBadge').textContent = 'No site';
      showSiteBanner(sites.length
        ? 'Several Aprimo sites are open in this window. Which one should the manager use?'
        : 'No Aprimo site is open in this window. Open one in a tab, then open the manager from that tab (⚙︎ Rules button or the extension icon).', sites);
      return false;
    }
  }
  document.querySelector('#envBadge').textContent = `${cfg.tenant}.dam.aprimo.com`;
  updateMultiWarning(sites);
  if (!sites.includes(cfg.tenant)) {
    showSiteBanner(`No signed-in ${cfg.tenant} tab is open in this window, so the manager won't connect to it. Open (or sign in to) ${cfg.tenant} in a tab of this window to continue; the rules load again on their own.`);
    return false;
  }
  connected = true;
  if (!configured()) { openSettings(); return false; }
  return true;
}

function selectSite(t) {
  useSite(t);
  classificationCache.clear(); userCache.clear();
  usersSelectOk = true; namesNote = '';
  const u = new URL(location.href);
  u.searchParams.set('tenant', t);
  history.replaceState(null, '', u);
  const badge = document.querySelector('#envBadge'); // only on the Rules Manager page
  if (badge) badge.textContent = `${t}.dam.aprimo.com`;
}

// Other Aprimo sites open in tabs besides the one this manager works on (read by the UI for its confirmations).
export let otherOpenSites = [];

// Several client sites open at once is when an edit is most likely to land on the wrong one: say so, loudly.
function updateMultiWarning(sites) {
  otherOpenSites = cfg.tenant ? sites.filter((s) => s !== cfg.tenant) : [];
  const show = !!cfg.tenant && sites.includes(cfg.tenant) && otherOpenSites.length > 0;
  document.querySelector('#multiBanner').hidden = !show;
  document.querySelector('#envBadge').classList.toggle('multi', show);
  if (!show) return;
  const esc = (s) => s.replace(/[<>&"]/g, '');
  document.querySelector('#multiMsg').innerHTML =
    `<b>Several Aprimo sites are open in this window</b> (${[cfg.tenant, ...otherOpenSites].map(esc).join(', ')}). ` +
    `This window works on <b>${esc(cfg.tenant)}</b> only; anything you save, enable, disable or delete here changes ` +
    `<b>${esc(cfg.tenant)}</b>. Check the site name before you save.` +
    `<span class="show-sites">Find the other tabs: ${otherOpenSites.map((s) =>
      `<button type="button" class="btn ghost small" data-show-site="${esc(s)}" title="Switch to the ${esc(s)} tab">Show ${esc(s)}</button>`).join(' ')}</span>`;
}

// Bring a site's tab to the front, in whatever window it is (helps find tabs in other or minimised windows).
async function showSiteTab(site) {
  const tabs = (await aprimoTabs())
    .filter((t) => tenantOf(t.url) === site && signedInPage(t.url));
  const tab = tabs[0];
  if (!tab) { ui.toast(`No ${site} tab found any more`); return; }
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows?.update(tab.windowId, { focused: true, state: 'normal' }).catch(() => {});
  if (tabs.length > 1) ui.toast(`${tabs.length} ${site} tabs are open; showing the first one`);
}

async function watchSite() {
  if (!cfg.tenant) { if (!document.querySelector('#siteBanner').hidden && await chooseSite()) ui.reload(); return; }
  const sites = await openSites();
  updateMultiWarning(sites);
  const open = sites.includes(cfg.tenant);
  if (!open && connected) await disconnect();
  else if (open && !connected) {
    connected = true;
    hideSiteBanner();
    if (configured()) ui.reload(); else openSettings();
  }
}

// The site's last tab closed: forget its sign-in and take its rules off the screen.
async function disconnect() {
  connected = false;
  await clearToken();
  const { pageTokens = {} } = await chrome.storage.session.get('pageTokens');
  if (pageTokens[cfg.tenant]) { delete pageTokens[cfg.tenant]; await chrome.storage.session.set({ pageTokens }); }
  hideAuthBanner();
  ui.clear?.();
  showSiteBanner(`You closed or signed out of ${cfg.tenant}, so the manager disconnected from it. ` +
    `Open (or sign in to) ${cfg.tenant} in a tab to reconnect, or open the manager from another site's tab.`);
}

// Sign out of the current site: drop both kinds of token, take the rules off the screen, and stay signed out
// (in every manager window) until "Sign in" / "Connect again" is clicked, even if the DAM tab sends a new token.
async function signOut() {
  await setSignedOut(true);
  await clearToken();
  const { pageTokens = {} } = await chrome.storage.session.get('pageTokens');
  if (pageTokens[cfg.tenant]) { delete pageTokens[cfg.tenant]; await chrome.storage.session.set({ pageTokens }); }
  ui.clear?.();
  showAuthBanner(`Signed out of ${cfg.tenant}. The manager won't connect to it until you click ` +
    `${cfg.authMode === 'pkce' ? '"Sign in"' : '"Connect again"'}.`);
  ui.toast(`Signed out of ${cfg.tenant}`);
}

async function isSignedOut() {
  const { signedOut = {} } = await chrome.storage.session.get('signedOut');
  return !!signedOut[cfg.tenant];
}
async function setSignedOut(value) {
  const { signedOut = {} } = await chrome.storage.session.get('signedOut');
  if (!!signedOut[cfg.tenant] === value) return;
  if (value) signedOut[cfg.tenant] = true; else delete signedOut[cfg.tenant];
  await chrome.storage.session.set({ signedOut });
}

function showSiteBanner(msg, choices = []) {
  document.querySelector('#siteMsg').textContent = msg;
  document.querySelector('#siteChoices').innerHTML = choices
    .map((t) => `<button class="btn primary" data-site="${t}">${t}</button>`).join('');
  document.querySelector('#siteBanner').hidden = false;
}
function hideSiteBanner() { document.querySelector('#siteBanner').hidden = true; }

function showAuthBanner(msg) {
  document.querySelector('#authMsg').textContent = msg;
  document.querySelector('#authBtn').textContent = cfg.authMode === 'pkce' ? `Sign in to ${cfg.tenant}`
    : /^Signed out/.test(msg) ? 'Connect again' : 'Retry';
  document.querySelector('#authBanner').hidden = false;
}
function hideAuthBanner() { document.querySelector('#authBanner').hidden = true; }

function settingsHtml() {
  return `
  <dialog id="settings" class="settings">
    <form method="dialog">
      <h2>Settings</h2>
      <p class="muted small" style="margin:0">Site: <b id="settingsSite"></b>. The manager always uses the Aprimo tab you
        opened it from, and only while that tab is open in this window. Aprimo tabs in other Chrome windows are ignored.<br>Aprimo tabs Chrome reports right now: <b id="openSitesNow">…</b></p>
      <fieldset>
        <legend>How to authenticate</legend>
        <label class="radio"><input type="radio" name="authMode" value="pkce"> <span><b>Sign in with Aprimo</b> (recommended). Uses your own Aprimo account and SSO.</span></label>
        <label class="radio"><input type="radio" name="authMode" value="session"> <span><b>Use my open DAM tab</b> (experimental). Reuses the token your DAM tab already sends; no registration needed, but may break when Aprimo changes its UI.</span></label>
      </fieldset>
      <p class="muted small" style="margin:-4px 0 0">Current sign-in: <b id="settingsSignIn">…</b></p>
      <div class="pkce-only">
        <label>Client ID for <span class="site-name"></span> <input name="clientId" autocomplete="off"></label>
        <label>Client secret <span class="muted">(Aprimo's PKCE token call asks for it; leave blank if your registration does not)</span>
          <input name="clientSecret" type="password" autocomplete="off"></label>
        <label class="check"><input type="checkbox" name="refreshScope"> Request a refresh token (enable "Refresh Token" on the registration)</label>
        <p class="muted small">Redirect URL to register in Aprimo:<br><code id="redirectUri"></code> <button type="button" class="btn ghost small" id="copyRedirect">Copy</button></p>
      </div>
      <label class="check"><input type="checkbox" name="readOnly"> Read-only mode (block all edits)</label>
      <details><summary class="muted small">Advanced</summary>
        <label>API base URL override <input name="apiBase" placeholder="https://{tenant}.dam.aprimo.com/api/core"></label>
        <label>Login base URL override <input name="loginBase" placeholder="https://{tenant}.aprimo.com/login"></label>
      </details>
      <div class="settings-foot">
        <button type="button" class="btn ghost" id="signOut">Sign out</button>
        <button type="button" class="btn ghost" id="downloadBackups">Download backups</button>
        <div class="spacer"></div>
        <button type="button" class="btn ghost" id="cancelSettings">Cancel</button>
        <button class="btn primary" id="saveSettings" value="save">Save</button>
      </div>
    </form>
  </dialog>`;
}

function openSettings() {
  const f = document.querySelector('#settings form');
  for (const k of ['clientId', 'clientSecret', 'apiBase', 'loginBase']) f[k].value = cfg[k] || '';
  f.authMode.value = cfg.authMode;
  f.readOnly.checked = !!cfg.readOnly;
  f.refreshScope.checked = cfg.refreshScope !== false;
  document.querySelector('#settingsSite').textContent = cfg.tenant || 'none (no Aprimo tab chosen)';
  updateSignInBadge();
  // Diagnosis: list every Aprimo tab Chrome reports, and whether it counts as a signed-in site.
  aprimoTabs({ allWindows: true }).then(async (tabs) => {
    const here = await currentWindowId();
    const windows = [...new Set(tabs.map((t) => t.windowId))];
    const lines = tabs.map((t) => {
      let where = String(t.url || '(address hidden from the extension)');
      try { const u = new URL(t.url); where = u.host + u.pathname.slice(0, 30); } catch {}
      const site = tenantOf(t.url);
      const win = t.windowId === here ? 'this window' : `window ${windows.indexOf(t.windowId) + 1}`;
      const flags = [win, t.discarded || t.frozen ? 'asleep' : '', t.incognito ? 'incognito' : ''].filter(Boolean).join(', ');
      const title = t.title ? ` "${String(t.title).slice(0, 40)}"` : '';
      return `${site || '—'} · ${where}${title} (${flags})${!site ? ' (not a site)' : t.windowId !== here ? ' (other window, ignored)' : signedInPage(t.url) ? '' : ' (sign-in page, ignored)'}`;
    });
    document.querySelector('#openSitesNow').innerHTML = lines.length
      ? lines.map((l) => `<br>• ${l.replace(/[<>&]/g, '')}`).join('') : 'none';
  }).catch((e) => { document.querySelector('#openSitesNow').textContent = `can't tell (${e.message})`; });
  document.querySelectorAll('#settings .site-name').forEach((el) => { el.textContent = cfg.tenant || 'this site'; });
  document.querySelector('#redirectUri').textContent = chrome.identity.getRedirectURL();
  syncMode();
  const dlg = document.querySelector('#settings');
  if (!dlg.open) dlg.showModal();
}

function syncMode() {
  const f = document.querySelector('#settings form');
  const pkce = f.authMode.value === 'pkce';
  document.querySelector('.pkce-only').hidden = !pkce;
  f.clientId.required = pkce && !!cfg.tenant;
}

function wireSettings() {
  const dlg = document.querySelector('#settings');
  const f = dlg.querySelector('form');
  f.addEventListener('change', (e) => { if (e.target.name === 'authMode') syncMode(); });
  dlg.querySelector('#cancelSettings').addEventListener('click', () => dlg.close());
  dlg.querySelector('#copyRedirect').addEventListener('click', () => navigator.clipboard.writeText(chrome.identity.getRedirectURL()).then(() => ui.toast('Redirect URL copied')));
  dlg.querySelector('#signOut').addEventListener('click', async () => {
    dlg.close();
    if (!cfg.tenant) return;
    await signOut();
  });
  dlg.querySelector('#downloadBackups').addEventListener('click', async () => {
    const { backups = [] } = await chrome.storage.local.get('backups');
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([JSON.stringify(backups, null, 2)], { type: 'application/json' })),
      download: `aprimo-rule-backups-${new Date().toISOString().slice(0, 10)}.json`,
    });
    a.click(); URL.revokeObjectURL(a.href);
  });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const globals = {
      authMode: f.authMode.value, readOnly: f.readOnly.checked, refreshScope: f.refreshScope.checked,
      apiBase: f.apiBase.value.trim(), loginBase: f.loginBase.value.trim(),
    };
    const client = { clientId: f.clientId.value.trim(), clientSecret: f.clientSecret.value };
    const authChanged = globals.authMode !== cfg.authMode || globals.loginBase !== (cfg.loginBase || '') ||
      client.clientId !== cfg.clientId || client.clientSecret !== cfg.clientSecret;
    if (cfg.tenant && authChanged) await clearToken();
    if (cfg.tenant) cfg.clients = { ...cfg.clients, [cfg.tenant]: client };
    await chrome.storage.local.set({ ...globals, clients: cfg.clients });
    Object.assign(cfg, globals);
    useSite(cfg.tenant);
    dlg.close();
    hideAuthBanner();
    if (await chooseSite()) await ui.reload();
  });
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function injectStyles() {
  document.head.insertAdjacentHTML('beforeend', `<style>
    .auth-banner { display: flex; align-items: center; gap: 12px; margin: 12px 0 0; padding: 10px 14px; border: 1px solid var(--accent); border-radius: 10px; background: var(--accent-soft); }
    .auth-banner span { flex: 1; }
    .settings { width: min(560px, 94vw); border: 1px solid var(--line); border-radius: 12px; background: var(--panel); color: var(--text); padding: 0; }
    .settings::backdrop { background: rgba(0,0,0,.35); }
    .settings form { display: flex; flex-direction: column; gap: 12px; padding: 18px 20px; }
    .settings h2 { margin: 0; font-size: 17px; }
    .settings label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
    .settings label.check, .settings label.radio { flex-direction: row; align-items: flex-start; gap: 8px; }
    .settings input:not([type=checkbox]):not([type=radio]) { padding: 7px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); }
    .settings fieldset { border: 1px solid var(--line); border-radius: 8px; display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; }
    .settings legend { font-size: 12px; color: var(--muted); padding: 0 4px; }
    .settings code { word-break: break-all; }
    .settings .pkce-only { display: flex; flex-direction: column; gap: 12px; }
    .settings .btn.small { padding: 2px 8px; font-size: 12px; }
    .site-choices { display: flex; gap: 8px; flex-wrap: wrap; flex: 0 1 auto !important; }
    .warn-banner { border-color: #f59f00; background: color-mix(in srgb, #f59f00 14%, var(--panel)); }
    .warn-banner .show-sites { display: block; margin-top: 6px; }
    .btn.small { padding: 2px 8px; font-size: 12px; }
    .badge.multi { background: #f59f00; color: #1d1300; font-weight: 700; }
    .settings-foot { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .signin-badge { font-size: 11.5px; padding: 1px 8px; border-radius: 10px; border: 1px solid var(--line); color: var(--muted); white-space: nowrap; cursor: help; }
    .signin-badge:empty { display: none; }
    .signin-badge.session { border-color: #f59f00; color: #8a5a00; }
  </style>`);
}

function b64url(bytes) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

// ---------- for other tools (Report Labs): the same site and sign-in rules as the Rules Manager ----------
// The tool reads its site from ?tenant= like the manager, never talks to a site without an open tab in this
// window, and uses the same sign-in (DAM-tab token or "Sign in with Aprimo") and sign-out state.
export async function initSession() {
  await loadConfig();
  return sessionInfo();
}
export function sessionInfo() {
  return { tenant: cfg.tenant, authMode: cfg.authMode, readOnly: !!cfg.readOnly, otherOpenSites: [...otherOpenSites] };
}
export function useSiteForTool(tenant) { selectSite(tenant); }
export async function currentAccessToken({ interactive = false } = {}) {
  await ensureSiteOpen();
  return getToken({ interactive });
}
export async function connectAgain() {
  await ensureSiteOpen();
  await setSignedOut(false);
  if (cfg.authMode === 'pkce') await signIn({ interactive: true });
}
export async function refreshOtherSites() {
  const sites = await openSites();
  otherOpenSites = cfg.tenant ? sites.filter((s) => s !== cfg.tenant) : [];
  return { sites, open: !!cfg.tenant && sites.includes(cfg.tenant) };
}
// Origins of the site's DAM and main hosts (normally https://{tenant}.dam.aprimo.com and https://{tenant}.aprimo.com;
// the API/login overrides in Settings move them, as the dev fake tenant does). Used by tools built on aprimo-js.
export function siteOrigins() {
  return { dam: new URL(apiBase()).origin, main: new URL(loginBase()).origin };
}
export { AuthError, SiteError, openSites, tokenUser };

// For tool pages using setup(): show the site/sign-in banner for a failed request (as call() does).
export function showProblem(e) {
  if (e instanceof AuthError) { showAuthBanner(e.message); return true; }
  if (e instanceof SiteError) { showSiteBanner(e.message); connected = false; return true; }
  return false;
}

// For tool pages: an Aprimo DAM REST call with the shared rules (site open in this window, current token,
// sign-out respected, one retry on 401 with "Sign in with Aprimo").
export { aprimo as aprimoRequest };
