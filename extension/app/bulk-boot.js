// Bulk Versioning (ported from Aprimo Admin Tools). This page sets up the site and sign-in with the shared client
// (same rules as the Rules Manager), then loads the React tool, built from tools-src/bulk-versioning into bulk/.
// The tool asks for a fresh token on every request, so token refreshes never restart it (dropped files stay put).
import * as client from './client.js';

const $ = (s) => document.querySelector(s);
const MODE = new URLSearchParams(location.search).get('mode') === 'preview' ? 'preview' : 'version';
const TITLE = MODE === 'preview' ? 'Bulk Previews' : 'Bulk Versioning';
document.title = `${TITLE} · Aprimo Builder Tools`;
$('#toolTitle').textContent = TITLE;

let toastTimer;
function toast(msg, err) {
  const t = $('#toast'); t.textContent = msg; t.classList.toggle('error', !!err); t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), err ? 6000 : 3500);
}

let started = false;
function start() {
  if (started) return;
  const { tenant } = client.sessionInfo();
  if (!tenant) return;
  started = true;
  window.armBridge = {
    tenant,
    origins: client.siteOrigins(),
    inAprimo: document.body.classList.contains('in-aprimo-page'),
    getAccessToken: () => client.currentAccessToken(),
    showProblem: (e) => client.showProblem(e),
    tokenRejected: (opts) => client.tokenRejected(opts),
  };
  const s = document.createElement('script');
  s.src = 'bulk/bulk-versioning.js';
  s.onerror = () => { $('#status').textContent = 'The tool bundle is missing: run "npm run build:tools" and reload the extension.'; $('#status').classList.add('error'); };
  document.body.appendChild(s);
}

Promise.resolve()
  .then(() => client.setup({ reload: start, clear: () => {}, toast }))
  .then((ok) => { if (ok !== false) start(); })
  .catch((e) => { console.error(e); $('#status').textContent = `Start-up failed: ${e?.message || e}`; });
