// Aprimo Rules Manager - browser UI (shared by the local web app and the Chrome extension).
// All data access goes through client.js, which differs between the two.
import { describeCondition, describeAction, CONDITION_TEMPLATES, ACTION_TEMPLATES, RULE_TARGETS } from './describe.js';
import * as client from './client.js';

const $ = (s) => document.querySelector(s);
const state = {
  rules: [], fields: {}, classifications: {}, status: {},
  mode: localGet('mode') || 'compact', editing: null, // editing = { original|null }
};

// ---------- API ----------
const call = (method, url, body) => client.call(method, url, body);

async function load() {
  setStatus('Loading rules…');
  try {
    state.status = await call('GET', '/api/status');
    renderEnvBadge();
    const [rules, fields] = await Promise.all([call('GET', '/api/rules'), call('GET', '/api/fields').catch(() => [])]);
    state.rules = rules;
    state.fields = Object.fromEntries(fields.map((f) => [f.id, f]));
    await loadClassifications(rules);
    fillFilterOptions();
    fillFieldList();
    setStatus('');
    render();
    openLinkedRule();
  } catch (e) {
    setStatus(`Could not load rules: ${e.message}`, true);
  }
}

async function loadClassifications(rules) {
  const ids = new Set();
  for (const r of rules) for (const x of [...r.conditions, ...r.actions]) {
    if (x.classificationId) ids.add(x.classificationId);
    for (const id of x.classificationIds || []) if (id) ids.add(id);
  }
  const missing = [...ids].filter((id) => !(id in state.classifications));
  if (missing.length) Object.assign(state.classifications, await call('POST', '/api/classifications', { ids: missing }).catch(() => ({})));
}

// ---------- describing / search ----------
const ctx = () => ({ fields: state.fields, classifications: state.classifications });

function ruleText(r) {
  if (!r._text) {
    const c = ctx();
    r._text = [r.name, r.target, r.trigger, r.expression || '', r.tag || '',
      r.modifiedBy?.name || '', r.modifiedBy?.email || '',
      ...r.conditions.map((x) => describeCondition(x, c).plain), ...r.actions.map((x) => describeAction(x, c).plain)]
      .join('\n').toLowerCase();
  }
  return r._text;
}

function visibleRules() {
  const q = $('#search').value.trim().toLowerCase();
  const terms = q ? q.split(/\s+/) : [];
  const t = $('#fTarget').value, tr = $('#fTrigger').value, en = $('#fEnabled').value;
  const act = $('#fAction').value, cond = $('#fCondition').value;
  const by = $('#fModifiedBy').value;
  const since = modifiedSince($('#fModifiedWithin').value);
  const sort = $('#fSort').value;
  const list = state.rules.filter((r) =>
    (!t || r.target === t) && (!tr || r.trigger === tr) &&
    (!en || (en === 'on') === !!r.enabled) &&
    (!act || r.actions.some((a) => a.actionType === act)) &&
    (!cond || r.conditions.some((c) => c.conditionType === cond)) &&
    (!by || personKey(r.modifiedBy) === by) &&
    (!since || (r.modifiedOn && new Date(r.modifiedOn) >= since)) &&
    terms.every((term) => ruleText(r).includes(term)));
  const desc = sort.startsWith('-'); const key = sort.replace('-', '');
  list.sort((a, b) => String(a[key] ?? '').localeCompare(String(b[key] ?? ''), undefined, { numeric: true }) * (desc ? -1 : 1)
    || a.name.localeCompare(b.name));
  return { list, terms };
}

