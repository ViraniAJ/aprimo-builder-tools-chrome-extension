// Service worker: opens the app from the toolbar, records what DAM tabs report (seen / token), and forgets a
// site's sign-in as soon as its last tab is closed.

import './features.js'; // feature switches (globalThis.ARM_FEATURES)

const NOT_TENANTS = new Set(['www', 'developers', 'login', 'help', 'community', 'status', 'support', 'docs']);
// The tenant is the first label of any *.aprimo.com host (ps1.dam.aprimo.com, ps1.aprimo.com -> "ps1").
const tenantOf = (url) => {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (!/\.aprimo\.com$/.test(host)) return null;
    const t = host.split('.')[0];
    return NOT_TENANTS.has(t) ? null : t;
  } catch { return null; }
};

// A tab on Aprimo's sign-in / sign-out pages is not a signed-in site.
const signedInPage = (url) => {
  try { return !/^\/(login|logout|signin|sign-in|signout|sign-out|account\/log)/i.test(new URL(url).pathname); } catch { return false; }
};

function appUrl(tenant) {
  return chrome.runtime.getURL(`app/index.html${tenant ? `?tenant=${encodeURIComponent(tenant)}` : ''}`);
}

// The Rules Manager page inside Aprimo's Administration (added to the menu by content/aprimo-nav.js).
const adminPageUrl = (tenant) => `https://${tenant}.aprimo.com/MarketingOps/#/management/rulesDamUi?arm=manager`;

// Toolbar icon.
// - Standalone views on (features.js): open the manager in its own tab for the current tab's site.
// - Off (default): open the Rules Manager inside Aprimo's Administration, in a new tab next to the current one,
//   for the current tab's site, or else the Aprimo site open in this window. With no Aprimo site, say so.
chrome.action.onClicked.addListener(async (tab) => {
  if (globalThis.ARM_FEATURES?.standaloneViews) {
    chrome.tabs.create({ url: appUrl(tenantOf(tab?.url)) });
    return;
  }
  let tenant = tenantOf(tab?.url);
  if (!tenant) {
    const tabs = await chrome.tabs.query({ url: 'https://*.aprimo.com/*', windowId: tab?.windowId });
    const sites = [...new Set(tabs.filter((t) => signedInPage(t.url)).map((t) => tenantOf(t.url)).filter(Boolean))];
    if (sites.length === 1) tenant = sites[0];
  }
  if (!tenant) {
    // No (single) Aprimo site to open: show a hint on the icon for this tab instead.
    chrome.action.setBadgeText({ tabId: tab.id, text: '!' });
    chrome.action.setTitle({ tabId: tab.id, title: 'Open an Aprimo site in this window first, then click again (or use Administration → Rules Manager - Experimental).' });
    return;
  }
  chrome.tabs.create({ url: adminPageUrl(tenant), index: tab ? tab.index + 1 : undefined, windowId: tab?.windowId });
});

async function record(key, tenant, entry) {
  const { [key]: map = {} } = await chrome.storage.session.get(key);
  map[tenant] = entry;
  await chrome.storage.session.set({ [key]: map });
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === 'open-tab') chrome.tabs.create({ url: appUrl(msg.tenant) });
  const tenant = sender.tab ? tenantOf(sender.url) : null;
  if (!tenant) return;
  const host = new URL(sender.url).hostname;
  if (msg?.type === 'page-seen') record('pageSeen', tenant, { host, at: Date.now() });
  // The page's stored sign-in disappeared (signed out in that tab): forget the site's token right away.
  if (msg?.type === 'token-gone') forget(tenant);
  if (msg?.type === 'page-token') {
    let exp = null;
    try { exp = JSON.parse(atob(msg.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp || null; } catch {}
    record('pageTokens', tenant, { token: msg.token, host, exp, source: msg.source || 'request', at: Date.now() });
  }
});

