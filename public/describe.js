// Turns Aprimo rule conditions/actions into readable one-liners, and holds
// blank templates for each type (property names taken from the DAM OpenAPI spec).

export const RULE_TARGETS = ['Record', 'Collection', 'Classification', 'FieldDefinition', 'FieldGroup', 'User', 'UserGroup',
  'Language', 'FileType', 'Watermark', 'Translation', 'SettingDefinition', 'SettingCategory', 'IndexerTask',
  'Organization', 'Site', 'Publication', 'Subscription', 'FileStore', 'SavedView'];

const fieldName = (id, c) => (id ? (c.fields[id]?.label || c.fields[id]?.name || short(id)) : '?');
const className = (id, c) => (id ? (c.classifications[id]?.namePath || c.classifications[id]?.name || short(id)) : '?');
const short = (id) => `${String(id).slice(0, 8)}…`;
const q = (s) => `"${s ?? ''}"`;

// Each describer returns { text, ref? } where ref is a raw reference/expression shown as code.
const CONDITIONS = {
  ObjectCreated: () => ({ text: 'object is created' }),
  ObjectChanged: () => ({ text: 'object is changed' }),
  ObjectCreatedOrChanged: () => ({ text: 'object is created or changed' }),
  ObjectDeleted: () => ({ text: 'object is deleted' }),
  FileAdded: () => ({ text: 'a file is added' }),
  FileProcessingCompleted: () => ({ text: 'file processing has completed' }),
  MovieAddedWithoutMoviePreview: (x) => ({ text: `a movie is added without a movie preview${x.moviePreviewExtension ? ` (${x.moviePreviewExtension})` : ''}` }),
  MasterPreviewExists: () => ({ text: 'master preview exists' }),
  MasterPreviewChanged: () => ({ text: 'master preview changed' }),
  ClassificationLinked: (x, c) => ({ text: `classification ${className(x.classificationId, c)} is linked${x.directLinkOnly ? ' (direct only)' : ''}` }),
  ClassificationUnlinked: (x, c) => ({ text: `classification ${className(x.classificationId, c)} is unlinked${x.directLinkOnly ? ' (direct only)' : ''}` }),
  ClassifiedIn: (x, c) => ({ text: `is classified in ${className(x.classificationId, c)}${x.directLinkOnly ? ' (direct only)' : ''}` }),
  CurrentlyLoggedOnUser: (x) => ({ text: `logged-on ${x.isUser === false ? 'user is not' : 'user is'} ${x.userId || '?'}` }),
  CompareFieldValue: (x) => ({ text: 'field comparison:', ref: x.expression }),
  HasFieldValueChanged: (x, c) => ({ text: `field ${q(fieldName(x.fieldDefinitionId, c))} changed` }),
  MultilingualFieldValuesChanged: (x, c) => ({ text: `multilingual values changed in ${(x.fieldDefinitionIds || []).map((id) => q(fieldName(id, c))).join(', ') || 'any field'}` }),
  ContentTypeChanged: () => ({ text: 'content type changed' }),
  ContentTypeIs: (x) => ({ text: `content type is ${q(x.contentType)}` }),
  ContentTypeSetTo: (x) => ({ text: `content type set to ${q(x.contentType)}` }),
  ContentTypeChangedTo: (x) => ({ text: `content type set to ${q(x.contentType)}` }),
  RecordStatusChanged: () => ({ text: 'record status changed' }),
  RecordStatusIs: (x) => ({ text: `status is ${q(x.status)}` }),
  RecordStatusSetTo: (x) => ({ text: `status set to ${q(x.status)}` }),
  RecordStatusChangedTo: (x) => ({ text: `status set to ${q(x.status)}` }),
  Reference: (x) => ({ text: 'reference is true:', ref: x.reference }),
};

