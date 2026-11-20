// Development only: the DAM calls Bulk Versioning makes, for dev/fake-aprimo.js. Classifications (paged, with the
// HAL next link aprimo-js follows), record search by classification with master file + latest version embedded,
// segmented uploads (/uploads/segments → index → commit → token), record update (new version / preview) and create.
// Everything is in memory; GET /dev/bulk-log shows what was changed.
import crypto from 'node:crypto';

const id = () => crypto.randomUUID().replace(/-/g, '');
const C = (name, parentId, labelPath) => ({ id: id(), name, parentId, labelPath, labels: [{ languageId: 'en', value: name }] });
const root = C('Products', undefined, '/Products/');
const shoes = C('Footwear', root.id, '/Products/Footwear/');
const apparel = C('Apparel', root.id, '/Products/Apparel/');
const camp = C('Campaigns', undefined, '/Campaigns/');
const summer = C('Summer 2026', camp.id, '/Campaigns/Summer 2026/');
export const CLASSIFICATIONS = [root, shoes, apparel, camp, summer];

const rec = (title, fileName, cls, versionNumber = 1) => ({
  id: id(), title, modifiedOn: '2026-11-01T10:00:00Z', classifications: [cls.id],
  masterfile: { id: id() },
  versions: [{ id: id(), fileName, fileSize: 120_000 + Math.floor(Math.random() * 900_000), versionNumber, createdOn: '2026-10-28T09:30:00Z', previews: [] }],
});
export const RECORDS = [
  rec('Trail Runner hero', 'HD-1001_trail-runner_hero.jpg', shoes, 3),
  rec('Trail Runner side', 'HD-1001_trail-runner_side.jpg', shoes),
  rec('City Sneaker hero', 'HD-1002_city-sneaker_hero.png', shoes, 2),
  rec('Rain Jacket front', 'AP-2001_rain-jacket_front.jpg', apparel),
  rec('Rain Jacket back', 'AP-2001_rain-jacket_back.jpg', apparel),
  rec('Summer banner', 'Summer Campaign Banner 1200x628.jpg', summer),
  rec('Summer square', 'Summer Campaign Square 1080x1080.jpg', summer),
];
const LOG = [];
const uploads = new Map(); // upload id -> { filename, segments:Set }
const tokens = new Map();  // upload token -> filename

const latest = (r) => r.versions[r.versions.length - 1];
const hal = (r) => ({
  id: r.id, title: r.title, modifiedOn: r.modifiedOn,
  _embedded: {
    masterfile: { id: r.masterfile.id },
    masterfilelatestversion: { ...latest(r), previews: undefined, _embedded: { thumbnail: { uri: null }, preview: { uri: null } } },
  },
});

// Returns true when it handled the request. p is the path with /api/core removed for API calls, or the full path.
export function handleBulk(req, res, p, url, body, send, origin) {
  const page = +(url.searchParams.get('page') || req.headers.page || 1);
  const size = +(url.searchParams.get('pageSize') || req.headers.pagesize || 100);
  let m;
  if (req.method === 'GET' && p === '/classifications') {
    const items = CLASSIFICATIONS.slice((page - 1) * size, page * size);
    const more = page * size < CLASSIFICATIONS.length;
    send(res, 200, { page, pageSize: size, totalCount: CLASSIFICATIONS.length, items,
      _links: more ? { next: { href: `${origin}/api/core/classifications?page=${page + 1}` } } : {} });
    return true;
  }
  if (req.method === 'POST' && p === '/search/records') {
    const expr = String(body?.searchExpression?.expression || '');
    const ids = [...expr.matchAll(/Classification = '([\w-]+)'/g)].map((x) => x[1]);
    // Like Aprimo, a parent classification matches records in its children too.
    const inScope = (cid) => { for (let c = CLASSIFICATIONS.find((x) => x.id === cid); c; c = CLASSIFICATIONS.find((x) => x.id === c.parentId)) if (ids.includes(c.id)) return true; return false; };
    const all = RECORDS.filter((r) => r.classifications.some(inScope));
    send(res, 200, { page, pageSize: size, totalCount: all.length, items: all.slice((page - 1) * size, page * size).map(hal) });
    return true;
  }
  if (req.method === 'PUT' && (m = p.match(/^\/record\/(\w+)$/))) {
    const r = RECORDS.find((x) => x.id === m[1]);
    if (!r) { send(res, 404, { message: 'Record not found' }); return true; }
    for (const f of body?.files?.addOrUpdate || []) {
      if (f.id !== r.masterfile.id) { send(res, 400, { message: `File ${f.id} is not on this record` }); return true; }
      for (const v of f.versions?.addOrUpdate || []) {
        if (!tokens.has(v.id) && !v.previews) { send(res, 400, { message: 'Unknown upload token' }); return true; }
        if (v.previews) { // preview on an existing version
          const ver = r.versions.find((x) => x.id === v.id);
          if (!ver) { send(res, 400, { message: 'Version not found' }); return true; }
          ver.previews.push(...v.previews.addOrUpdate);
          LOG.push({ at: new Date().toISOString(), record: r.title, preview: tokens.get(v.previews.addOrUpdate[0].id), label: v.previews.addOrUpdate[0].label });
        } else {
          r.versions.push({ id: id(), fileName: v.fileName, fileSize: 1000, versionNumber: latest(r).versionNumber + 1, createdOn: new Date().toISOString(), previews: [], comment: v.comment });
          LOG.push({ at: new Date().toISOString(), record: r.title, newVersion: latest(r).versionNumber, fileName: v.fileName, comment: v.comment });
        }
      }
    }
    send(res, 200, null);
    return true;
  }
  if (req.method === 'POST' && p === '/records') {
    const fileName = body?.files?.addOrUpdate?.[0]?.versions?.addOrUpdate?.[0]?.fileName || 'file';
    const cls = body?.classifications?.addOrUpdate?.[0]?.id;
    const r = rec(fileName, fileName, CLASSIFICATIONS.find((c) => c.id === cls) || root);
    RECORDS.push(r);
    LOG.push({ at: new Date().toISOString(), created: r.id, fileName, status: body?.status });
    send(res, 201, { id: r.id });
    return true;
  }
  // Uploads live on the main host (https://{tenant}.aprimo.com/uploads/...).
  if (req.method === 'POST' && p === '/uploads/segments') {
    const u = id(); uploads.set(u, { filename: body?.filename, segments: new Set() });
    send(res, 200, { uri: `${origin}/uploads/segments/${u}` });
    return true;
  }
  if (req.method === 'POST' && (m = p.match(/^\/uploads\/segments\/(\w+)(\/commit)?$/))) {
    const u = uploads.get(m[1]);
    if (!u) { send(res, 404, { message: 'upload not found' }); return true; }
    if (!m[2]) { u.segments.add(url.searchParams.get('index')); send(res, 200, null); return true; }
    if (u.segments.size !== +body?.segmentcount) { send(res, 400, { message: 'segments missing' }); return true; }
    const token = `upl_${id()}`; tokens.set(token, u.filename);
    send(res, 200, { token });
    return true;
  }
  if (req.method === 'GET' && p === '/dev/bulk-log') { send(res, 200, LOG); return true; }
  return false;
}