async function forget(tenant) {
  const { pageTokens = {} } = await chrome.storage.session.get('pageTokens');
  if (pageTokens[tenant]) { delete pageTokens[tenant]; await chrome.storage.session.set({ pageTokens }); }
}

// When tabs close, navigate away or land on a sign-in/sign-out page, drop every sign-in (DAM-tab token or PKCE
// token) of sites with no signed-in tab open.
async function forgetClosedSites() {
  const tabs = await chrome.tabs.query({ url: 'https://*.aprimo.com/*' });
  const open = new Set(tabs.filter((t) => signedInPage(t.url)).map((t) => tenantOf(t.url)).filter(Boolean));
  const all = await chrome.storage.session.get(null);
  const remove = Object.keys(all).filter((k) => k.startsWith('token:') && !open.has(k.slice(6)));
  for (const key of ['pageTokens', 'pageSeen']) {
    const map = all[key] || {};
    const kept = Object.fromEntries(Object.entries(map).filter(([t]) => open.has(t)));
    if (Object.keys(kept).length !== Object.keys(map).length) await chrome.storage.session.set({ [key]: kept });
  }
  if (remove.length) await chrome.storage.session.remove(remove);
}
let timer;
const soon = () => { clearTimeout(timer); timer = setTimeout(forgetClosedSites, 500); };
chrome.tabs.onRemoved.addListener(soon);
chrome.tabs.onUpdated.addListener((_id, change) => { if (change.url) soon(); });
chrome.runtime.onStartup.addListener(soon);

// ── Aprimo Wisp ─────────────────────────────────────────────────────────────
// The shortcut (Alt+Shift+Space by default) opens the Wisp side panel and starts listening; pressed again while the
// panel is open, it stops listening. A panel that is just opening picks the request up from session storage.
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'wisp-talk') return;
  await chrome.storage.session.set({ 'wisp.talkAt': Date.now() });
  try { await chrome.sidePanel.open({ windowId: tab?.windowId ?? (await chrome.windows.getCurrent()).id }); } catch (e) { console.warn('[wisp] side panel:', e); }
  chrome.runtime.sendMessage({ kind: 'wisp-talk' }).catch(() => {});
});

// The Wisp button in Aprimo's top bar (content/wisp-agent.js): same as the shortcut. The click is a user action, so
// the side panel may open; open it first, before anything else is awaited.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.kind !== 'wisp-open' || !sender.tab) return;
  if (msg.talk) chrome.storage.session.set({ 'wisp.talkAt': Date.now() });
  chrome.sidePanel.open({ windowId: sender.tab.windowId })
    .then(() => { chrome.runtime.sendMessage({ kind: 'wisp-talk' }).catch(() => {}); sendResponse({ ok: true }); })
    .catch((e) => { console.warn('[wisp] side panel:', e); sendResponse({ ok: false }); });
  return true;
});

// Timers and reminders set by asking Wisp ("remind me in 20 minutes to check the upload").
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm.name.startsWith('wisp-timer:')) return;
  const id = alarm.name.slice(11);
  const { 'wisp.timers': timers = [], 'wisp.settings': settings = {} } = await chrome.storage.local.get(['wisp.timers', 'wisp.settings']);
  const t = timers.find((x) => x.id === id);
  await chrome.storage.local.set({ 'wisp.timers': timers.filter((x) => x.id !== id), 'wisp.lastTimer': t || null });
  const text = t?.label ? `Reminder: ${t.label}.` : "Time's up! Your timer is done.";
  if (settings.speak !== false) chrome.tts.speak(text, { rate: settings.rate || 1, volume: settings.volume ?? 1, ...(settings.voiceName ? { voiceName: settings.voiceName } : {}) });
  chrome.notifications.create(`wisp-${id}`, { type: 'basic', iconUrl: 'app/wisp/icon-128.png', title: t?.label ? 'Reminder' : 'Timer', message: text, priority: 2 });
});
