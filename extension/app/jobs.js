// Job Log Search: searches DAM maintenance jobs (the System → Jobs log) through the public REST API,
// GET /maintenancejobs with an Aprimo search expression. Read-only.
//
// Verified on ps1 (Nov 2026), and the reason for some choices below:
//  - Type must be matched by its full .NET name; the API returns short names (RecordMaintenanceJob), so we filter
//    with Type = "*.<ShortName>, *" (exact class match).
//  - System jobs are created by "Operator" and the built-in "Administrator"; "People only" excludes both.
//  - CreatedBy comes back only with the select-maintenancejob: createdby header.
//  - CreatedBy.Name holds the login, so the name/email box searches both Name and Email with wildcards.
import * as client from './client.js';

const $ = (s) => document.querySelector(s);
const PAGE_SIZE = 50;
const SYSTEM_USERS = ['Operator', 'Administrator'];

// Status groups shown as chips (each maps to one or more MaintenanceStatus values).
const GROUPS = [
  { id: 'failed', label: 'Failed', statuses: ['Failed'] },
  { id: 'partial', label: 'Partially failed', statuses: ['PartiallyFailed'] },
  { id: 'running', label: 'Running', statuses: ['Executing', 'AsyncExecuting'] },
  { id: 'waiting', label: 'Waiting', statuses: ['Pending', 'Queued', 'Scheduled', 'AsyncPending'] },
  { id: 'cancelled', label: 'Cancelled', statuses: ['Cancelled'] },
  { id: 'success', label: 'Succeeded', statuses: ['Success'] },
];
const groupOf = (status) => GROUPS.find((g) => g.statuses.includes(status)) || GROUPS[3];

const state = {
  page: 1,
  total: 0,
  groups: new Set(), // empty = all statuses
  jobs: [],
  types: new Set(),
  idSearch: '',
  extra: '',
  counts: {},
  seq: 0,
};