// ---------- rendering ----------
function render() {
  const { list, terms } = visibleRules();
  $('#count').textContent = `${list.length} of ${state.rules.length} rules`;
  const tbody = $('#rows');
  tbody.innerHTML = '';
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="muted" style="padding:24px;text-align:center">${state.rules.length ? 'No rules match these filters.' : 'No rules found.'}</td></tr>`;
    return;
  }
  const frag = document.createDocumentFragment();
  for (const r of list) {
    const tr = document.createElement('tr');
    tr.dataset.id = r.id;
    if (!r.enabled) tr.classList.add('disabled');
    tr.innerHTML = `
      <td class="c-on"><label class="switch" title="${r.enabled ? 'Enabled - click to disable' : 'Disabled - click to enable'}">
        <input type="checkbox" ${r.enabled ? 'checked' : ''} ${state.status.readOnly ? 'disabled' : ''}><span></span></label></td>
      <td><div class="name">${hl(r.name, terms)}</div>
        <div class="chips"><span class="chip">${esc(r.target)}</span><span class="chip ${r.trigger === 'Daily' ? 'daily' : ''}">${r.trigger === 'Daily' ? 'Daily' : 'On save/delete'}</span>
        ${r.includeDraftRecords ? '<span class="chip">incl. drafts</span>' : ''}${r.isInternal ? '<span class="chip">internal</span>' : ''}</div>
        <div class="meta" title="${esc(r.createdBy?.name ? `Created ${fmtDate(r.createdOn)} by ${r.createdBy.name}` : `Created ${fmtDate(r.createdOn)}`)}">v${r.version ?? '?'} · modified ${fmtDate(r.modifiedOn)}${r.modifiedBy?.name ? ` by ${hl(r.modifiedBy.name, terms)}` : ''}</div></td>
      <td class="logic-cell" data-kind="if">${logicHtml(r.conditions, 'if', terms)}</td>
      <td class="logic-cell" data-kind="then">${logicHtml(r.actions, 'then', terms)}</td>`;
    frag.appendChild(tr);
  }
  tbody.appendChild(frag);
}

function logicHtml(items, kind, terms = [], mode = state.mode) {
  const c = ctx();
  const describe = kind === 'if' ? describeCondition : describeAction;
  if (!items.length) return `<div class="logic ${mode}"><div class="line"><span class="empty">${kind === 'if' ? 'Always' : 'No actions'}</span></div></div>`;
  return `<div class="logic ${mode}">${items.map((x, i) => {
    const d = describe(x, c);
    const word = kind === 'if' ? (i === 0 ? 'if' : 'and') : (i === 0 ? 'then' : 'and');
    const ref = d.ref ? ` <span class="ref">${hl(mode === 'full' ? prettyXml(d.ref) : d.ref, terms)}</span>` : '';
    const when = x.executionTime === 'Delayed' ? '<span class="when">(delayed)</span>' : '';
    return `<div class="line"><span class="kw ${kind}">${word}</span><span class="txt">${hl(d.text, terms)}${ref}${when}</span></div>`;
  }).join('')}</div>`;
}

function fillFilterOptions() {
  const opts = (sel, values, keep) => {
    const el = $(sel); const cur = el.value;
    el.innerHTML = keep + [...values].sort().map((v) => `<option>${esc(v)}</option>`).join('');
    el.value = [...values].includes(cur) ? cur : '';
  };
  opts('#fTarget', new Set(state.rules.map((r) => r.target)), '<option value="">All</option>');
  opts('#fAction', new Set(state.rules.flatMap((r) => r.actions.map((a) => a.actionType))), '<option value="">Any</option>');
  opts('#fCondition', new Set(state.rules.flatMap((r) => r.conditions.map((c) => c.conditionType))), '<option value="">Any</option>');

  // Modified by: value is the user's id (or name), label is the name; hidden when the tenant gave no names.
  const people = new Map();
  for (const r of state.rules) if (r.modifiedBy?.name) people.set(personKey(r.modifiedBy), r.modifiedBy.name);
  const sel = $('#fModifiedBy'); const cur = sel.value;
  sel.innerHTML = '<option value="">Anyone</option>' + [...people].sort((a, b) => a[1].localeCompare(b[1]))
    .map(([k, n]) => `<option value="${esc(k)}">${esc(n)}</option>`).join('');
  sel.value = people.has(cur) ? cur : '';
  // No names: hide the filter, unless the client knows why (then show it disabled with the reason on hover).
  const label = sel.closest('label');
  const note = !people.size && client.namesNote;
  sel.disabled = !!note;
  label.title = note || '';
  label.hidden = !people.size && !note;
  if (note) sel.innerHTML = '<option value="">Not available (hover for why)</option>';
}

function personKey(p) { return p ? String(p.id || p.name || '') : ''; }

// "today" = since local midnight; a number = that many days back from now.
function modifiedSince(v) {
  if (!v) return null;
  if (v === 'today') { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  return new Date(Date.now() - Number(v) * 86_400_000);
}

function renderEnvBadge() {
  const b = $('#envBadge');
  b.textContent = state.status.mock ? 'Mock data'
    : `${state.status.domain}.dam.aprimo.com${state.status.user ? ` · ${state.status.user}` : ''}${state.status.readOnly ? ' · read-only' : ''}`;
  b.classList.toggle('warn', !!state.status.mock || !!state.status.readOnly);
  for (const id of ['#newBtn']) $(id).disabled = !!state.status.readOnly;
}

// ---------- hover popover (compact mode) ----------
const pop = $('#popover');
$('#rows').addEventListener('mouseover', (e) => {
  const cell = e.target.closest('.logic-cell');
  if (!cell || state.mode === 'full') return;
  const r = byId(cell.closest('tr').dataset.id);
  const terms = visibleRules().terms;
  pop.innerHTML = `<h4>${esc(r.name)}</h4>${logicHtml(r.conditions, 'if', terms, 'full')}<div style="height:8px"></div>${logicHtml(r.actions, 'then', terms, 'full')}`;
  pop.hidden = false;
  placePopover(e);
});
$('#rows').addEventListener('mousemove', (e) => { if (!pop.hidden) placePopover(e); });
$('#rows').addEventListener('mouseout', (e) => { if (!e.relatedTarget?.closest?.('.logic-cell')) pop.hidden = true; });
function placePopover(e) {
  const pad = 16, w = pop.offsetWidth, h = pop.offsetHeight;
  let x = e.clientX + pad, y = e.clientY + pad;
  if (x + w > innerWidth - 8) x = Math.max(8, e.clientX - w - pad);
  if (y + h > innerHeight - 8) y = Math.max(8, innerHeight - h - 8);
  pop.style.left = `${x}px`; pop.style.top = `${y}px`;
}

// ---------- list interactions ----------
$('#rows').addEventListener('click', async (e) => {
  const tr = e.target.closest('tr[data-id]');
  if (!tr) return;
  if (e.target.closest('.switch')) {
    if (e.target.tagName !== 'INPUT') return; // the label click re-fires on the input
    const r = byId(tr.dataset.id);
    const enabled = e.target.checked;
    // With other Aprimo sites open, a one-click toggle could hit the wrong site: ask first.
    if (otherSitesNote() && !confirm(`${enabled ? 'Enable' : 'Disable'} "${r.name}" on ${state.status.domain}?${otherSitesNote()}`)) {
      e.target.checked = !enabled;
      return;
    }
    try {
      const out = await call('PUT', `/api/rules/${r.id}`, { enabled });
      replaceRule(out.rule);
      toast(`${enabled ? 'Enabled' : 'Disabled'} "${r.name}"`);
    } catch (err) { e.target.checked = !enabled; toast(err.message, true); }
    return;
  }
  openEditor(byId(tr.dataset.id));
});

// ---------- editor ----------
const ed = {
  name: $('#eName'), target: $('#eTarget'), trigger: $('#eTrigger'), enabled: $('#eEnabled'), drafts: $('#eDrafts'),
  conds: $('#eConditions'), acts: $('#eActions'), tag: $('#eTag'),
};
ed.target.innerHTML = RULE_TARGETS.map((t) => `<option>${t}</option>`).join('');
$('#addCondition').innerHTML += Object.keys(CONDITION_TEMPLATES).map((k) => `<option>${k}</option>`).join('');
$('#addAction').innerHTML += Object.keys(ACTION_TEMPLATES).map((k) => `<option>${k}</option>`).join('');

function openEditor(rule, { asNew = false } = {}) {
  state.editing = { original: asNew ? null : rule };
  $('#drawerTitle').textContent = asNew ? (rule ? `New rule (copy of "${rule.name}")` : 'New rule') : `Edit: ${rule.name}`;
  const src = rule || { name: '', target: 'Record', trigger: 'WhenSavedOrDeleted', enabled: false, includeDraftRecords: false, conditions: [], actions: [], tag: null };
  ed.name.value = asNew && rule ? `${src.name} (copy)` : src.name;
  ed.target.value = src.target; ed.trigger.value = src.trigger;
  ed.enabled.checked = asNew ? false : !!src.enabled;
  ed.drafts.checked = !!src.includeDraftRecords;
  ed.conds.value = toEditableJson(src.conditions);
  ed.acts.value = toEditableJson(src.actions);
  ed.tag.value = src.tag || '';
  $('#eMeta').textContent = asNew ? 'New rules are created disabled; enable once you have checked them.'
    : `ID ${src.id} · v${src.version} · created ${fmtDate(src.createdOn)}${src.createdBy?.name ? ` by ${src.createdBy.name}` : ''}` +
      ` · modified ${fmtDate(src.modifiedOn)}${src.modifiedBy?.name ? ` by ${src.modifiedBy.name}` : ''}` +
      `${src.expression ? ` · daily expression: ${src.expression}` : ''}`;
  $('#deleteBtn').hidden = asNew; $('#duplicateBtn').hidden = asNew;
  for (const b of ['#saveBtn', '#deleteBtn']) $(b).disabled = !!state.status.readOnly;
  $('#saveBtn').textContent = asNew ? 'Create' : 'Save';
  $('#diffWrap').hidden = true;
  $('#drawer').hidden = false; $('#scrim').hidden = false;
  updatePreview();
  ed.name.focus();
}

function closeEditor() {
  if (state.editing && isDirty() && !confirm('Discard unsaved changes?')) return;
  state.editing = null;
  $('#drawer').hidden = true; $('#scrim').hidden = true;
}

// Strip ids/links and index; index is reassigned from array position on save.
function toEditableJson(items) {
  return JSON.stringify(items.map(({ index, _links, id, ...rest }) => rest), null, 2);
}

function parseList(el, errEl, label) {
  try {
    const v = JSON.parse(el.value || '[]');
    if (!Array.isArray(v)) throw new Error(`${label} must be a JSON array`);
    const key = label === 'Conditions' ? 'conditionType' : 'actionType';
    v.forEach((x, i) => { if (!x || typeof x !== 'object' || !x[key]) throw new Error(`Item ${i + 1} is missing "${key}"`); });
    el.classList.remove('invalid'); errEl.textContent = '';
    return v;
  } catch (e) {
    el.classList.add('invalid'); errEl.textContent = e.message;
    return null;
  }
}

function draft() {
  const conditions = parseList(ed.conds, $('#eConditionsErr'), 'Conditions');
  const actions = parseList(ed.acts, $('#eActionsErr'), 'Actions');
  if (!conditions || !actions) return null;
  return {
    name: ed.name.value.trim(), target: ed.target.value, trigger: ed.trigger.value, enabled: ed.enabled.checked,
    includeDraftRecords: ed.target.value === 'Record' ? ed.drafts.checked : null,
    tag: ed.tag.value.trim() || null,
    conditions: conditions.map((x, index) => ({ ...x, index })),
    actions: actions.map((x, index) => ({ ...x, index })),
  };
}

// Build the PUT/POST body: scalar fields plus addOrUpdate/remove collections keyed by index.
function requestBody(d, original) {
  const coll = (next, prev = []) => {
    const keep = new Set(next.map((x) => x.index));
    const remove = prev.map((x) => x.index).filter((i) => !keep.has(i));
    return { addOrUpdate: next, ...(remove.length ? { remove } : {}) };
  };
  const body = { name: d.name, enabled: d.enabled, target: d.target, trigger: d.trigger, tag: d.tag,
    conditions: coll(d.conditions, original?.conditions), actions: coll(d.actions, original?.actions) };
  if (d.target === 'Record') body.includeDraftRecords = d.includeDraftRecords;
  return body;
}

// Canonical text for diffing: ids/links/index dropped (index = position), keys sorted.
function comparable(r) {
  const clean = (list) => list.map(({ _links, id, index, ...x }) => sortKeys(x));
  return JSON.stringify({
    name: r.name, enabled: !!r.enabled, target: r.target, trigger: r.trigger,
    includeDraftRecords: r.target === 'Record' ? !!r.includeDraftRecords : null, tag: r.tag || null,
    conditions: clean(r.conditions), actions: clean(r.actions),
  }, null, 2);
}
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}

function isDirty() {
  const d = draft();
  if (!d) return true;
  const o = state.editing?.original;
  return o ? comparable(o) !== comparable(d) : !!(d.name || d.conditions.length || d.actions.length);
}

function updatePreview() {
  const d = draft();
  if (!d) return;
  $('#preview').innerHTML = logicHtml(d.conditions, 'if', [], 'full') + '<div style="height:8px"></div>' + logicHtml(d.actions, 'then', [], 'full');
  if (!$('#diffWrap').hidden) showDiff();
}

function showDiff() {
  const d = draft();
  if (!d) return false;
  const o = state.editing.original;
  const before = o ? comparable(o) : '';
  const after = comparable(d);
  if (o && before === after) { $('#diff').textContent = 'No changes.'; $('#diffWrap').hidden = false; return false; }
  $('#diff').innerHTML = lineDiff(before, after);
  $('#diffWrap').hidden = false;
  return true;
}

for (const el of [ed.name, ed.target, ed.trigger, ed.enabled, ed.drafts, ed.conds, ed.acts, ed.tag]) el.addEventListener('input', updatePreview);

function insertTemplate(textarea, tpl) {
  const list = JSON.parse(textarea.value || '[]');
  list.push(structuredClone(tpl));
  textarea.value = JSON.stringify(list, null, 2);
  updatePreview();
}
$('#addCondition').addEventListener('change', (e) => {
  if (!e.target.value) return;
  if (parseList(ed.conds, $('#eConditionsErr'), 'Conditions')) insertTemplate(ed.conds, CONDITION_TEMPLATES[e.target.value]);
  e.target.value = '';
});
$('#addAction').addEventListener('change', (e) => {
  if (!e.target.value) return;
  if (parseList(ed.acts, $('#eActionsErr'), 'Actions')) insertTemplate(ed.acts, ACTION_TEMPLATES[e.target.value]);
  e.target.value = '';
});

// Field-ID picker: remembers the last focused JSON box and inserts the chosen field's id at the cursor.
let lastBox = ed.acts;
for (const el of [ed.conds, ed.acts]) el.addEventListener('focus', () => (lastBox = el));
function fillFieldList() {
  $('#fieldList').innerHTML = Object.values(state.fields)
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((f) => `<option value="${esc(f.label)} — ${esc(f.name)} — ${f.id}"></option>`).join('');
}
$('#fieldPick').addEventListener('change', (e) => {
  const id = e.target.value.match(/[0-9a-f]{8}-[0-9a-f-]{27}/i)?.[0];
  e.target.value = '';
  if (!id) return;
  const { selectionStart: s, selectionEnd: t, value } = lastBox;
  lastBox.value = value.slice(0, s) + id + value.slice(t);
  lastBox.focus(); lastBox.selectionStart = lastBox.selectionEnd = s + id.length;
  updatePreview();
});

$('#reviewBtn').addEventListener('click', showDiff);
$('#saveBtn').addEventListener('click', async () => {
  const d = draft();
  if (!d) return toast('Fix the JSON errors first.', true);
  if (!d.name) return toast('Name is required.', true);
  const o = state.editing.original;
  if (!showDiff() && o) return toast('Nothing to save.');
  const verb = o ? 'Save changes to' : 'Create';
  if (!confirm(`${verb} "${d.name}" in ${state.status.mock ? 'MOCK data' : state.status.domain}? Review the diff shown in the editor.${otherSitesNote()}`)) return;
  $('#saveBtn').disabled = true;
  try {
    if (o) {
      const out = await call('PUT', `/api/rules/${o.id}`, requestBody(d, o));
      replaceRule(out.rule);
      toast(`Saved. Previous version backed up (${out.backup})`);
    } else {
      const out = await call('POST', '/api/rules', requestBody(d, null));
      if (out.rule) { state.rules.push(out.rule); await loadClassifications([out.rule]); fillFilterOptions(); }
      toast(`Created "${d.name}"`);
    }
    state.editing = null; closeEditor(); render();
  } catch (e) { toast(e.message, true); }
  finally { $('#saveBtn').disabled = !!state.status.readOnly; }
});

$('#duplicateBtn').addEventListener('click', () => {
  const src = state.editing.original;
  state.editing = null;
  openEditor(src, { asNew: true });
});

$('#deleteBtn').addEventListener('click', async () => {
  const o = state.editing.original;
  const typed = prompt(`This permanently deletes the rule in ${state.status.mock ? 'MOCK data' : state.status.domain} (a JSON backup is saved locally first).${otherSitesNote()}\nType the rule name to confirm:\n\n${o.name}`);
  if (typed !== o.name) { if (typed !== null) toast('Name did not match; nothing deleted.', true); return; }
  try {
    const out = await call('DELETE', `/api/rules/${o.id}`);
    state.rules = state.rules.filter((r) => r.id !== o.id);
    state.editing = null; closeEditor(); render();
    toast(`Deleted. Backup: ${out.backup}`);
  } catch (e) { toast(e.message, true); }
});

$('#closeDrawer').addEventListener('click', closeEditor);
$('#scrim').addEventListener('click', closeEditor);
$('#newBtn').addEventListener('click', () => openEditor(null, { asNew: true }));
$('#refreshBtn').addEventListener('click', () => { state.classifications = {}; load(); });
$('#exportBtn').addEventListener('click', () => {
  const { list } = visibleRules();
  const data = list.map(({ _text, ...r }) => r);
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })),
    download: `aprimo-rules-${state.status.domain || 'export'}-${new Date().toISOString().slice(0, 10)}.json`,
  });
  a.click(); URL.revokeObjectURL(a.href);
});

// ---------- filters, modes, keys ----------
for (const id of ['#search', '#fTarget', '#fTrigger', '#fEnabled', '#fAction', '#fCondition', '#fModifiedBy', '#fModifiedWithin', '#fSort']) $(id).addEventListener('input', render);
document.querySelectorAll('.seg button').forEach((b) => {
  b.classList.toggle('active', b.dataset.mode === state.mode);
  b.addEventListener('click', () => {
    state.mode = b.dataset.mode; localSet('mode', state.mode);
    document.querySelectorAll('.seg button').forEach((x) => x.classList.toggle('active', x === b));
    pop.hidden = true; render();
  });
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#drawer').hidden) closeEditor();
  if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); $('#search').focus(); }
  if ((e.metaKey || e.ctrlKey) && e.key === 's' && !$('#drawer').hidden) { e.preventDefault(); $('#saveBtn').click(); }
});
window.addEventListener('beforeunload', (e) => { if (state.editing && isDirty()) e.preventDefault(); });

// ---------- helpers ----------
// Extra line for confirmations when other Aprimo sites are open in tabs (extension only).
function otherSitesNote() {
  const others = client.otherOpenSites || [];
  return others.length
    ? `\n\nHeads-up: other Aprimo sites are open too (${others.join(', ')}). This change goes to ${state.status.domain} only.`
    : '';
}
function byId(id) { return state.rules.find((r) => r.id === id); }

// A link from another tool (e.g. Job Log Search) can name a rule: …&rule=<id>, with or without dashes. Opened once.
let linkedRule = new URLSearchParams(location.search).get('rule');
function openLinkedRule() {
  if (!linkedRule) return;
  const want = linkedRule.replace(/[{}-]/g, '').toLowerCase();
  linkedRule = null;
  const rule = state.rules.find((r) => String(r.id).replace(/[{}-]/g, '').toLowerCase() === want);
  if (rule) openEditor(rule);
  else toast('That rule was not found on this site (it may have been deleted).', true);
}
function replaceRule(rule) {
  const i = state.rules.findIndex((r) => r.id === rule.id);
  if (i >= 0) state.rules[i] = rule; else state.rules.push(rule);
  loadClassifications([rule]).then(() => { fillFilterOptions(); render(); });
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function hl(s, terms) {
  let out = esc(s);
  for (const t of terms) if (t) out = out.replace(new RegExp(`(${esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?![^<]*>)`, 'gi'), '<mark>$1</mark>');
  return out;
}
function prettyXml(x) {
  if (!x || x.length < 60) return x;
  let depth = 0;
  return x.replace(/>\s*</g, '>\n<').split('\n').map((line) => {
    if (/^<\//.test(line)) depth = Math.max(0, depth - 1);
    const out = '  '.repeat(depth) + line;
    if (/^<[^/!?][^>]*[^/]>$/.test(line) && !/<\/[^>]+>$/.test(line)) depth++;
    return out;
  }).join('\n');
}
function lineDiff(a, b) {
  const A = a ? a.split('\n') : [], B = b.split('\n');
  const n = A.length, m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) { out.push({ kind: 'u', text: `  ${A[i]}` }); i++; j++; }
    else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) out.push({ kind: 'a', text: `+ ${B[j++]}` });
    else out.push({ kind: 'd', text: `- ${A[i++]}` });
  }
  // show changed lines with 3 lines of context; collapse the rest into "…"
  const near = (k) => out.slice(Math.max(0, k - 3), k + 4).some((y) => y.kind !== 'u');
  const html = []; let skipped = false;
  out.forEach((x, k) => {
    if (x.kind !== 'u' || near(k)) { html.push(`<span class="${x.kind}">${esc(x.text)}</span>`); skipped = false; }
    else if (!skipped) { html.push('<span class="u muted">  …</span>'); skipped = true; }
  });
  return html.join('');
}
function fmtDate(s) { return s ? new Date(s).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '?'; }
function setStatus(msg, err) { const s = $('#status'); s.textContent = msg; s.classList.toggle('error', !!err); s.hidden = !msg; }
let toastTimer;
function toast(msg, err) {
  const t = $('#toast'); t.textContent = msg; t.classList.toggle('error', !!err); t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), err ? 6000 : 3500);
}
function localGet(k) { try { return localStorage.getItem(`arm.${k}`); } catch { return null; } }
function localSet(k, v) { try { localStorage.setItem(`arm.${k}`, v); } catch {} }

const syncTopbar = () => document.documentElement.style.setProperty('--topbar-h', `${$('.topbar').offsetHeight}px`);
new ResizeObserver(syncTopbar).observe($('.topbar'));

// The client may add its own controls (settings, sign-in) and decide when data can load.
Promise.resolve()
  .then(() => (client.setup ? client.setup({
    reload: () => { state.classifications = {}; return load(); },
    clear: () => { state.rules = []; state.fields = {}; state.classifications = {}; setStatus(''); render(); },
    toast,
  }) : true))
  .then((ok) => ok !== false && load())
  .catch((e) => { console.error(e); setStatus(`Start-up failed: ${e?.message || e}`, true); });
