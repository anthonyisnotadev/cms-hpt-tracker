'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

/** Minimal RFC4180 CSV parser (handles quotes, embedded commas/newlines). */
function parseCSV(text) {
  const rows = []; let i = 0, field = '', row = [], inQ = false;
  while (i < text.length) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQ = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQ = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function csvToObjects(text) {
  const rows = parseCSV(text);
  if (!rows.length) return [];
  const head = rows[0].map(h => h.trim());
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    if (!rows[r].length || (rows[r].length === 1 && !rows[r][0])) continue;
    const o = Object.create(null);
    head.forEach((h, c) => { o[h] = rows[r][c] === undefined ? '' : rows[r][c]; });
    out.push(o);
  }
  return out;
}

function toCSV(rows, columns) {
  const cols = columns || [...new Set(rows.flatMap(r => Object.keys(r)))];
  const esc = v => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n') + '\n';
}

/** Hostname of a URL, lowercased, www stripped. Empty string when unparseable. */
function hostOf(u) {
  try { return new URL(String(u)).hostname.toLowerCase().replace(/^www\./, ''); }
  catch (_e) { return ''; }
}

/**
 * Hosts that serve MRFs for many unrelated hospitals. Their domain is never a
 * usable seed for /cms-hpt.txt, which must live on the hospital's own site.
 */
const AGGREGATOR_HOST = new RegExp([
  'blob\.core\.windows\.net', 'amazonaws\.com', 'cloudfront\.net', 'azureedge',
  'akamai', 'googleapis\.com', 'sharepoint\.com', 'box\.com', 'dropbox',
  'wpengine', 's3[.-]', 'storage\.googleapis', 'filesusr', 'squarespace',
  'para-hcfs\.com', 'hospitalpricelists\.org', 'turquoise\.health',
  'craneware', 'vitalware', 'panaceainc', 'streamlinehealth', 'chargemaster',
  'hospitalpricingspecialists', 'sunflowerhealthplan', 'issuu\.com',
  'googleusercontent', 'drive\.google', 'docs\.google',
  // Transparency vendors and media/CDN hosts observed serving MRFs for
  // unrelated hospitals. A pointer file never lives on these, so seeding a
  // domain from one guarantees a 404 and a wasted search lookup later.
  'cloudinary\.com', 'claraprice\.net', 'hospitalpricedisclosure\.com',
  'sitecorecloud\.io', 'sitecorecontenthub\.cloud', 'optimizely\.com',
  'azurewebsites\.net', 'files\.wordpress', 'netlify\.app', 'vercel\.app'
].join('|'), 'i');

const isAggregator = h => !!h && AGGREGATOR_HOST.test(h);

function normalizeName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    // Drop apostrophes before splitting. Otherwise "children's" becomes two
    // tokens and cannot match "childrens" — which scored 0.13 for
    // "WOMEN'S HOSPITAL" vs "Womens Hospital". Possessives are pervasive in
    // hospital names, so this silently sank a whole class of true matches.
    .replace(/['‘’´`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(the|of|at|inc|llc|lp|pc|co|corp|company|dba)\b/g, ' ')
    .replace(/\bsaint\b/g, 'st')
    .replace(/\bmedical center\b/g, 'med ctr')
    .replace(/\bmedical\b/g, 'med')
    .replace(/\bcenter\b/g, 'ctr')
    .replace(/\bcentre\b/g, 'ctr')
    .replace(/\bhospitals?\b/g, 'hosp')
    .replace(/\bhealthcare\b/g, 'health')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOP = new Set(['hosp', 'health', 'med', 'ctr', 'system', 'regional', 'community', 'memorial', 'general']);

/** Token-overlap similarity in [0,1], weighting distinctive (non-boilerplate) tokens. */
function nameSimilarity(a, b) {
  const ta = new Set(normalizeName(a).split(' ').filter(Boolean));
  const tb = new Set(normalizeName(b).split(' ').filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let inter = 0, weight = 0, total = 0;
  for (const t of ta) {
    const w = STOP.has(t) ? 0.3 : 1;
    total += w;
    if (tb.has(t)) { inter += w; weight += w; }
  }
  let totalB = 0;
  for (const t of tb) totalB += STOP.has(t) ? 0.3 : 1;
  const denom = Math.max(total, totalB) || 1;
  return weight / denom;
}

/**
 * Unweighted token overlap. Used to confirm risky matches: `nameSimilarity`
 * deliberately discounts boilerplate words, but words like "general" vs
 * "community" are exactly what separates two hospitals in the same town, so a
 * second opinion that treats every token equally is required before accepting
 * a cross-domain match.
 */
function strictSimilarity(a, b) {
  const ta = new Set(normalizeName(a).split(' ').filter(Boolean));
  const tb = new Set(normalizeName(b).split(' ').filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.max(ta.size, tb.size);
}

/** Resumable JSON store written atomically (tmp + rename) so a kill never truncates it. */
class JsonStore {
  constructor(file) { this.file = file; this.data = null; this._dirty = false; }
  async load() {
    try {
      const raw = await fsp.readFile(this.file, 'utf8');
      this.data = JSON.parse(raw.replace(/^\uFEFF/, '') || '{}');
    } catch (e) {
      if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) this.data = {};
      else throw e;
    }
    return this.data;
  }
  get(k) { return this.data[k]; }
  set(k, v) { this.data[k] = v; this._dirty = true; }
  has(k) { return Object.prototype.hasOwnProperty.call(this.data, k); }
  get size() { return Object.keys(this.data).length; }
  async save(force) {
    if (!this._dirty && !force) return;
    await fsp.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(this.data, null, 1));
    await fsp.rename(tmp, this.file);
    this._dirty = false;
  }
}

/**
 * Run `worker` over `items` with bounded concurrency, never scheduling two
 * tasks for the same `keyFn` value at once (per-host politeness).
 */
async function pooled(items, { concurrency = 10, keyFn = null, onProgress = null }, worker) {
  const results = new Array(items.length);
  const busyKeys = new Set();
  let cursor = 0, done = 0, deferred = [];

  async function run() {
    for (;;) {
      let idx = -1;
      if (deferred.length) {
        for (let d = 0; d < deferred.length; d++) {
          const cand = deferred[d];
          if (!keyFn || !busyKeys.has(keyFn(items[cand]))) { idx = cand; deferred.splice(d, 1); break; }
        }
      }
      if (idx === -1) {
        if (cursor >= items.length) {
          if (!deferred.length) return;
          await new Promise(r => setTimeout(r, 50));
          continue;
        }
        idx = cursor++;
        if (keyFn && busyKeys.has(keyFn(items[idx]))) { deferred.push(idx); continue; }
      }
      const key = keyFn ? keyFn(items[idx]) : null;
      if (key) busyKeys.add(key);
      try { results[idx] = await worker(items[idx], idx); }
      catch (e) { results[idx] = { error: String((e && e.message) || e) }; }
      finally { if (key) busyKeys.delete(key); }
      done++;
      if (onProgress) onProgress(done, items.length, results[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length || 1) }, run));
  return results;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

module.exports = {
  parseCSV, csvToObjects, toCSV, hostOf, isAggregator,
  normalizeName, nameSimilarity, strictSimilarity, JsonStore, pooled, sleep
};
