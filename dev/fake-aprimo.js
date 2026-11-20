// Development only: a fake Aprimo tenant for testing the real-API code paths without a real tenant.
// - /login/connect/authorize + /login/connect/token  (PKCE with S256 check, client credentials, refresh)
// - /api/core/rules, /rule/{id}, /fielddefinitions, /classification/{id}  (HAL, paging, select-rule header)
// - /ext/*  serves ../extension with dev/chrome-shim.js injected, so the extension page runs in a normal tab.
//
//   node dev/fake-aprimo.js            -> http://localhost:4318/ext/app/index.html
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createMockApi } from '../mock.js';
import { searchJobs, TARGETS } from './fake-jobs.js';
import { handleBulk } from './fake-bulk.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.FAKE_PORT || 4318);
const PAGE_CAP = 4; // small, so clients must page
const api = createMockApi();
const codes = new Map();   // code -> { challenge, clientId, redirectUri }
const tokens = new Map();  // access token -> expiresAt
const refreshes = new Set();
const log = (...a) => console.log('[fake-aprimo]', ...a);

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwt = (claims) => `${b64url(Buffer.from('{"alg":"none"}'))}.${b64url(Buffer.from(JSON.stringify(claims)))}.sig`;
function issue(res, withRefresh, clientId) {
  // Like Aprimo's tokens, the access token names the client (registration) that got it.
  const access = jwt({ name: 'Test User', client_id: clientId || 'unknown', exp: Math.floor(Date.now() / 1000) + 3600, jti: crypto.randomUUID() });
  tokens.set(access, Date.now() + 3600_000);
  const out = { access_token: access, expires_in: 3600, token_type: 'Bearer', scope: 'api' };
  if (withRefresh) { out.refresh_token = crypto.randomUUID(); refreshes.add(out.refresh_token); }
  return send(res, 200, out);
}

// How the fake treats user data, to reproduce tenant differences:
//   FAKE_USERS=embed (default) users embedded via select-rule; =links only HAL links returned;
//   =refuse  select-rule with users -> 400 and /user/{id} -> 403 (no permission to read users).
const USERS_MODE = process.env.FAKE_USERS || 'embed';
// Real UserResource shape: name plus first/last name and email.
const userResource = (u) => u && { id: u.id, name: u.name, firstName: u.name.split(' ')[0], lastName: u.name.split(' ').slice(1).join(' '), email: u.email, isActive: true };

const halRule = (r, select) => {
  const { conditions, actions, tag, modifiedBy, createdBy, ...rest } = r;
  const out = { ...rest, _links: {
    self: { href: `/rule/${r.id}` },
    ...(modifiedBy && { modifiedBy: { href: `https://fake.dam.aprimo.com/api/core/user/${modifiedBy.id}` } }),
    ...(createdBy && { createdBy: { href: `https://fake.dam.aprimo.com/api/core/user/${createdBy.id}` } }),
  } };
  if (select.includes('tag')) out.tag = tag;
  const emb = {};
  // FAKE_USERS=links: the select header is ignored for users, only _links come back.
  if (USERS_MODE !== 'links') {
    if (select.includes('modifiedby')) emb.modifiedBy = userResource(modifiedBy);
    if (select.includes('createdby')) emb.createdBy = userResource(createdBy);
  }
  if (select.includes('conditions')) emb.conditions = { items: conditions, _links: {} };
  if (select.includes('actions')) emb.actions = { items: actions, _links: {} };
  if (Object.keys(emb).length) out._embedded = emb;
  return out;
};

async function handleApi(req, res, p, url, body) {
  const auth = req.headers.authorization?.replace(/^Bearer /, '');
  if (!auth || !(tokens.get(auth) > Date.now())) return send(res, 401, null);
  if (req.headers['api-version'] !== '1') return send(res, 400, { message: 'API-VERSION header is required' });
  const select = String(req.headers['select-rule'] || '').toLowerCase().split(',').map((s) => s.trim());
  const page = Number(url.searchParams.get('page') || 1);
  const size = Math.min(Number(url.searchParams.get('pageSize') || 50), PAGE_CAP);
  const paged = (items) => ({ page, pageSize: size, totalCount: items.length, _embedded: { items: items.slice((page - 1) * size, page * size) } });
  let m;
  if (USERS_MODE === 'refuse' && (select.includes('modifiedby') || select.includes('createdby'))) {
    return send(res, 400, { message: "Invalid select-rule value 'modifiedBy'" });
  }
  try {
    if (req.method === 'GET' && (m = p.match(/^\/user\/([\w-]+)$/))) {
      if (USERS_MODE === 'refuse') return send(res, 403, { message: 'You do not have permission to view users.' });
      return send(res, 200, userResource(await api.getUser(m[1])));
    }
    if (req.method === 'GET' && p === '/maintenancejobs') {
      const out = searchJobs({ filter: url.searchParams.get('filter'), sort: url.searchParams.get('sort'), page: +(url.searchParams.get('page') || 1),
        pageSize: +(url.searchParams.get('pageSize') || 50), select: String(req.headers['select-maintenancejob'] || '').toLowerCase() });
      return out.error ? send(res, 400, { message: out.error }) : send(res, 200, out);
    }
    if (req.method === 'GET' && (m = p.match(/^\/maintenancejob\/([\w-]+)\/targets$/))) {
      const items = (TARGETS.get(m[1]) || []).slice(0, +(url.searchParams.get('pageSize') || 50));
      return send(res, 200, { items, totalCount: (TARGETS.get(m[1]) || []).length });
    }
    if (handleBulk(req, res, p, url, body, send, `http://localhost:${PORT}`)) return;
    if (req.method === 'GET' && p === '/rules') return send(res, 200, paged((await api.listRules()).map((r) => halRule(r, select))));
    if (req.method === 'POST' && p === '/rules') return send(res, 201, await api.createRule(body));
    if ((m = p.match(/^\/rule\/([\w-]+)$/))) {
      if (req.method === 'GET') return send(res, 200, halRule(await api.getRule(m[1]), select));
      if (req.method === 'PUT') { await api.updateRule(m[1], body); return send(res, 200, null); }
      if (req.method === 'DELETE') { await api.deleteRule(m[1]); return send(res, 204, null); }
    }
    if (req.method === 'GET' && p === '/fielddefinitions') return send(res, 200, paged(await api.listFieldDefinitions()));
    if (req.method === 'GET' && (m = p.match(/^\/classification\/([\w-]+)$/))) return send(res, 200, await api.getClassification(m[1]));
    return send(res, 404, { message: 'not found' });
  } catch (e) { return send(res, e.status || 500, { message: e.message }); }
}

