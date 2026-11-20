// Aprimo DAM Rules Manager - local proxy server (Node 18+, no dependencies).
// Holds the client credentials, fetches tokens, and forwards rule calls to the DAM REST API.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMockApi } from './mock.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.join(ROOT, '.env'));

const PORT = Number(process.env.PORT || 4317);
const MOCK = process.env.MOCK === '1' || process.argv.includes('--mock');
const READ_ONLY = process.env.READ_ONLY === '1';
const DOMAIN = process.env.APRIMO_DOMAIN; // e.g. "mycompany" for mycompany.dam.aprimo.com
const CLIENT_ID = process.env.APRIMO_CLIENT_ID;
const CLIENT_SECRET = process.env.APRIMO_CLIENT_SECRET;
const BACKUP_DIR = path.join(ROOT, 'backups');

if (!MOCK && (!DOMAIN || !CLIENT_ID || !CLIENT_SECRET)) {
  console.error('Missing APRIMO_DOMAIN, APRIMO_CLIENT_ID or APRIMO_CLIENT_SECRET. Copy .env.example to .env and fill it in, or run with --mock.');
  process.exit(1);
}

// The overrides exist for testing against dev/fake-aprimo.js.
const API_BASE = process.env.APRIMO_API_BASE || `https://${DOMAIN}.dam.aprimo.com/api/core`;
const TOKEN_URL = process.env.APRIMO_TOKEN_URL || `https://${DOMAIN}.aprimo.com/login/connect/token`;
const RULE_SELECT = 'conditions, actions, tag';

// ---------- Aprimo client ----------

let token = null; // { value, expiresAt }

async function getToken() {
  if (token && Date.now() < token.expiresAt - 60_000) return token.value;
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'api', client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
  });
  if (!res.ok) throw new HttpError(res.status, `Token request failed: ${await res.text()}`);
  const json = await res.json();
  token = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return token.value;
}