// ── search expression ────────────────────────────────────────────────────────
const q = (s) => `"${String(s).replace(/"/g, '')}"`;
function mdy(isoDate) { const [y, m, d] = isoDate.split('-'); return `${m}/${d}/${y}`; }
function nextDay(isoDate) { const d = new Date(`${isoDate}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); }

function conditions({ withStatus = true } = {}) {
  const parts = [];
  if (state.idSearch) {
    const id = state.idSearch.replace(/[{}]/g, '');
    return [`Id = ${q(id)}`];
  }
  const from = $('#fFrom').value, to = $('#fTo').value;
  if (from) parts.push(`CreatedOn >= '${mdy(from)}'`);
  if (to) parts.push(`CreatedOn < '${mdy(nextDay(to))}'`);
  const type = $('#fType').value;
  if (type) parts.push(`Type = ${q(`*.${type}, *`)}`);
  const who = $('#fWho').value;
  // A record search looks at everyone's jobs unless "System only" is picked: record jobs started by the built-in
  // Administrator (file processing after an upload, for example) would otherwise be hidden by "People only".
  if (who === 'people' && !objectId()) parts.push(`NOT (${SYSTEM_USERS.map((u) => `CreatedBy.Name = ${q(u)}`).join(' OR ')})`);
  if (who === 'system') parts.push(`(${SYSTEM_USERS.map((u) => `CreatedBy.Name = ${q(u)}`).join(' OR ')})`);
  const user = $('#fUser').value.trim();
  if (user) parts.push(`(CreatedBy.Name = ${q(`*${user}*`)} OR CreatedBy.Email = ${q(`*${user}*`)})`);
  if (withStatus && state.groups.size) {
    const statuses = GROUPS.filter((g) => state.groups.has(g.id)).flatMap((g) => g.statuses);
    parts.push(`(${statuses.map((s) => `Status = ${s}`).join(' OR ')})`);
  }
  if (state.extra) parts.push(`(${state.extra})`);
  return parts;
}
const expression = (opts) => conditions(opts).join(' AND ');

// ── API ──────────────────────────────────────────────────────────────────────
async function fetchJobs({ page, pageSize, filter, sort }) {
  const data = await client.aprimoRequest('GET', '/maintenancejobs', {
    query: { page, pageSize, sort, filter: filter || undefined },
    headers: { 'select-maintenancejob': 'createdby', Accept: 'application/json' },
  });
  return { items: data?.items || data?._embedded?.items || [], total: data?.totalCount ?? 0 };
}

async function countFor(filter) {
  try { return (await fetchJobs({ page: 1, pageSize: 1, filter })).total; } catch { return null; }
}

// ── load ─────────────────────────────────────────────────────────────────────
async function load() {
  const seq = ++state.seq;
  const filter = expression();
  $('#exprPreview').textContent = filter || '(everything)';
  if (objectId()) return scanForObject(seq, filter);
  state.scan = null;
  setStatusHtml('<span class="spinner" aria-hidden="true"></span> Searching…');
  try {
    const { items, total } = await fetchJobs({ page: state.page, pageSize: PAGE_SIZE, filter, sort: $('#fSort').value });
    if (seq !== state.seq) return;
    if (state.idSearch && !total) {
      // Not a job ID: it's probably a record ID pasted into the top box, so search job targets for it instead.
      $('#fObject').value = $('#jobId').value.trim();
      $('#jobId').value = ''; state.idSearch = '';
      toast('No job has that ID, so searching for jobs that touched that record instead');
      return load();
    }
    state.jobs = items;
    state.total = total;
    for (const j of items) if (j.type) state.types.add(j.type);
    fillTypes();
    setStatus(total ? '' : 'No jobs match these filters.');
    render();
    loadCounts(seq);
  } catch (e) {
    if (seq !== state.seq) return;
    state.jobs = []; state.total = 0; render();
    if (!client.showProblem(e)) setStatus(`Search failed: ${e.message}`, true);
    else setStatus('');
  }
}

// ── search by record / object ID ─────────────────────────────────────────────
// The API can't filter jobs by target (Target.ObjectId etc. are rejected with 400, checked on ps1), so: list the jobs
// matching the other filters, read each job's targets, keep the jobs whose targets include the object. Capped, with
// progress and Stop. Rule jobs usually have a single target, so a few days of jobs is quick.
const SCAN_MAX_JOBS = 2000;          // jobs examined per search
const SCAN_MAX_TARGETS = 5000;       // targets read per job
const normId = (s) => String(s || '').replace(/[{}\-\s]/g, '').toLowerCase();
const objectId = () => normId($('#fObject').value);

async function jobTargets(id, limit = SCAN_MAX_TARGETS) {
  const out = [];
  for (let page = 1; out.length < limit; page++) {
    const data = await client.aprimoRequest('GET', `/maintenancejob/${id}/targets`, { query: { page, pageSize: 1000 }, headers: { Accept: 'application/json' } });
    const items = data?.items || data?._embedded?.items || [];
    out.push(...items);
    if (items.length < 1000) break;
  }
  return out;
}

async function scanForObject(seq, filter) {
  const want = objectId();
  if (!/^[0-9a-f]{32}$/.test(want)) { setStatus('Enter a full object ID (a GUID, with or without dashes).'); state.jobs = []; state.total = 0; render(); return; }
  const scan = state.scan = { seq, stopped: false, examined: 0, candidates: 0, matches: [], capped: false, truncated: 0 };
  state.counts = {}; renderChips();
  const progress = () => {
    if (state.seq !== seq) return;
    const done = scan.examined >= scan.candidates && !scan.listing;
    const busy = !done && !scan.stopped;
    const stop = busy ? ' <button type="button" class="btn ghost small" id="stopScan">Stop</button>' : '';
    if (scan.listing && busy) {
      // Step 1 (listing the jobs to check) can take a few seconds with no numbers to show: say so, with a moving bar.
      setStatusHtml(`<span class="spinner" aria-hidden="true"></span> Searching for this record: finding the jobs to check` +
        (scan.candidates ? ` (${scan.candidates.toLocaleString()} so far)` : '') + '…' + stop +
        '<div class="scan-bar indeterminate" role="progressbar" aria-label="Finding jobs"><span></span></div>');
      return;
    }
    const pct = scan.candidates ? Math.round((scan.examined / scan.candidates) * 100) : 100;
    setStatusHtml((busy ? '<span class="spinner" aria-hidden="true"></span> ' : '') +
      `${done ? 'Checked' : 'Checking'} the targets of ${scan.examined.toLocaleString()} of ${scan.candidates.toLocaleString()} jobs matching the filters` +
      ` · <b>${scan.matches.length.toLocaleString()} job${scan.matches.length === 1 ? '' : 's'} touched this object</b>` +
      (scan.capped ? ` · stopped at ${SCAN_MAX_JOBS.toLocaleString()} jobs, narrow the date range to look further` : '') +
      (scan.truncated ? ` · ${scan.truncated} very large job${scan.truncated === 1 ? '' : 's'} only partly checked` : '') +
      stop + (scan.stopped ? ' · stopped' : '') +
      (done && !scan.matches.length ? '. Try a wider date range (e.g. Any time).' : '') +
      (busy ? `<div class="scan-bar" role="progressbar" aria-label="Checking jobs" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></div>` : ''));
  };
  state.jobs = []; state.total = 0; render();
  scan.listing = true; progress(); // show the search is running straight away
  try {
    // 1. Jobs matching the other filters (only those with targets can match).
    scan.listing = true;
    const queue = [];
    for (let page = 1; queue.length < SCAN_MAX_JOBS; page++) {
      const { items, total } = await fetchJobs({ page, pageSize: 1000, filter, sort: $('#fSort').value });
      if (state.seq !== seq || scan.stopped) return;
      for (const j of items) if (j.targetsCount > 0) queue.push(j);
      scan.candidates = queue.length; progress();
      if (items.length < 1000 || page * 1000 >= total) break;
    }
    if (queue.length > SCAN_MAX_JOBS) { queue.length = SCAN_MAX_JOBS; scan.capped = true; }
    scan.candidates = queue.length; scan.listing = false; progress();
    // 2. Read targets, six jobs at a time, keeping the list order (newest first by default).
    const found = new Map();
    let next = 0;
    const worker = async () => {
      while (next < queue.length && !scan.stopped && state.seq === seq) {
        const i = next++; const job = queue[i];
        try {
          const targets = await jobTargets(job.id);
          if (job.targetsCount > targets.length) scan.truncated++;
          const hits = targets.filter((t) => normId(t.objectId || t.recordId) === want);
          if (hits.length) { found.set(i, { ...job, _hits: hits }); scan.matches = [...found.keys()].sort((a, b) => a - b).map((k) => found.get(k)); state.jobs = scan.matches; state.total = scan.matches.length; render(); }
        } catch (e) { if (client.showProblem(e)) { scan.stopped = true; return; } }
        scan.examined++; if (scan.examined % 5 === 0 || scan.examined === queue.length) progress();
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    progress();
  } catch (e) {
    if (state.seq !== seq) return;
    if (!client.showProblem(e)) setStatus(`Search failed: ${e.message}`, true);
  }
}

// Counts per status group under the other filters, shown on the chips.
async function loadCounts(seq) {
  if (state.idSearch || objectId()) { state.counts = {}; renderChips(); return; }
  const base = conditions({ withStatus: false });
  const results = await Promise.all(GROUPS.map((g) => countFor([...base, `(${g.statuses.map((s) => `Status = ${s}`).join(' OR ')})`].join(' AND '))));
  if (seq !== state.seq) return;
  state.counts = Object.fromEntries(GROUPS.map((g, i) => [g.id, results[i]]));
  renderChips();
}

// Job types for the filter: from recent jobs (the API has no list of types).
async function discoverTypes() {
  try {
    const { items } = await fetchJobs({ page: 1, pageSize: 1000, sort: 'CreatedOn desc' });
    for (const j of items) if (j.type) state.types.add(j.type);
    fillTypes();
  } catch { /* the filter still works with what results show */ }
}

// ── rendering ────────────────────────────────────────────────────────────────
function fillTypes() {
  const sel = $('#fType');
  const cur = sel.value;
  const types = [...state.types].sort((a, b) => friendlyType(a).localeCompare(friendlyType(b)));
  if (sel.options.length - 1 === types.length) return;
  sel.innerHTML = '<option value="">Any type</option>' + types.map((t) => `<option value="${esc(t)}">${esc(friendlyType(t))}</option>`).join('');
  sel.value = types.includes(cur) ? cur : '';
}

function renderChips() {
  $('#statusChips').innerHTML = GROUPS.map((g) => {
    const n = state.counts[g.id];
    return `<button type="button" class="s-chip${state.groups.has(g.id) ? ' on' : ''}" data-g="${g.id}" aria-pressed="${state.groups.has(g.id)}">
      <span class="dot"></span>${g.label}${n == null ? '' : ` <span class="n">${n.toLocaleString()}</span>`}</button>`;
  }).join('');
}

function render() {
  const tbody = $('#rows');
  if (!state.jobs.length) {
    tbody.innerHTML = '';
  } else {
    tbody.innerHTML = state.jobs.map((j, i) => {
      const g = groupOf(j.status);
      const actions = (j.actions || []).map((a) => a.label || a.action).filter(Boolean);
      const failed = j.failedTargetsCount || 0;
      return `<tr data-i="${i}">
        <td><span class="st st-${g.id}" title="${esc(j.status)}">${esc(statusLabel(j.status))}</span></td>
        <td title="${esc(j.createdOn)} UTC">${fmtDateTime(j.createdOn)}</td>
        <td><div class="job-name">${esc(actions[0] || friendlyType(j.type))}</div>
          <div class="job-sub">${rulesOf(j).length ? `Rule${rulesOf(j).length > 1 ? 's' : ''}: ${rulesOf(j).map(ruleLink).join(', ')}` : esc(j.actions?.[0]?.description || (actions.length ? friendlyType(j.type) : ''))}${actions.length > 1 ? ` · +${actions.length - 1} more action${actions.length > 2 ? 's' : ''}` : ''}</div></td>
        <td title="${esc(j.createdBy?.email || '')}">${esc(who(j))}</td>
        <td class="num">${(j.targetsCount ?? 0).toLocaleString()}${failed ? `<div class="failed-n">${failed.toLocaleString()} failed</div>` : ''}</td>
        <td class="num">${esc(fmtDuration(j.executionTime))}</td>
        <td><div class="msg" title="${esc(j.message || '')}">${esc(j.message || '')}</div></td>
      </tr>`;
    }).join('');
  }
  const start = state.total ? (state.page - 1) * PAGE_SIZE + 1 : 0;
  const end = Math.min(state.page * PAGE_SIZE, state.total);
  const pages = Math.max(1, Math.ceil(state.total / PAGE_SIZE));
  $('#pager').innerHTML = state.scan ? '' : state.total
    ? `<span>${start.toLocaleString()}–${end.toLocaleString()} of ${state.total.toLocaleString()} jobs</span>
       <button class="btn ghost small" data-p="prev" ${state.page <= 1 ? 'disabled' : ''}>‹ Previous</button>
       <span>Page ${state.page} of ${pages.toLocaleString()}</span>
       <button class="btn ghost small" data-p="next" ${state.page >= pages ? 'disabled' : ''}>Next ›</button>`
    : '';
}

// ── links to the rule behind a rule job ─────────────────────────────────────
// Rule jobs describe their actions as: Execute rule actions of rule 'Name' (54eb0ae4-6b76-…).
function rulesOf(job) {
  const out = new Map();
  for (const a of job.actions || []) {
    for (const m of String(a.description || '').matchAll(/rule '(.*?)' \(\{?([0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12})\}?\)/g)) {
      out.set(m[2].toLowerCase(), m[1]);
    }
  }
  return [...out].map(([id, name]) => ({ id, name }));
}
// The Rules Manager inside Aprimo (the page this tool is shown in); opens the rule's editor.
function ruleUrl(id) {
  const parent = location.ancestorOrigins?.[0];
  const base = parent && /\.aprimo\.com$/.test(new URL(parent).hostname) && !/\.dam\.aprimo\.com$/.test(new URL(parent).hostname)
    ? `${parent}/MarketingOps/` : `https://${encodeURIComponent(client.sessionInfo().tenant)}.aprimo.com/MarketingOps/`;
  return `${base}#/management/home?arm=rules-manager&rule=${encodeURIComponent(id)}`;
}
// Aprimo's own rule page is keyed by the rule's name (an ID gives "Item not found", checked on ps1). The name is the
// one in the job's description, so a renamed rule won't open there; the Rules Manager link uses the ID and still works.
const aprimoRuleUrl = (name) => `https://${encodeURIComponent(client.sessionInfo().tenant)}.dam.aprimo.com/System/Rules/${encodeURIComponent(name)}`;
const ruleLink = (r) => `<a href="${esc(aprimoRuleUrl(r.name))}" target="_blank" rel="noopener" class="rule-link" title="Open this rule in Aprimo (new tab)">${esc(r.name)}</a>` +
  ` <a href="${esc(ruleUrl(r.id))}" target="_top" class="rule-alt" title="Open this rule in the Rules Manager (found by ID, so it works even if the rule was renamed)">Rules Manager</a>`;

// ── detail drawer ────────────────────────────────────────────────────────────
async function openJob(job) {
  const g = groupOf(job.status);
  const tenant = client.sessionInfo().tenant;
  $('#drawerTitle').textContent = (job.actions?.[0]?.label) || friendlyType(job.type);
  const rows = [
    ['Status', `<span class="st st-${g.id}">${esc(statusLabel(job.status))}</span>`],
    ['Job type', esc(friendlyType(job.type)) + ` <span class="muted small">(${esc(job.type)})</span>`],
    ['Job ID', `<code>${esc(job.id)}</code> <button class="btn ghost small" data-copy="${esc(job.id)}">Copy</button>`],
    ['Created', `${fmtDateTime(job.createdOn)} <span class="muted small">(${esc(job.createdOn)} UTC)</span>`],
    ['Started', job.startedOn ? `${fmtDateTime(job.startedOn)}` : '—'],
    ['Earliest start', job.earliestStartDate ? fmtDateTime(job.earliestStartDate) : '—'],
    ['Ran for', esc(fmtDuration(job.executionTime) || '—')],
    ['Started by', esc(who(job)) + (job.createdBy?.email ? ` <span class="muted small">${esc(job.createdBy.email)}</span>` : '')],
    ['Notify email', esc(job.creatorEmail || '—')],
    ['Priority', esc(String(job.priority ?? '—'))],
    ...(rulesOf(job).length ? [[rulesOf(job).length > 1 ? 'Rules' : 'Rule', rulesOf(job).map((r) => `${ruleLink(r)} <span class="muted small">(${esc(r.id)})</span>`).join('<br>')]] : []),
    ['Targets', `${(job.targetsCount ?? 0).toLocaleString()} total · ${(job.failedTargetsCount ?? 0).toLocaleString()} failed`],
  ];
  const actions = job.actions || [];
  const errors = job.errors || [];
  $('#drawerBody').innerHTML = `
    <dl class="detail-grid">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
    ${job.message ? `<div class="detail-section"><h3>Message</h3><pre>${esc(job.message)}</pre></div>` : ''}
    ${errors.length ? `<div class="detail-section"><h3>Errors (${errors.length})</h3><pre>${esc(errors.map((e) => typeof e === 'string' ? e : JSON.stringify(e, null, 2)).join('\n\n'))}</pre></div>` : ''}
    ${actions.length ? `<div class="detail-section"><h3>Actions (${actions.length})</h3><pre>${esc(actions.map((a) => `${a.label || a.action}${a.action && a.label ? `  [${a.action}]` : ''}${a.description ? `\n  ${a.description}` : ''}${a.parameters && Object.keys(a.parameters).length ? `\n  ${JSON.stringify(a.parameters)}` : ''}`).join('\n'))}</pre></div>` : ''}
    <div class="detail-section"><h3>Targets</h3><div id="targetsBox" class="muted small">${job.targetsCount ? 'Loading targets…' : 'This job has no targets.'}</div></div>
    <details class="detail-section"><summary class="muted small">Raw job data</summary><pre>${esc(JSON.stringify(job, null, 2))}</pre></details>`;
  $('#drawer').hidden = false; $('#scrim').hidden = false;
  if (!job.targetsCount) return;
  try {
    const data = await client.aprimoRequest('GET', `/maintenancejob/${job.id}/targets`, { query: { pageSize: 200 }, headers: { Accept: 'application/json' } });
    const items = data?.items || data?._embedded?.items || [];
    const failedOf = (t) => !!t.errorDetails || /fail/i.test(String(t.status || ''));
    const isHit = (t) => !!objectId() && normId(t.objectId || t.recordId) === objectId();
    const failedFirst = [...items].sort((a, b) => (isHit(b) - isHit(a)) || (failedOf(b) - failedOf(a)));
    const kindOf = (t) => t.ruleTarget || (t.recordId ? 'Record' : '');
    $('#targetsBox').innerHTML = items.length ? `
      <table class="targets-table"><thead><tr><th>Result</th><th>Target</th><th>Attempt</th><th>Error</th></tr></thead><tbody>
      ${failedFirst.map((t) => {
        const oid = t.objectId || t.recordId || '';
        const isRecord = /record/i.test(kindOf(t)) || !!t.recordId;
        const link = oid && isRecord
          ? `<a href="https://${encodeURIComponent(tenant)}.dam.aprimo.com/dam/contentitems/${esc(oid)}" target="_blank" rel="noopener">${esc(oid)}</a>`
          : esc(oid || t.id || '');
        const failed = failedOf(t);
        const label = t.status ? statusLabel(String(t.status)) : failed ? 'Failed' : 'OK';
        const firstLine = String(t.errorDetails || t.message || '').split('\n')[0];
        const hit = objectId() && normId(oid) === objectId();
        return `<tr${hit ? ' class="hit" title="The object you searched for"' : ''}><td><span class="st st-${failed ? 'failed' : 'success'}">${esc(label)}</span></td>
          <td>${link}${kindOf(t) ? `<div class="muted small">${esc(kindOf(t))}</div>` : ''}</td>
          <td>${esc(t.attempt ?? '')}</td>
          <td>${firstLine ? `<details><summary>${esc(firstLine)}</summary><pre>${esc(t.errorDetails || t.message)}</pre></details>` : ''}</td></tr>`;
      }).join('')}</tbody></table>
      ${job.targetsCount > items.length ? `<p class="muted small">Showing ${items.length} of ${job.targetsCount.toLocaleString()} targets (failed first).</p>` : ''}`
      : 'No target details returned.';
  } catch (e) {
    $('#targetsBox').textContent = `Couldn't load targets: ${e.message}`;
  }
}
function closeDrawer() { $('#drawer').hidden = true; $('#scrim').hidden = true; }

// ── export ───────────────────────────────────────────────────────────────────
async function exportCsv() {
  const filter = expression();
  const max = Math.min(state.total || 0, 5000);
  if (!max) { toast('Nothing to export.'); return; }
  toast(`Exporting ${max.toLocaleString()} jobs…`);
  const all = [];
  try {
    for (let page = 1; all.length < max; page++) {
      const { items } = await fetchJobs({ page, pageSize: 1000, filter, sort: $('#fSort').value });
      if (!items.length) break;
      all.push(...items);
    }
  } catch (e) { if (!client.showProblem(e)) toast(`Export failed: ${e.message}`, true); return; }
  const cols = [
    ['Status', (j) => j.status], ['Created (UTC)', (j) => j.createdOn], ['Started (UTC)', (j) => j.startedOn || ''],
    ['Job type', (j) => j.type], ['Actions', (j) => (j.actions || []).map((a) => a.label || a.action).join(' | ')],
    ['Started by', (j) => who(j)], ['Email', (j) => j.createdBy?.email || ''], ['Targets', (j) => j.targetsCount ?? 0],
    ['Failed targets', (j) => j.failedTargetsCount ?? 0], ['Ran for', (j) => j.executionTime || ''], ['Message', (j) => j.message || ''], ['Job ID', (j) => j.id],
  ];
  const cell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [cols.map(([h]) => cell(h)).join(','), ...all.slice(0, max).map((j) => cols.map(([, f]) => cell(f(j))).join(','))].join('\n');
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })),
    download: `aprimo-jobs-${client.sessionInfo().tenant}-${new Date().toISOString().slice(0, 10)}.csv`,
  });
  a.click(); URL.revokeObjectURL(a.href);
  toast(`Exported ${Math.min(all.length, max).toLocaleString()} jobs.`);
}

