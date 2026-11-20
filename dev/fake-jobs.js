// Development only: fake DAM maintenance jobs for the Job Log Search tool, plus a small evaluator for the
// Aprimo search expressions the tool sends (AND / OR / NOT, parentheses, = and >= < on dates, * wildcards).

const DAY = 86_400_000;
const now = Date.now();
const users = {
  operator: { id: 'u-op', name: 'Operator', email: '', firstName: '', lastName: 'Operator' },
  admin: { id: 'u-admin', name: 'Administrator', email: 'AdamAdministrator@aprimo.com', firstName: '', lastName: 'DAM Administrator' },
  jk: { id: 'u-jk', name: 'rlane', email: 'rebecca.lane@example.com', firstName: 'Rebecca', lastName: 'Lane' },
  eo: { id: 'u-eo', name: 'mlee', email: 'morgan.lee@example.com', firstName: 'Morgan', lastName: 'Lee' },
};
const NS = { Record: 'Adam.Core.Records', Rule: 'Adam.Core.Rules', Classification: 'Adam.Core.Classifications' };
const fullType = (t) => `${NS[t.replace(/MaintenanceJob$/, '')] || 'Adam.Core.Maintenance'}.${t}, Adam.Core`;

let seed = 7;
const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const guid = () => Array.from({ length: 32 }, () => '0123456789abcdef'[Math.floor(rnd() * 16)]).join('');

export const JOBS = [];
export const TARGETS = new Map();

function add(job, targets = []) {
  const j = { targets: null, actions: [], targetsCount: 0, creatorEmail: '', disableNotification: false, priority: 2, message: null, failedTargetsCount: 0, ...job };
  j.targetsCount = targets.length || j.targetsCount;
  j.failedTargetsCount = targets.filter((t) => t.errorDetails).length || j.failedTargetsCount;
  JOBS.push(j);
  if (targets.length) TARGETS.set(j.id, targets);
}

// System housekeeping every ~65 minutes for 40 days (Operator / Administrator), mostly successes.
for (let t = now - 40 * DAY; t < now; t += 65 * 60_000) {
  for (const [type, by] of [['FuzzyClaimsIndexSyncMaintenanceJob', 'operator'], ['AuditArchiveMaintenanceJob', 'admin'], ['ReportingMaintenanceJob', 'operator']]) {
    const created = new Date(t).toISOString();
    add({ id: guid(), type, status: rnd() < 0.01 ? 'Failed' : 'Success', createdOn: created, startedOn: new Date(t + 60_000).toISOString(),
      earliestStartDate: created, executionTime: `00:00:0${Math.floor(rnd() * 9)}.${String(Math.floor(rnd() * 1e7)).padStart(7, '0')}`, createdBy: users[by],
      targetsCount: type === 'ReportingMaintenanceJob' ? 17 : 0 });
  }
}
// People's bulk edits, rule runs and renditions, with some failures and targets.
const PEOPLE_JOBS = [
  { type: 'RecordMaintenanceJob', label: 'Set field value', action: 'OverwriteField' },
  { type: 'RecordMaintenanceJob', label: 'Classify records', action: 'ClassifyRecord' },
  { type: 'RecordMaintenanceJob', label: 'Create renditions', action: 'CreateRenditions' },
  { type: 'RuleMaintenanceJob', label: 'Run rule "Expire assets past expiry date"', action: 'RuleMaintenance' },
  { type: 'ClassificationMaintenanceJob', label: 'Move classification', action: 'ClassificationMove' },
];
for (let i = 0; i < 120; i++) {
  const t = now - rnd() * 40 * DAY;
  const kind = pick(PEOPLE_JOBS);
  const by = pick(['jk', 'eo', 'jk']);
  const roll = rnd();
  const status = roll < 0.12 ? 'Failed' : roll < 0.2 ? 'PartiallyFailed' : roll < 0.24 ? 'Cancelled' : roll < 0.27 ? 'Executing' : roll < 0.3 ? 'Queued' : 'Success';
  const n = 1 + Math.floor(rnd() * 40);
  const targets = Array.from({ length: n }, (_, k) => {
    const failed = status === 'Failed' || (status === 'PartiallyFailed' && k % 4 === 0);
    // Same shape as ps1: { id, objectId, ruleTarget, attempt, errorDetails } (no status field).
    // Every 8th people job also touches the sample record from ps1, so the object ID search has hits.
    return { id: guid(), objectId: (i % 8 === 0 && k === 0) ? '50928f10b7ca4ccf8d16b50600d18445' : guid(), ruleTarget: 'Record', attempt: 1,
      errorDetails: failed ? `System.InvalidOperationException: ${pick(['Field "Expiry Date" is read-only for this user.', 'Record is checked out by another user.', 'Validation failed: Title is required.'])}\n   at Adam.Core.Records.RecordMaintenanceAction.OnExecuteAsync(...)` : null };
  });
  add({ id: guid(), type: kind.type, status, createdOn: new Date(t).toISOString(), startedOn: status === 'Queued' ? null : new Date(t + 5_000).toISOString(),
    earliestStartDate: new Date(t).toISOString(), executionTime: status === 'Queued' ? '00:00:00' : `00:0${Math.floor(rnd() * 9)}:${String(Math.floor(rnd() * 59)).padStart(2, '0')}.5000000`,
    createdBy: users[by], creatorEmail: users[by].email,
    actions: [{ action: kind.action, label: kind.label, description: kind.type === 'RuleMaintenanceJob' ? "Execute rule actions of rule 'Expire assets past expiry date' (54eb0ae4-6b76-44cd-b358-b385007b2b27)" : `${kind.label} on selected records`, parameters: {} }],
    message: status === 'Failed' ? 'This maintenance job has been marked as failed because none of the targets were successfully executed. Please check the maintenance log for further details.'
      : status === 'PartiallyFailed' ? `${targets.filter((x) => x.errorDetails).length} of ${targets.length} targets failed.` : null }, targets);
}
JOBS.sort((a, b) => b.createdOn.localeCompare(a.createdOn));