const ACTIONS = {
  SetFieldValue: (x, c) => ({ text: `set ${q(fieldName(x.fieldDefinitionId, c))} =`, ref: x.reference }),
  ClassifyRecord: (x, c) => x.gettingType === 'CalculatedByReference'
    ? { text: 'classify in (by reference):', ref: x.reference }
    : { text: `classify in ${className(x.classificationId, c)}` },
  UnclassifyRecord: (x, c) => x.gettingType === 'CalculatedByReference'
    ? { text: 'unclassify from (by reference):', ref: x.reference }
    : { text: `unclassify from ${[x.classificationId, ...(x.classificationIds || [])].filter(Boolean).map((id) => className(id, c)).join(', ') || '?'}${x.unlinkTarget === 'ClassificationsDescendants' ? ' and descendants' : ''}` },
  ChangeRecordStatus: (x) => ({ text: `change status to ${q(x.status)}` }),
  ChangeContentType: (x) => ({ text: `change content type to ${q(x.contentType)}` }),
  ResolveContentType: () => ({ text: 'resolve content type' }),
  SendEmail: (x) => x.targetType === 'Reference'
    ? { text: 'send email to (by reference):', ref: x.reference }
    : { text: `send email to subscribers list ${q(x.subscribersList)}` },
  Reference: (x) => ({ text: 'run reference:', ref: x.reference }),
  RefreshFiles: () => ({ text: 'refresh files' }),
  ApplyWatermarkOnMasterFile: (x) => ({ text: `apply watermark on master file (${x.watermarkType || 'UseSetting'}${x.watermarkId ? ` ${short(x.watermarkId)}` : ''})` }),
  ScheduleResaveOfRecord: (x, c) => ({ text: `schedule resave of record${x.fieldDefinitionId ? ` (date field ${q(fieldName(x.fieldDefinitionId, c))})` : ''}` }),
  CreatePresetCrops: () => ({ text: 'create preset crops' }),
  CreateRenditions: (x) => ({ text: `create renditions: ${(x.renditionPresets || []).join(', ') || '?'}` }),
  CreatePublicLinks: (x) => ({ text: `create public links: ${(x.presets || []).map((p) => p.presetName).join(', ') || '?'}` }),
  DeletePublicLinks: (x) => ({ text: `delete public links: ${(x.presets || []).map((p) => p.presetName).join(', ') || 'all'}` }),
  CreateReviewFile: () => ({ text: 'create review file' }),
  AprimoAI: (x) => ({ text: `run Aprimo AI (${x.options || 'default'})` }),
  AprimoAIUpdatePerformance: () => ({ text: 'update Aprimo AI extraction performance' }),
  PredictiveMetadata: () => ({ text: 'run predictive metadata' }),
  EnhancedCaptioning: () => ({ text: 'run enhanced captioning' }),
  VideoSummary: () => ({ text: 'generate video summary' }),
  RunTextMatch: () => ({ text: 'run text match' }),
  RunReviewAgent: (x) => ({ text: `run review agent ${x.builtInAgentId || ''}${x.contentCoachId ? ` (coach ${x.contentCoachId})` : ''}`.trim() }),
  RunTranslationAgent: (x, c) => ({ text: `translate ${(x.fieldDefinitionIds || []).map((id) => q(fieldName(id, c))).join(', ') || 'fields'}${x.fieldScope === 'OnlyChangedFields' ? ' (changed fields only)' : ''}` }),
  CreateActivity: (x) => ({ text: `create activity type ${x.activityTypeId ?? '?'} owned by ${x.activityOwner || '?'} (${x.activityDuration ?? '?'} days)` }),
};