// ── helpers ──────────────────────────────────────────────────────────────────
function friendlyType(t) {
  if (!t) return 'Job';
  const base = String(t).replace(/MaintenanceJob$/, '').replace(/Job$/, '') || t;
  const words = base.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  return `${words.charAt(0).toUpperCase()}${words.slice(1).toLowerCase()} job`;
}
function statusLabel(s) {
  return { PartiallyFailed: 'Partially failed', AsyncPending: 'Pending (async)', AsyncExecuting: 'Executing (async)', Success: 'Succeeded' }[s] || s || '?';
}
function who(j) {
  const u = j.createdBy;
  if (!u) return 'System';
  const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  if (SYSTEM_USERS.includes(u.name)) return `System (${u.name})`;
  return name ? `${name} (${u.name})` : (u.name || u.email || 'Unknown');
}
function fmtDuration(ts) {
  if (!ts) return '';
  const m = String(ts).match(/^(?:(\d+)\.)?(\d+):(\d+):(\d+(?:\.\d+)?)$/);
  if (!m) return ts;
  const secs = (+(m[1] || 0)) * 86400 + (+m[2]) * 3600 + (+m[3]) * 60 + (+m[4]);
  if (secs < 1) return `${Math.round(secs * 1000)} ms`;
  if (secs < 60) return `${secs.toFixed(1)} s`;
  if (secs < 3600) return `${Math.floor(secs / 60)} min ${Math.round(secs % 60)} s`;
  return `${Math.floor(secs / 3600)} h ${Math.round((secs % 3600) / 60)} min`;
}
function fmtDateTime(s) {
  if (!s) return '';
  const d = new Date(s);
  return isNaN(d) ? esc(s) : d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function setStatus(msg, err) { const s = $('#status'); s.textContent = msg; s.classList.toggle('error', !!err); s.hidden = !msg; }
function setStatusHtml(html) { const s = $('#status'); s.innerHTML = html; s.classList.remove('error'); s.hidden = !html; }
let toastTimer;
function toast(msg, err) { const t = $('#toast'); t.textContent = msg; t.classList.toggle('error', !!err); t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), err ? 6000 : 3500); }
function setDays(days) {
  const today = new Date();
  $('#fTo').value = days ? today.toISOString().slice(0, 10) : '';
  const from = new Date(today); from.setDate(from.getDate() - days);
  $('#fFrom').value = days ? from.toISOString().slice(0, 10) : '';
  document.querySelectorAll('.quick .btn').forEach((b) => b.classList.toggle('active', +b.dataset.days === days));
}