function handleLogin(req, res, p, url, form) {
  if (p === '/login/connect/authorize') {
    const q = url.searchParams;
    if (q.get('code_challenge_method') !== 'S256' || !q.get('code_challenge')) return send(res, 400, { error: 'invalid_request' });
    const code = crypto.randomUUID();
    codes.set(code, { challenge: q.get('code_challenge'), clientId: q.get('client_id'), redirectUri: q.get('redirect_uri') });
    const location = `${q.get('redirect_uri')}?code=${code}&state=${encodeURIComponent(q.get('state'))}`;
    log('authorize ok for client', q.get('client_id'), 'scope', q.get('scope'));
    if (q.get('mock_json')) return send(res, 200, { location }); // chrome-shim reads this instead of following a redirect
    res.writeHead(302, { Location: location }); return res.end();
  }
  if (p === '/login/connect/token' && req.method === 'POST') {
    const g = form.get('grant_type');
    if (g === 'client_credentials') return issue(res, false, form.get('client_id'));
    if (g === 'authorization_code') {
      const c = codes.get(form.get('code'));
      codes.delete(form.get('code'));
      const expected = c && b64url(crypto.createHash('sha256').update(form.get('code_verifier') || '').digest());
      if (!c || c.challenge !== expected || c.redirectUri !== form.get('redirect_uri') || c.clientId !== form.get('client_id')) {
        log('token: PKCE check FAILED'); return send(res, 400, { error: 'invalid_grant' });
      }
      log('token: PKCE check passed');
      return issue(res, true, c.clientId);
    }
    if (g === 'refresh_token') {
      if (!refreshes.delete(form.get('refresh_token'))) return send(res, 400, { error: 'invalid_grant' });
      return issue(res, true, form.get('client_id'));
    }
    return send(res, 400, { error: 'unsupported_grant_type' });
  }
  return send(res, 404, null);
}

function serveExtension(p, res) {
  const file = path.normalize(path.join(ROOT, 'extension', p.replace(/^\/ext\//, '')));
  if (!file.startsWith(path.join(ROOT, 'extension')) || !fs.existsSync(file)) return send(res, 404, null);
  const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(file)] || 'text/plain';
  let text = fs.readFileSync(file, 'utf8');
  if (file.endsWith('.html')) text = text.replace('<script type="module"', '<script src="/dev/chrome-shim.js"></script>\n  <script type="module"');
  res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' });
  res.end(text);
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const raw = await new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); });
  const p = url.pathname;
  if (p.startsWith('/api/core/')) {
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { return send(res, 400, { message: 'bad json' }); }
    if (req.method === 'PUT' || req.method === 'POST') log(req.method, p, JSON.stringify(body).slice(0, 400));
    return handleApi(req, res, p.slice('/api/core'.length), url, body);
  }
  if (p.startsWith('/login/')) return handleLogin(req, res, p, url, new URLSearchParams(raw));
  if (p.startsWith('/uploads/') || p === '/dev/bulk-log') {
    const auth = req.headers.authorization?.replace(/^Bearer /, '');
    if (p !== '/dev/bulk-log' && !(auth && tokens.get(auth) > Date.now())) return send(res, 401, null);
    let body = null;
    if (/json/.test(req.headers['content-type'] || '')) { try { body = JSON.parse(raw); } catch {} }
    if (handleBulk(req, res, p, url, body, send, `http://localhost:${PORT}`)) return;
  }
  if (p === '/dev/chrome-shim.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(fs.readFileSync(path.join(ROOT, 'dev', 'chrome-shim.js'))); }
  if (p.startsWith('/ext/')) return serveExtension(p, res);
  send(res, 404, null);
}).listen(PORT, '127.0.0.1', () => log(`listening on http://localhost:${PORT}  (extension UI: /ext/app/index.html)`));

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(data == null ? '' : JSON.stringify(data));
}