async function aprimo(method, urlPath, { body, headers = {}, query } = {}) {
  const url = new URL(API_BASE + urlPath);
  if (query) for (const [k, v] of Object.entries(query)) if (v != null) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${await getToken()}`,
      'API-VERSION': '1',
      Accept: 'application/hal+json',
      'User-Agent': 'aprimo-rules-manager',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) throw new HttpError(res.status, data?.message || data?.title || text || res.statusText, data);
  return data;
}

// Rules are fetched with their last modifier and creator embedded (same request). If the tenant ever refuses
// that, fall back to the plain request so the list still loads, just without names.
const RULE_SELECT_USERS = `${RULE_SELECT}, modifiedBy, createdBy`;
let usersSelectOk = true;
async function withUsers(fn) {
  if (usersSelectOk) {
    try { return await fn(RULE_SELECT_USERS); }
    catch (e) { if (e.status === 401) throw e; usersSelectOk = false; }
  }
  return fn(RULE_SELECT);
}

const realApi = {
  listRules() {
    return withUsers(async (select) => {
      const all = [];
      for (let page = 1; ; page++) {
        const data = await aprimo('GET', '/rules', { query: { page, pageSize: 100 }, headers: { 'select-rule': select } });
        const items = data?._embedded?.items || data?.items || [];
        all.push(...items);
        const total = data?.totalCount ?? items.length;
        if (items.length === 0 || all.length >= total) break;
      }
      return all.map(normalizeRule);
    });
  },
  getRule(id) {
    return withUsers(async (select) => normalizeRule(await aprimo('GET', `/rule/${id}`, { headers: { 'select-rule': select } })));
  },
  async updateRule(id, body) { await aprimo('PUT', `/rule/${id}`, { body }); },
  async createRule(body) { return aprimo('POST', '/rules', { body, headers: { Accept: 'application/json' } }); },
  async deleteRule(id) { await aprimo('DELETE', `/rule/${id}`); },
  async listFieldDefinitions() {
    const all = [];
    for (let page = 1; ; page++) {
      const data = await aprimo('GET', '/fielddefinitions', { query: { page, pageSize: 500 } });
      const items = data?._embedded?.items || data?.items || [];
      all.push(...items.map((f) => ({ id: f.id, name: f.name, label: f.label || f.labels?.[0]?.value || f.name })));
      const total = data?.totalCount ?? items.length;
      if (items.length === 0 || all.length >= total) break;
    }
    return all;
  },
  async getClassification(id) {
    const c = await aprimo('GET', `/classification/${id}`);
    return { id: c.id, name: c.name, namePath: c.namePath || c.name };
  },
};

// Aprimo returns embedded collections under _embedded; flatten to plain arrays.
function normalizeRule(r) {
  const emb = r._embedded || {};
  const items = (x) => x?.items || x?._embedded?.items || [];
  const { _links, _embedded, ...rest } = r;
  return {
    ...rest,
    conditions: items(emb.conditions || r.conditions).sort((a, b) => a.index - b.index),
    actions: items(emb.actions || r.actions).sort((a, b) => a.index - b.index),
    modifiedBy: person(emb.modifiedBy || r.modifiedBy),
    createdBy: person(emb.createdBy || r.createdBy),
  };
}

function person(u) {
  if (!u) return null;
  const name = u.name || [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || null;
  return { id: u.id || null, name, email: u.email || null };
}

const api = MOCK ? createMockApi() : realApi;

// ---------- Lookups (cached) ----------

let fieldCache = null;
const classificationCache = new Map();

async function fields() {
  if (!fieldCache) fieldCache = await api.listFieldDefinitions();
  return fieldCache;
}

async function classifications(ids) {
  const out = {};
  await Promise.all(ids.map(async (id) => {
    if (!classificationCache.has(id)) {
      try { classificationCache.set(id, await api.getClassification(id)); }
      catch { classificationCache.set(id, { id, name: null, namePath: null }); }
    }
    out[id] = classificationCache.get(id);
  }));
  return out;
}

// ---------- Backups ----------

function backup(rule, reason) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeName = String(rule.name || rule.id).replace(/[^\w.-]+/g, '_').slice(0, 60);
  const file = path.join(BACKUP_DIR, `${stamp}_${reason}_${safeName}_${rule.id}.json`);
  fs.writeFileSync(file, JSON.stringify(rule, null, 2));
  return path.relative(ROOT, file);
}

// ---------- HTTP server ----------

const routes = [
  ['GET', /^\/api\/status$/, async () => ({ mock: MOCK, readOnly: READ_ONLY, domain: MOCK ? 'mock' : DOMAIN })],
  ['GET', /^\/api\/rules$/, async () => api.listRules()],
  ['GET', /^\/api\/rules\/([\w-]+)$/, async (m) => api.getRule(m[1])],
  ['PUT', /^\/api\/rules\/([\w-]+)$/, async (m, body) => {
    guardWrite();
    const before = await api.getRule(m[1]);
    const file = backup(before, 'before-edit');
    await api.updateRule(m[1], body);
    return { ok: true, backup: file, rule: await api.getRule(m[1]) };
  }],
  ['POST', /^\/api\/rules$/, async (_m, body) => {
    guardWrite();
    const created = await api.createRule(body);
    const id = created?.id || created?.Id;
    return { ok: true, id, rule: id ? await api.getRule(id) : null };
  }],
  ['DELETE', /^\/api\/rules\/([\w-]+)$/, async (m) => {
    guardWrite();
    const file = backup(await api.getRule(m[1]), 'before-delete');
    await api.deleteRule(m[1]);
    return { ok: true, backup: file };
  }],
  ['GET', /^\/api\/fields$/, async () => fields()],
  ['POST', /^\/api\/classifications$/, async (_m, body) => classifications((body?.ids || []).slice(0, 200))],
];

function guardWrite() {
  if (READ_ONLY) throw new HttpError(403, 'Server is running with READ_ONLY=1; edits are disabled.');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) {
      const route = routes.find(([m, re]) => m === req.method && re.test(url.pathname));
      if (!route) throw new HttpError(404, 'Not found');
      const body = ['PUT', 'POST'].includes(req.method) ? await readJson(req) : undefined;
      return send(res, 200, await route[2](url.pathname.match(route[1]), body));
    }
    return serveStatic(url.pathname, res);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    return send(res, status, { error: err.message, details: err.details });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Aprimo Rules Manager on http://localhost:${PORT}  (${MOCK ? 'MOCK data' : DOMAIN}${READ_ONLY ? ', read-only' : ''})`);
});

// ---------- helpers ----------

class HttpError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data ?? null));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 5e6) req.destroy(); });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new HttpError(400, 'Invalid JSON body')); } });
    req.on('error', reject);
  });
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
function serveStatic(p, res) {
  const pub = path.join(ROOT, 'public');
  const file = path.normalize(path.join(pub, p === '/' ? 'index.html' : p));
  if (!file.startsWith(pub) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('Not found');
  }
  res.writeHead(200, { 'Content-Type': (MIME[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8' });
  fs.createReadStream(file).pipe(res);
}

function safeJson(t) { try { return JSON.parse(t); } catch { return { message: t }; } }

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