// ── expression evaluator ────────────────────────────────────────────────────
function tokenize(s) {
  const out = []; let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if ('()'.includes(c)) { out.push(c); i++; continue; }
    if (c === '"' || c === "'") { const j = s.indexOf(c, i + 1); out.push({ str: s.slice(i + 1, j) }); i = j + 1; continue; }
    if (/[<>=]/.test(c)) { const m = s.slice(i).match(/^(>=|<=|<>|=|<|>)/)[0]; out.push({ op: m }); i += m.length; continue; }
    const m = s.slice(i).match(/^[^\s()<>="']+/)[0]; out.push(m); i += m.length;
  }
  return out;
}
const wild = (pattern, v) => new RegExp(`^${String(pattern).split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 'i').test(String(v ?? ''));
const parseDate = (s) => { const m = String(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? Date.UTC(+m[3], +m[1] - 1, +m[2]) : NaN; };

function compile(expr) {
  const toks = tokenize(expr); let pos = 0;
  const peek = () => toks[pos]; const next = () => toks[pos++];
  const isWord = (t, w) => typeof t === 'string' && t.toUpperCase() === w;
  function orExpr() { let l = andExpr(); while (isWord(peek(), 'OR')) { next(); const r = andExpr(); const a = l; l = (j) => a(j) || r(j); } return l; }
  function andExpr() {
    let l = unary();
    while (peek() !== undefined && peek() !== ')' && !isWord(peek(), 'OR')) {
      if (isWord(peek(), 'AND')) next();
      const r = unary(); const a = l; l = (j) => a(j) && r(j);
    }
    return l;
  }
  function unary() {
    if (isWord(peek(), 'NOT')) { next(); const e = unary(); return (j) => !e(j); }
    if (peek() === '(') { next(); const e = orExpr(); next(); return e; }
    const prop = next(); const op = next().op; const vt = next(); const val = typeof vt === 'object' ? vt.str : vt;
    const get = (j) => ({ status: j.status, type: fullType(j.type), id: j.id, createdon: j.createdOn, 'createdby.name': j.createdBy?.name, 'createdby.email': j.createdBy?.email })[prop.toLowerCase()];
    if (/createdon/i.test(prop)) {
      const d = parseDate(val);
      return (j) => { const v = Date.parse(j.createdOn); return op === '>=' ? v >= d : op === '<' ? v < d : op === '>' ? v > d : op === '<=' ? v <= d : v === d; };
    }
    if (/^id$/i.test(prop)) return (j) => j.id.replace(/-/g, '') === String(val).replace(/-/g, '').toLowerCase();
    return (j) => (op === '<>' ? !wild(val, get(j)) : wild(val, get(j)));
  }
  return toks.length ? orExpr() : () => true;
}

export function searchJobs({ filter, sort, page = 1, pageSize = 50, select }) {
  let list = JOBS;
  if (filter) {
    let pred;
    try { pred = compile(filter); } catch { return { error: `Invalid search expression: ${filter}` }; }
    list = list.filter(pred);
  }
  if (sort) {
    const [field, dir] = sort.split(/\s+/); const desc = /desc/i.test(dir || '');
    const key = (j) => ({ createdon: j.createdOn, status: j.status, type: j.type })[field.toLowerCase()] ?? j.createdOn;
    list = [...list].sort((a, b) => String(key(a)).localeCompare(String(key(b))) * (desc ? -1 : 1));
  }
  const size = Math.min(+pageSize || 50, 1000);
  const items = list.slice((page - 1) * size, page * size).map((j) => (select?.includes('createdby') ? j : { ...j, createdBy: null }));
  return { page: +page, pageSize: size, totalCount: list.length, items };
}
