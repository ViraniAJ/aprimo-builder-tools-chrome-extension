// In-memory stand-in for the Aprimo rule endpoints, used with --mock for demos and testing.
// Applies PUT/POST bodies the same way the real API documents them (addOrUpdate / remove by index).

import { randomUUID } from 'node:crypto';

const F = {
  title: '11111111-0000-0000-0000-000000000001',
  status: '11111111-0000-0000-0000-000000000002',
  expiry: '11111111-0000-0000-0000-000000000003',
  desc: '11111111-0000-0000-0000-000000000004',
  descFr: '11111111-0000-0000-0000-000000000005',
  region: '11111111-0000-0000-0000-000000000006',
};
const C = {
  expired: '22222222-0000-0000-0000-000000000001',
  brand: '22222222-0000-0000-0000-000000000002',
  social: '22222222-0000-0000-0000-000000000003',
};

const now = Date.now();
const day = 86_400_000;
const rule = (name, target, trigger, enabled, conditions, actions, extra = {}) => ({
  id: randomUUID(), name, target, trigger, enabled, version: 1 + Math.floor(Math.random() * 6),
  includeDraftRecords: target === 'Record' ? false : null, isInternal: false, tag: null,
  createdOn: new Date(now - 200 * day * Math.random()).toISOString(),
  modifiedOn: new Date(now - 30 * day * Math.random()).toISOString(),
  conditions: conditions.map((c, index) => ({ index, ...c })),
  actions: actions.map((a, index) => ({ index, executionTime: 'Immediately', ...a })),
  ...extra,
});

const seed = () => [
  rule('Expire assets past expiry date', 'Record', 'Daily', true,
    [{ conditionType: 'CompareFieldValue', expression: `FieldName('Expiry Date') < Today` },
     { conditionType: 'RecordStatusIs', status: 'Released' }],
    [{ actionType: 'ChangeRecordStatus', status: 'Archived', executionTime: 'Delayed' },
     { actionType: 'ClassifyRecord', gettingType: 'Specified', identifierType: 'Identifier', classificationId: C.expired, reference: '' }],
    { expression: `FieldName('Expiry Date') < Today AND Status = Released` }),
  rule('Auto-tag new images with Aprimo AI', 'Record', 'WhenSavedOrDeleted', true,
    [{ conditionType: 'FileAdded' }, { conditionType: 'ContentTypeIs', contentType: 'Image', directLinkOnly: false }],
    [{ actionType: 'AprimoAI', options: 'SmartTags', executionTime: 'Delayed' },
     { actionType: 'CreateRenditions', renditionPresets: ['Web 1200', 'Thumbnail 400'], executionTime: 'Delayed' }]),
  rule('Copy title into description when empty', 'Record', 'WhenSavedOrDeleted', true,
    [{ conditionType: 'ObjectCreatedOrChanged' },
     { conditionType: 'Reference', reference: `<ref:switch><case><when><ref:fieldName name="Description" /></when><then>false</then></case><default>true</default></ref:switch>` }],
    [{ actionType: 'SetFieldValue', fieldDefinitionId: F.desc, reference: `<ref:fieldName name="Title" />` }]),
  rule('Notify brand team on Brand classification', 'Record', 'WhenSavedOrDeleted', false,
    [{ conditionType: 'ClassificationLinked', classificationId: C.brand, directLinkOnly: true }],
    [{ actionType: 'SendEmail', targetType: 'SubscribersList', subscribersList: 'brand-team', reference: '' }]),
  rule('Translate description to French', 'Record', 'WhenSavedOrDeleted', true,
    [{ conditionType: 'HasFieldValueChanged', fieldDefinitionId: F.desc }],
    [{ actionType: 'RunTranslationAgent', fieldDefinitionIds: [F.descFr], fieldScope: 'OnlyChangedFields', executionTime: 'Delayed' }]),
  rule('Push approved social assets to webhook', 'Record', 'WhenSavedOrDeleted', true,
    [{ conditionType: 'RecordStatusSetTo', status: 'Approved' }, { conditionType: 'ClassifiedIn', classificationId: C.social, directLinkOnly: false }],
    [{ actionType: 'SetFieldValue', fieldDefinitionId: F.status,
       reference: `<ref:httpRequest uri="https://example-func.azurewebsites.net/api/publish" method="POST"><ref:body><ref:fieldName name="Title" /></ref:body></ref:httpRequest>`,
       executionTime: 'Delayed' },
     { actionType: 'CreatePublicLinks', presets: [{ presetName: 'Social 1080', presetType: 'Rendition' }] }]),
  rule('Set region from uploader', 'Record', 'WhenSavedOrDeleted', true,
    [{ conditionType: 'ObjectCreated' }, { conditionType: 'CurrentlyLoggedOnUser', userId: 'svc-importer', isUser: false }],
    [{ actionType: 'SetFieldValue', fieldDefinitionId: F.region, reference: `<ref:user property="Region" />` }]),
  rule('Unclassify from Expired when re-released', 'Record', 'WhenSavedOrDeleted', true,
    [{ conditionType: 'RecordStatusSetTo', status: 'Released' }, { conditionType: 'ClassifiedIn', classificationId: C.expired, directLinkOnly: true }],
    [{ actionType: 'UnclassifyRecord', gettingType: 'Specified', identifierType: 'Identifier', unlinkTarget: 'Classification', classificationId: C.expired, classificationIds: [], reference: '' }]),
  rule('Rebuild collection on delete', 'Collection', 'WhenSavedOrDeleted', false,
    [{ conditionType: 'ObjectDeleted' }],
    [{ actionType: 'Reference', reference: `<ref:maintenance action="RebuildIndex" />` }]),
  rule('Daily video summaries', 'Record', 'Daily', true,
    [{ conditionType: 'ContentTypeIs', contentType: 'Video', directLinkOnly: false }, { conditionType: 'MasterPreviewExists' }],
    [{ actionType: 'VideoSummary', executionTime: 'Delayed' }, { actionType: 'EnhancedCaptioning', executionTime: 'Delayed' }],
    { expression: `ContentType = Video` }),
];