function fallback(x, typeKey) {
  const { index, executionTime, [typeKey]: type, ...rest } = x;
  const extras = Object.entries(rest).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`);
  return { text: `${type || 'unknown'}${extras.length ? ` (${extras.join(', ')})` : ''}` };
}

function finish(d) {
  return { ...d, plain: [d.text, d.ref].filter(Boolean).join(' ') };
}

export function describeCondition(x, c) {
  const fn = CONDITIONS[x.conditionType];
  try { return finish(fn ? fn(x, c) : fallback(x, 'conditionType')); } catch { return finish(fallback(x, 'conditionType')); }
}

export function describeAction(x, c) {
  const fn = ACTIONS[x.actionType];
  try { return finish(fn ? fn(x, c) : fallback(x, 'actionType')); } catch { return finish(fallback(x, 'actionType')); }
}

// Blank templates inserted by the "+ Add" menus.
const IMM = { executionTime: 'Immediately' };
export const CONDITION_TEMPLATES = {
  ObjectCreated: { conditionType: 'ObjectCreated' },
  ObjectChanged: { conditionType: 'ObjectChanged' },
  ObjectCreatedOrChanged: { conditionType: 'ObjectCreatedOrChanged' },
  ObjectDeleted: { conditionType: 'ObjectDeleted' },
  FileAdded: { conditionType: 'FileAdded' },
  FileProcessingCompleted: { conditionType: 'FileProcessingCompleted' },
  MovieAddedWithoutMoviePreview: { conditionType: 'MovieAddedWithoutMoviePreview', moviePreviewExtension: '' },
  MasterPreviewExists: { conditionType: 'MasterPreviewExists' },
  MasterPreviewChanged: { conditionType: 'MasterPreviewChanged' },
  ClassificationLinked: { conditionType: 'ClassificationLinked', classificationId: '', directLinkOnly: false },
  ClassificationUnlinked: { conditionType: 'ClassificationUnlinked', classificationId: '', directLinkOnly: false },
  ClassifiedIn: { conditionType: 'ClassifiedIn', classificationId: '', directLinkOnly: false },
  CurrentlyLoggedOnUser: { conditionType: 'CurrentlyLoggedOnUser', userId: '', isUser: true },
  CompareFieldValue: { conditionType: 'CompareFieldValue', expression: '' },
  HasFieldValueChanged: { conditionType: 'HasFieldValueChanged', fieldDefinitionId: '' },
  MultilingualFieldValuesChanged: { conditionType: 'MultilingualFieldValuesChanged', fieldDefinitionIds: [] },
  ContentTypeChanged: { conditionType: 'ContentTypeChanged' },
  ContentTypeIs: { conditionType: 'ContentTypeIs', contentType: '', directLinkOnly: false },
  ContentTypeSetTo: { conditionType: 'ContentTypeSetTo', contentType: '', directLinkOnly: false },
  RecordStatusChanged: { conditionType: 'RecordStatusChanged' },
  RecordStatusIs: { conditionType: 'RecordStatusIs', status: '' },
  RecordStatusSetTo: { conditionType: 'RecordStatusSetTo', status: '' },
  Reference: { conditionType: 'Reference', reference: '' },
};
export const ACTION_TEMPLATES = {
  SetFieldValue: { actionType: 'SetFieldValue', fieldDefinitionId: '', reference: '', ...IMM },
  ClassifyRecord: { actionType: 'ClassifyRecord', gettingType: 'Specified', identifierType: 'Identifier', classificationId: '', reference: '', ...IMM },
  UnclassifyRecord: { actionType: 'UnclassifyRecord', gettingType: 'Specified', identifierType: 'Identifier', unlinkTarget: 'Classification', classificationId: '', classificationIds: [], reference: '', ...IMM },
  ChangeRecordStatus: { actionType: 'ChangeRecordStatus', status: '', ...IMM },
  ChangeContentType: { actionType: 'ChangeContentType', contentType: '', ...IMM },
  ResolveContentType: { actionType: 'ResolveContentType', ...IMM },
  SendEmail: { actionType: 'SendEmail', targetType: 'SubscribersList', subscribersList: '', reference: '', ...IMM },
  Reference: { actionType: 'Reference', reference: '', ...IMM },
  RefreshFiles: { actionType: 'RefreshFiles', ...IMM },
  ApplyWatermarkOnMasterFile: { actionType: 'ApplyWatermarkOnMasterFile', watermarkType: 'UseSetting', watermarkId: null, ...IMM },
  ScheduleResaveOfRecord: { actionType: 'ScheduleResaveOfRecord', fieldDefinitionId: '', ...IMM },
  CreatePresetCrops: { actionType: 'CreatePresetCrops', ...IMM },
  CreateRenditions: { actionType: 'CreateRenditions', renditionPresets: [], executionTime: 'Delayed' },
  CreatePublicLinks: { actionType: 'CreatePublicLinks', presets: [{ presetName: '', presetType: '' }], ...IMM },
  DeletePublicLinks: { actionType: 'DeletePublicLinks', presets: [], ...IMM },
  CreateReviewFile: { actionType: 'CreateReviewFile', ...IMM },
  AprimoAI: { actionType: 'AprimoAI', options: 'SmartTags', executionTime: 'Delayed' },
  AprimoAIUpdatePerformance: { actionType: 'AprimoAIUpdatePerformance', ...IMM },
  PredictiveMetadata: { actionType: 'PredictiveMetadata', executionTime: 'Delayed' },
  EnhancedCaptioning: { actionType: 'EnhancedCaptioning', executionTime: 'Delayed' },
  VideoSummary: { actionType: 'VideoSummary', executionTime: 'Delayed' },
  RunTextMatch: { actionType: 'RunTextMatch', ...IMM },
  RunReviewAgent: { actionType: 'RunReviewAgent', builtInAgentId: '', contentCoachId: null, ...IMM },
  RunTranslationAgent: { actionType: 'RunTranslationAgent', fieldDefinitionIds: [], fieldScope: 'OnlyChangedFields', executionTime: 'Delayed' },
  CreateActivity: { actionType: 'CreateActivity', activityTypeId: 0, activityDuration: 1, activityOwner: '', activityAdmin: '', digitalAssetType: null, ...IMM },
};