// ── wiring ───────────────────────────────────────────────────────────────────
const search = () => { state.page = 1; load(); };
let typing;
for (const id of ['#fFrom', '#fTo', '#fType', '#fWho', '#fSort']) $(id).addEventListener('change', () => {
  if (id === '#fFrom' || id === '#fTo') document.querySelectorAll('.quick .btn').forEach((b) => b.classList.remove('active'));
  search();
});
$('#fUser').addEventListener('input', () => { clearTimeout(typing); typing = setTimeout(search, 400); });
$('#fObject').addEventListener('input', () => { clearTimeout(typing); typing = setTimeout(search, 500); });
$('#status').addEventListener('click', (e) => { if (e.target.id === 'stopScan' && state.scan) { state.scan.stopped = true; e.target.remove(); } });
$('#jobId').addEventListener('input', () => {
  clearTimeout(typing);
  typing = setTimeout(() => {
    const v = $('#jobId').value.trim();
    state.idSearch = /^\{?[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}\}?$/i.test(v) ? v : '';
    if (v && !state.idSearch) { setStatus('Paste a full job ID (a GUID, with or without dashes).'); return; }
    search();
  }, 300);
});
document.querySelector('.quick').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-days]'); if (!b) return;
  setDays(+b.dataset.days); search();
});
$('#statusChips').addEventListener('click', (e) => {
  const b = e.target.closest('.s-chip'); if (!b) return;
  const g = b.dataset.g;
  if (state.groups.has(g)) state.groups.delete(g); else state.groups.add(g);
  renderChips(); search();
});
$('#applyExtra').addEventListener('click', () => { state.extra = $('#fExtra').value.trim(); search(); });
$('#fExtra').addEventListener('keydown', (e) => { if (e.key === 'Enter') { state.extra = $('#fExtra').value.trim(); search(); } });
$('#copyExpr').addEventListener('click', () => navigator.clipboard.writeText(expression()).then(() => toast('Expression copied')));
$('#pager').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-p]'); if (!b) return;
  state.page += b.dataset.p === 'next' ? 1 : -1; load();
  document.querySelector('main').scrollIntoView({ block: 'start' });
});
$('#rows').addEventListener('click', (e) => { if (e.target.closest('a')) return; const tr = e.target.closest('tr[data-i]'); if (tr) openJob(state.jobs[+tr.dataset.i]); });
$('#drawerBody').addEventListener('click', (e) => {
  const c = e.target.closest('[data-copy]'); if (c) navigator.clipboard.writeText(c.dataset.copy).then(() => toast('Copied'));
});
$('#closeDrawer').addEventListener('click', closeDrawer);
$('#scrim').addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#drawer').hidden) closeDrawer(); });
$('#refreshBtn').addEventListener('click', () => load());
$('#exportBtn').addEventListener('click', exportCsv);

// Start: last 7 days, people only (the system's hourly housekeeping jobs hidden).
setDays(7);
renderChips();
const syncTopbar = () => document.documentElement.style.setProperty('--topbar-h', `${$('.topbar').offsetHeight}px`);
new ResizeObserver(syncTopbar).observe($('.topbar'));
Promise.resolve()
  .then(() => client.setup({
    reload: () => { load(); discoverTypes(); },
    clear: () => { state.jobs = []; state.total = 0; state.counts = {}; render(); renderChips(); setStatus(''); },
    toast,
  }))
  .then((ok) => { if (ok !== false) { load(); discoverTypes(); } })
  .catch((e) => { console.error(e); setStatus(`Start-up failed: ${e?.message || e}`, true); });