const fields = [
  { id: F.title, name: 'Title', label: 'Title' },
  { id: F.status, name: 'PublishStatus', label: 'Publish status' },
  { id: F.expiry, name: 'ExpiryDate', label: 'Expiry Date' },
  { id: F.desc, name: 'Description', label: 'Description' },
  { id: F.descFr, name: 'Description_fr', label: 'Description (French)' },
  { id: F.region, name: 'Region', label: 'Region' },
];
const classes = {
  [C.expired]: { id: C.expired, name: 'Expired', namePath: '/Lifecycle/Expired' },
  [C.brand]: { id: C.brand, name: 'Brand', namePath: '/Marketing/Brand' },
  [C.social]: { id: C.social, name: 'Social', namePath: '/Channels/Social' },
};

const USERS = [
  { id: '33333333-0000-0000-0000-000000000001', name: 'Jordan Lee', email: 'jordan.lee@example.com' },
  { id: '33333333-0000-0000-0000-000000000002', name: 'Sam Patel', email: 'sam.patel@example.com' },
  { id: '33333333-0000-0000-0000-000000000003', name: 'Alex Kim', email: 'alex.kim@example.com' },
];
const ME = { id: '33333333-0000-0000-0000-0000000000ff', name: 'Test User', email: 'test.user@example.com' };
// Spread modified dates over today / this week / this month / older, so the date filter has something to show.
const AGES_DAYS = [0.05, 2, 5, 12, 20, 40, 60, 3, 0.3, 95];
function withAuthors(rules) {
  rules.forEach((r, i) => {
    r.createdBy = USERS[(i + 1) % USERS.length];
    r.modifiedBy = USERS[i % USERS.length];
    r.modifiedOn = new Date(now - AGES_DAYS[i % AGES_DAYS.length] * day).toISOString();
    if (new Date(r.createdOn) > new Date(r.modifiedOn)) r.createdOn = new Date(new Date(r.modifiedOn).getTime() - 30 * day).toISOString();
  });
  return rules;
}

const clone = (x) => JSON.parse(JSON.stringify(x));
const notFound = () => Object.assign(new Error('Rule not found'), { status: 404 });

function applyCollection(list, change) {
  if (!change) return list;
  let out = list.filter((x) => !(change.remove || []).includes(x.index));
  for (const item of change.addOrUpdate || []) {
    const i = out.findIndex((x) => x.index === item.index);
    if (i >= 0) out[i] = { ...item }; else out.push({ ...item });
  }
  return out.sort((a, b) => a.index - b.index);
}

export function createMockApi() {
  const rules = withAuthors(seed());
  const find = (id) => rules.find((r) => r.id === id) || (() => { throw notFound(); })();
  return {
    async listRules() { return clone(rules); },
    async getRule(id) { return clone(find(id)); },
    async updateRule(id, body) {
      const r = find(id);
      if (!body.name && body.name !== undefined) throw Object.assign(new Error('Name is required'), { status: 400 });
      for (const k of ['name', 'enabled', 'target', 'trigger', 'tag', 'includeDraftRecords', 'isInternal', 'expression']) if (k in body) r[k] = body[k];
      r.conditions = applyCollection(r.conditions, body.conditions);
      r.actions = applyCollection(r.actions, body.actions);
      r.version += 1; r.modifiedOn = new Date().toISOString(); r.modifiedBy = ME;
    },
    async createRule(body) {
      if (!body.name) throw Object.assign(new Error('Name is required'), { status: 400 });
      const r = rule(body.name, body.target || 'Record', body.trigger || 'WhenSavedOrDeleted', body.enabled ?? false, [], []);
      Object.assign(r, { tag: body.tag ?? null, includeDraftRecords: body.includeDraftRecords ?? null, version: 1,
        createdOn: new Date().toISOString(), modifiedOn: new Date().toISOString(), createdBy: ME, modifiedBy: ME });
      r.conditions = applyCollection([], body.conditions);
      r.actions = applyCollection([], body.actions);
      rules.push(r);
      return { id: r.id };
    },
    async deleteRule(id) { const i = rules.indexOf(find(id)); rules.splice(i, 1); },
    async listFieldDefinitions() { return clone(fields); },
    async getUser(id) {
      const u = [...USERS, ME].find((x) => x.id === id);
      if (!u) throw Object.assign(new Error('User not found'), { status: 404 });
      return clone(u);
    },
    async getClassification(id) { if (!classes[id]) throw notFound(); return clone(classes[id]); },
  };
}
