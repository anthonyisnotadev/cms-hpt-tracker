'use strict';

/**
 * Build a raw + normalized corpus of every cms-hpt.txt referenced by the
 * tracker data. This command deliberately never requests an
 * MRF URL: those can be hundreds of megabytes and belong to a separate stage.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const { csvToObjects, hostOf, pooled, sleep } = require('./lib/util');
const { directGet, fetchPointer, classify, looksLikePointer } = require('./lib/fetch');
const { parsePointer } = require('./lib/parse');

const ROOT = path.join(__dirname, '..', '..');
const DEFAULT_OUT = path.join(ROOT, 'cms_data', 'hpt', 'pointer-corpus');
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const CSV_COLUMNS = [
  'record_status', 'pointer_url', 'final_url', 'observed_pointer_urls',
  'pointer_host', 'pointer_format', 'pointer_sha256', 'raw_file', 'raw_bytes',
  'fetched_at', 'fetch_via', 'source_datasets', 'source_domains',
  'entry_index', 'mrf_url_index', 'location_name', 'source_page_url',
  'mrf_url', 'contact_name', 'contact_email', 'extra_fields_json',
  'matched_ccns', 'related_ccns'
];

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (match) out[match[1]] = match[2] === undefined ? true : match[2];
  }
  return out;
}

function positiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function normalizeUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol)) return '';
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    url.hash = '';
    if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) url.port = '';
    return url.toString();
  } catch (_e) {
    return '';
  }
}

function normalizeDomain(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  const host = hostOf(raw.includes('://') ? raw : `https://${raw}`);
  return host.replace(/^www\./, '');
}

function safeFile(value) {
  return String(value || 'pointer').replace(/[^a-z0-9._-]+/gi, '_').slice(0, 100) || 'pointer';
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sorted(set) {
  return [...(set || [])].filter(Boolean).sort((a, b) => String(a).localeCompare(String(b)));
}

function makeInfo() {
  return { datasets: new Set(), domains: new Set(), ccns: new Set(), links: new Map(), observedUrls: new Set() };
}

function addLink(info, mrfUrl, ccn) {
  const key = normalizeUrl(mrfUrl);
  if (!key || !ccn) return;
  if (!info.links.has(key)) info.links.set(key, new Set());
  info.links.get(key).add(String(ccn));
}

function mergeInfo(target, source) {
  if (!source) return target;
  for (const value of source.datasets || []) target.datasets.add(value);
  for (const value of source.domains || []) target.domains.add(value);
  for (const value of source.ccns || []) target.ccns.add(value);
  for (const value of source.observedUrls || []) target.observedUrls.add(value);
  for (const [url, ccns] of source.links || []) {
    if (!target.links.has(url)) target.links.set(url, new Set());
    for (const ccn of ccns) target.links.get(url).add(ccn);
  }
  return target;
}

function touchDomain(catalog, domain, dataset, ccn) {
  const key = normalizeDomain(domain);
  if (!key) return null;
  if (!catalog.domains.has(key)) catalog.domains.set(key, makeInfo());
  const info = catalog.domains.get(key);
  if (dataset) info.datasets.add(dataset);
  info.domains.add(key);
  if (ccn) info.ccns.add(String(ccn));
  return info;
}

function touchUrl(catalog, pointerUrl, dataset, domain, ccn) {
  const key = normalizeUrl(pointerUrl);
  if (!key) return null;
  if (!catalog.urls.has(key)) catalog.urls.set(key, { url: String(pointerUrl).trim(), ...makeInfo() });
  const info = catalog.urls.get(key);
  info.observedUrls.add(String(pointerUrl).trim());
  if (dataset) info.datasets.add(dataset);
  const d = normalizeDomain(domain);
  if (d) info.domains.add(d);
  if (ccn) info.ccns.add(String(ccn));
  return info;
}

async function readCsvIfPresent(file) {
  try { return csvToObjects(await fsp.readFile(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return []; throw e; }
}

async function readJsonIfPresent(file, fallback = {}) {
  try { return JSON.parse((await fsp.readFile(file, 'utf8')).replace(/^\uFEFF/, '') || '{}'); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
}

async function loadSourceCatalog(root = ROOT, options = {}) {
  const catalog = { urls: new Map(), domains: new Map(), inputRows: { current: 0 } };
  if (!options.externalOnly) {
    const auditDir = path.join(root, 'data', 'hpt-audit');
    const reviewedInputs = ['compliance.csv', 'manifest.csv', 'gaps.csv']
      .every(file => fs.existsSync(path.join(auditDir, file)));
    let rows = [];
    let compliance = [];
    if (reviewedInputs) {
      // The reviewed view removes quarantined assignments and adds validated
      // replacements. Crawling the immutable base manifest here would revive
      // known-bad links and omit newly reviewed pointers.
      const view = require('./lib/reviewed-resolutions').loadReviewedView(auditDir);
      rows = view.manifest;
      compliance = view.compliance;
    } else {
      const manifestPaths = [
        path.join(root, 'cms_data', 'hpt', 'manifest.csv'),
        path.join(auditDir, 'manifest.csv')
      ];
      for (const file of manifestPaths) {
        const candidate = await readCsvIfPresent(file);
        if (candidate.length) { rows = candidate; break; }
      }
    }
    catalog.inputRows.current = rows.length;
    for (const row of rows) {
      const domain = normalizeDomain(row.domain || hostOf(row.pointer_url));
      touchDomain(catalog, domain, 'current', row.ccn);
      const info = touchUrl(catalog, row.pointer_url, 'current', domain, row.ccn);
      if (info) addLink(info, row.mrf_url, row.ccn);
    }
    // A known official domain can be assessable even when no valid pointer or
    // MRF assignment currently exists, so retain it as a discovery target.
    for (const row of compliance) {
      touchDomain(catalog, row.domain, 'current', row.ccn);
    }
    const discoveryFile = path.join(auditDir, 'discovery-review.json');
    if (fs.existsSync(discoveryFile)) {
      const discovery = await readJsonIfPresent(discoveryFile, { records: [] });
      const reviewed = (discovery.records || []).filter(record =>
        record.website?.identity === 'corroborated' && record.website.domain);
      catalog.inputRows['reviewed-discovery'] = reviewed.length;
      for (const record of reviewed) {
        const domain = normalizeDomain(record.website.domain);
        touchDomain(catalog, domain, 'reviewed-discovery', record.ccn);
        for (const attempt of record.pointer?.attempts || []) {
          if (!attempt.usable) continue;
          const info = touchUrl(catalog, attempt.url, 'reviewed-discovery', domain, record.ccn);
          if (info && record.pointer.state === 'facility-entry-matched') {
            for (const entry of record.pointer.entries || []) addLink(info, entry.mrf_url, record.ccn);
          }
        }
      }
    }
    const nationwideSearchFile = path.join(auditDir, 'nationwide-search-reviews.json');
    if (fs.existsSync(nationwideSearchFile)) {
      const searchReviews = await readJsonIfPresent(nationwideSearchFile, { records: [] });
      const official = (searchReviews.records || []).filter(record => record.status === 'official' && record.domain);
      catalog.inputRows['nationwide-search'] = official.length;
      for (const record of official) touchDomain(catalog, record.domain, 'nationwide-search', record.ccn);
    }
    const browserReviewFile = path.join(auditDir, 'nationwide-browser-reviews.json');
    if (fs.existsSync(browserReviewFile)) {
      const browserReviews = await readJsonIfPresent(browserReviewFile, { records: [] });
      const recovered = (browserReviews.records || []).filter(record =>
        record.kind === 'pointer' && record.status === 'retrieved' && record.final_url);
      catalog.inputRows['browser-reviewed-pointer'] = recovered.length;
      for (const record of recovered) {
        const domain = normalizeDomain(record.target);
        const related = catalog.domains.get(domain)?.ccns || catalog.urls.get(normalizeUrl(record.target))?.ccns || new Set();
        if (!related.size) touchUrl(catalog, record.final_url, 'browser-reviewed-pointer', domain);
        for (const ccn of related) touchUrl(catalog, record.final_url, 'browser-reviewed-pointer', domain, ccn);
      }
    }

    const domainFile = path.join(root, 'cms_data', 'hpt', 'domains.json');
    const domains = await readJsonIfPresent(domainFile, {});
    for (const [key, record] of Object.entries(domains || {})) {
      const info = touchDomain(catalog, record.domain || key, 'current');
      if (info) for (const ccn of record.ccns || []) info.ccns.add(String(ccn));
    }
  }

  if (options.domainCsv) {
    const dataset = String(options.dataset || 'external-candidates');
    const rows = await readCsvIfPresent(path.resolve(options.domainCsv));
    catalog.inputRows[dataset] = rows.length;
    for (const row of rows) {
      const domain = normalizeDomain(row.domain || row.resolved_domain || row.hospital_url);
      const info = touchDomain(catalog, domain, dataset, row.ccn);
      if (info && row.ccn) info.ccns.add(String(row.ccn));
    }
  }
  return catalog;
}

function infoFor(catalog, { url, domain, dataset } = {}) {
  const info = makeInfo();
  if (dataset) info.datasets.add(dataset);
  const normalizedUrl = normalizeUrl(url);
  if (normalizedUrl) {
    info.observedUrls.add(String(url).trim());
    mergeInfo(info, catalog.urls.get(normalizedUrl));
  }
  const normalizedDomain = normalizeDomain(domain || hostOf(url));
  if (normalizedDomain) mergeInfo(info, catalog.domains.get(normalizedDomain));
  if (normalizedDomain) info.domains.add(normalizedDomain);
  return info;
}

function stateTarget(state, key) {
  return state.targets && state.targets[key];
}

const SUCCESS_FIELDS = ['acceptedUrl', 'finalUrl', 'rawFile', 'sha256', 'bytes', 'format', 'fetchedAt',
  'via', 'sourceDatasets', 'sourceDomains', 'relatedCcns', 'observedUrls', 'exactMrfLinks'];
function successfulSnapshot(record, observedAt = record?.fetchedAt) {
  if (!record?.rawFile || !record.sha256) return null;
  const snapshot = Object.fromEntries(SUCCESS_FIELDS.filter(field => record[field] !== undefined)
    .map(field => [field, record[field]]));
  snapshot.fetchedAt = observedAt || '';
  return snapshot;
}

function updateState(state, key, record) {
  if (!state.targets) state.targets = {};
  const prior = state.targets[key] || {};
  const history = Array.isArray(prior.history) ? prior.history.slice() : [];
  history.push({
    at: record.fetchedAt || new Date().toISOString(),
    status: record.status,
    reason: record.reason || '',
    acceptedUrl: record.acceptedUrl || '',
    finalUrl: record.finalUrl || '',
    attempts: record.attempts || []
  });
  // A failed retry must not inherit the previous success's hash, raw path,
  // final URL or exact links as if they belonged to the failed attempt.
  // Keep the last success as a separately dated version for auditability.
  const historicalSuccess = [...(prior.history || [])].reverse().find(item => item.status === 'ok');
  const lastSuccessful = record.status === 'ok' ? successfulSnapshot(record)
    : prior.status === 'ok' ? successfulSnapshot(prior)
      : prior.lastSuccessful || (historicalSuccess && successfulSnapshot(prior, historicalSuccess.at));
  state.targets[key] = { ...record, history, ...(lastSuccessful ? { lastSuccessful } : {}) };
}

async function invalidateHtmlPointerSnapshots(state, root) {
  let invalidated = 0;
  for (const record of Object.values(state.targets || {})) {
    if (record.status !== 'ok' || !record.rawFile || !record.sha256) continue;
    let body;
    try { body = await fsp.readFile(path.resolve(root, record.rawFile), 'utf8'); }
    catch (_e) { continue; }
    if (sha256(Buffer.from(body, 'utf8')) !== record.sha256
      || Buffer.byteLength(body, 'utf8') !== record.bytes
      || classify(200, body) !== 'html') continue;
    const observedAt = new Date().toISOString();
    const snapshot = successfulSnapshot(record);
    record.status = 'invalid';
    record.reason = 'html-body-not-pointer';
    record.invalidatedSnapshot = snapshot;
    // Do not represent these same bytes as a historical valid pointer either.
    if (record.lastSuccessful?.sha256 === record.sha256) delete record.lastSuccessful;
    record.history = [...(record.history || []), {
      at: observedAt, status: 'invalid', reason: record.reason,
      acceptedUrl: record.acceptedUrl || '', finalUrl: record.finalUrl || '', attempts: []
    }];
    invalidated++;
  }
  return invalidated;
}

async function writeAtomic(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  await fsp.writeFile(tmp, value);
  await fsp.rename(tmp, file);
}

function rawName(finalUrl) {
  const host = hostOf(finalUrl) || 'pointer';
  return `${safeFile(host)}-${sha256(normalizeUrl(finalUrl) || finalUrl).slice(0, 12)}.txt`;
}

function makeDocument({ acceptedUrl, finalUrl, body, via, fetchedAt, info }) {
  const normalizedFinal = normalizeUrl(finalUrl || acceptedUrl);
  const parsed = parsePointer(body);
  return {
    acceptedUrl: normalizeUrl(acceptedUrl) || acceptedUrl,
    finalUrl: normalizedFinal || finalUrl || acceptedUrl,
    body,
    via,
    fetchedAt,
    format: parsed.format,
    sha256: sha256(Buffer.from(body, 'utf8')),
    bytes: Buffer.byteLength(body, 'utf8'),
    info: mergeInfo(makeInfo(), info),
    parsed
  };
}

const documentLocks = new WeakMap();
async function addDocument(documents, outputDir, candidate) {
  if (!candidate.body || !looksLikePointer(candidate.body)) return null;
  const doc = makeDocument(candidate);
  const key = normalizeUrl(doc.finalUrl);
  if (!key) return null;
  if (!documentLocks.has(documents)) documentLocks.set(documents, new Map());
  const locks = documentLocks.get(documents);
  const previous = locks.get(key) || Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    const prior = documents.get(key);
    if (prior) {
      mergeInfo(prior.info, doc.info);
      prior.info.observedUrls.add(doc.acceptedUrl);
      prior.info.observedUrls.add(doc.finalUrl);
      if (String(doc.fetchedAt || '') >= String(prior.fetchedAt || '')) {
        prior.body = doc.body;
        prior.via = doc.via;
        prior.fetchedAt = doc.fetchedAt;
        prior.format = doc.format;
        prior.sha256 = doc.sha256;
        prior.bytes = doc.bytes;
        prior.parsed = doc.parsed;
        prior.acceptedUrl = doc.acceptedUrl;
      }
      await persistRaw(prior, outputDir);
      return prior;
    }
    doc.info.observedUrls.add(doc.acceptedUrl);
    doc.info.observedUrls.add(doc.finalUrl);
    documents.set(key, doc);
    await persistRaw(doc, outputDir);
    return doc;
  });
  locks.set(key, operation);
  try { return await operation; }
  finally { if (locks.get(key) === operation) locks.delete(key); }
}

async function persistRaw(doc, outputDir) {
  const canonical = path.join(outputDir, 'raw', rawName(doc.finalUrl));
  let file = canonical;
  try {
    const existing = await fsp.readFile(canonical);
    // A URL can publish changed pointer bytes. Preserve the earlier snapshot
    // instead of overwriting a raw path still referenced by crawl state.
    if (sha256(existing) !== doc.sha256) file = canonical.replace(/\.txt$/, `-${doc.sha256}.txt`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  try {
    const existing = await fsp.readFile(file);
    // A corrupt content-addressed cache copy can be replaced only after this
    // run has obtained and hashed the intended body again.
    if (sha256(existing) !== doc.sha256) await writeAtomic(file, doc.body);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await writeAtomic(file, doc.body);
  }
  doc.rawFile = file;
}

function stateRecordForDocument(doc, root, kind, input, attempts = []) {
  return {
    kind,
    input,
    status: 'ok',
    reason: '',
    acceptedUrl: doc.acceptedUrl,
    finalUrl: doc.finalUrl,
    rawFile: path.relative(root, doc.rawFile),
    sha256: doc.sha256,
    bytes: doc.bytes,
    format: doc.format,
    fetchedAt: doc.fetchedAt,
    via: doc.via,
    sourceDatasets: sorted(doc.info.datasets),
    sourceDomains: sorted(doc.info.domains),
    relatedCcns: sorted(doc.info.ccns),
    observedUrls: sorted(doc.info.observedUrls),
    exactMrfLinks: Object.fromEntries([...doc.info.links.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([url, ccns]) => [url, sorted(ccns)])),
    attempts
  };
}

async function loadCorpusState(state, documents, root, outputDir) {
  for (const record of Object.values(state.targets || {})) {
    if (record.status !== 'ok' || !record.rawFile) continue;
    try {
      const body = await fsp.readFile(path.resolve(root, record.rawFile), 'utf8');
      // The legacy URL-keyed raw path could have been overwritten by a later
      // version. Its old hash/date must not be attached to the newer bytes.
      if (sha256(Buffer.from(body, 'utf8')) !== record.sha256
        || Buffer.byteLength(body, 'utf8') !== record.bytes) continue;
      const info = makeInfo();
      for (const value of record.sourceDatasets || []) info.datasets.add(value);
      for (const value of record.sourceDomains || []) info.domains.add(value);
      for (const value of record.relatedCcns || []) info.ccns.add(value);
      for (const value of record.observedUrls || []) info.observedUrls.add(value);
      for (const [url, ccns] of Object.entries(record.exactMrfLinks || {})) {
        if (!info.links.has(url)) info.links.set(url, new Set());
        for (const ccn of ccns || []) info.links.get(url).add(String(ccn));
      }
      await addDocument(documents, outputDir, {
        acceptedUrl: record.acceptedUrl || record.input,
        finalUrl: record.finalUrl || record.acceptedUrl || record.input,
        body, via: record.via || 'corpus-cache', fetchedAt: record.fetchedAt, info
      });
    } catch (_e) { /* missing/corrupt state is re-fetched below */ }
  }
}

async function documentsFromSuccessfulState(state, root, outputDir) {
  const documents = new Map();
  await loadCorpusState(state, documents, root, outputDir);
  return documents;
}

async function importPointerCache({ storeFile, baseDir, dataset, catalog, state, documents, root, outputDir }) {
  const store = await readJsonIfPresent(storeFile, {});
  for (const [domain, record] of Object.entries(store || {})) {
    const key = `domain:${normalizeDomain(domain)}`;
    // A newer exact-URL success already replaced this cache version. Keep its
    // bytes in state history, but do not reintroduce it as a current document.
    if (stateTarget(state, key)?.status === 'superseded') continue;
    const fetchedAt = record.fetchedAt || record.checkedAt || new Date(0).toISOString();
    if (!record.ok || !record.file) {
      if (!stateTarget(state, key)) updateState(state, key, {
        kind: 'domain', input: normalizeDomain(domain), status: 'failed',
        reason: record.reason || 'cached-failure', fetchedAt, via: `cache-${dataset}`,
        attempts: record.attempts || []
      });
      continue;
    }
    try {
      const body = await fsp.readFile(path.resolve(baseDir, record.file), 'utf8');
      if (!looksLikePointer(body)) continue;
      const acceptedUrl = record.url || `https://${normalizeDomain(domain)}/cms-hpt.txt`;
      const info = infoFor(catalog, { url: acceptedUrl, domain, dataset });
      const doc = await addDocument(documents, outputDir, {
        acceptedUrl, finalUrl: record.finalUrl || acceptedUrl, body,
        via: `cache-${dataset}`, fetchedAt, info
      });
      if (doc && !stateTarget(state, key)) {
        updateState(state, key, stateRecordForDocument({ ...doc, info }, root, 'domain', normalizeDomain(domain), record.attempts || []));
      }
    } catch (_e) { /* absent raw cache is simply fetched live */ }
  }
}

function transientReason(reason) {
  return ['neterr', 'server', 'failed', 'http408', 'http425', 'http429'].includes(reason);
}

async function fetchKnownPointer(url, { timeoutMs, maxBytes, fetchImpl = fetch, retries = 2 }) {
  const attempts = [];
  let last = null;
  for (let round = 0; round < retries; round++) {
    const response = await directGet(url, { timeoutMs, maxBytes, fetchImpl });
    const kind = response.tooLarge ? 'too-large' : classify(response.status, response.body);
    attempts.push({ round: round + 1, url, finalUrl: response.finalUrl || url, status: response.status, kind, via: 'direct' });
    last = { response, kind };
    if (kind === 'ok') return {
      ok: true, acceptedUrl: url, finalUrl: response.finalUrl || url,
      body: response.body, via: 'direct-exact', attempts
    };
    if (!transientReason(kind) || round + 1 >= retries) break;
    await sleep(250 * (2 ** round));
  }
  return { ok: false, reason: last ? last.kind : 'failed', attempts };
}

async function fetchDomainPointer(domain, options) {
  if (options.rootOnly) {
    return fetchKnownPointer(`https://${normalizeDomain(domain)}/cms-hpt.txt`, options);
  }
  const attempts = [];
  let last = null;
  for (let round = 0; round < 2; round++) {
    const result = await fetchPointer(domain, {
      useUnblocker: false,
      timeoutMs: options.timeoutMs,
      maxBytes: options.maxBytes,
      fetchImpl: options.fetchImpl
    });
    for (const attempt of result.attempts || []) attempts.push({ round: round + 1, ...attempt });
    last = result;
    if (result.ok) return { ...result, acceptedUrl: result.url, attempts };
    if (!transientReason(result.reason) || round === 1) break;
    await sleep(250 * (2 ** round));
  }
  return { ok: false, reason: last && last.reason || 'failed', attempts };
}

function documentForObservedUrl(documents, url) {
  const key = normalizeUrl(url);
  if (!key) return null;
  for (const doc of documents.values()) {
    if (normalizeUrl(doc.finalUrl) === key || sorted(doc.info.observedUrls).some(item => normalizeUrl(item) === key)) return doc;
  }
  return null;
}

function documentCoversDomain(documents, domain) {
  const wanted = normalizeDomain(domain);
  for (const doc of documents.values()) {
    if (doc.info.domains.has(wanted)) return true;
    if (normalizeDomain(hostOf(doc.finalUrl)) === wanted || normalizeDomain(hostOf(doc.acceptedUrl)) === wanted) return true;
  }
  return false;
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = stableJson(value[key]);
    return out;
  }
  return value;
}

function values(entry, singular, plural) {
  const raw = entry[plural] && entry[plural].length ? entry[plural] : entry[singular];
  return (Array.isArray(raw) ? raw : [raw]).map(v => String(v || '').trim()).filter(Boolean);
}

function rowsForDocuments(documents, root) {
  const rows = [];
  const docs = [...documents.values()].sort((a, b) => a.finalUrl.localeCompare(b.finalUrl));
  for (const doc of docs) {
    const common = {
      pointer_url: doc.acceptedUrl,
      final_url: doc.finalUrl,
      observed_pointer_urls: sorted(doc.info.observedUrls).join('|'),
      pointer_host: hostOf(doc.finalUrl),
      pointer_format: doc.format,
      pointer_sha256: doc.sha256,
      raw_file: path.relative(root, doc.rawFile),
      raw_bytes: doc.bytes,
      fetched_at: doc.fetchedAt,
      fetch_via: doc.via,
      source_datasets: sorted(doc.info.datasets).join('|'),
      source_domains: sorted(doc.info.domains).join('|'),
      related_ccns: sorted(doc.info.ccns).join('|')
    };
    const entries = doc.parsed.entries || [];
    if (!entries.length) {
      rows.push({ ...common, record_status: 'unparsed-pointer', entry_index: '', mrf_url_index: '' });
      continue;
    }
    entries.forEach((entry, entryIndex) => {
      const urls = [...new Set(values(entry, 'mrfUrl', 'mrfUrls'))];
      const emit = urls.length ? urls : [''];
      emit.forEach((mrfUrl, urlIndex) => {
        const matched = doc.info.links.get(normalizeUrl(mrfUrl)) || new Set();
        rows.push({
          ...common,
          record_status: mrfUrl ? 'ok' : 'missing-mrf-url',
          entry_index: entryIndex + 1,
          mrf_url_index: mrfUrl ? urlIndex + 1 : '',
          location_name: Array.isArray(entry.locationName) ? entry.locationName.join('|') : (entry.locationName || ''),
          source_page_url: values(entry, 'sourcePageUrl', 'sourcePageUrls').join('|'),
          mrf_url: mrfUrl,
          contact_name: values(entry, 'contactName', 'contactNames').join('|'),
          contact_email: values(entry, 'contactEmail', 'contactEmails').join('|'),
          extra_fields_json: entry.extraFields ? JSON.stringify(stableJson(entry.extraFields)) : '',
          matched_ccns: sorted(matched).join('|')
        });
      });
    });
  }
  rows.sort((a, b) => a.final_url.localeCompare(b.final_url)
    || Number(a.entry_index || 0) - Number(b.entry_index || 0)
    || Number(a.mrf_url_index || 0) - Number(b.mrf_url_index || 0)
    || String(a.mrf_url || '').localeCompare(String(b.mrf_url || '')));
  return rows;
}

function applyReviewedLinkCorrections(rows, resolutions) {
  const corrected = rows.map(row => ({ ...row }));
  for (const resolution of resolutions) {
    const e = resolution.evidence || {};
    if (resolution.action !== 'replace' || e.corpusLinkCorrection !== 'different-campus') continue;
    if (!resolution.ccn || !resolution.base?.mrf_url || !e.url || !/^[a-f0-9]{64}$/.test(e.pointerSha256 || '')
      || resolution.base.mrf_url === e.url) throw new Error(`Invalid corpus link correction ${resolution.ccn}`);
    const supplied = corrected.filter(row => normalizeUrl(row.mrf_url) === normalizeUrl(e.url)
      && row.pointer_sha256 === e.pointerSha256 && row.record_status === 'ok');
    if (!supplied.length) throw new Error(`Reviewed pointer/file bytes missing for corpus link correction ${resolution.ccn}`);
    for (const row of corrected) {
      if (normalizeUrl(row.mrf_url) !== normalizeUrl(resolution.base.mrf_url)) continue;
      row.matched_ccns = sorted(new Set(String(row.matched_ccns || '').split('|').filter(ccn => ccn && ccn !== resolution.ccn))).join('|');
    }
    for (const row of supplied) {
      row.matched_ccns = sorted(new Set([...String(row.matched_ccns || '').split('|').filter(Boolean), resolution.ccn])).join('|');
    }
  }
  return corrected;
}

function applyReviewedPrimeLinks(rows, review) {
  if (!review?.records?.length) return rows;
  if (review.excluded_ccn !== '230031') throw new Error('Prime link review lost its explicit Lake Huron exclusion');
  const corrected = rows.map(row => ({ ...row }));
  for (const link of review.records) {
    if (!link.ccn || link.ccn === review.excluded_ccn
      || !/^[a-f0-9]{64}$/.test(link.pointer_sha256 || '') || !link.mrf_url || !link.pointer_url)
      throw new Error(`Invalid reviewed Prime link ${link.ccn || ''}`);
    const matches = corrected.filter(row => row.record_status === 'ok'
      && row.pointer_url === link.pointer_url && row.pointer_sha256 === link.pointer_sha256
      && row.mrf_url === link.mrf_url);
    if (matches.length !== 1) throw new Error(`Expected one retained exact pointer/file row for ${link.ccn}, got ${matches.length}`);
    matches[0].matched_ccns = sorted(new Set([...String(matches[0].matched_ccns || '').split('|').filter(Boolean), link.ccn])).join('|');
  }
  return corrected;
}

function applyReviewedStamfordPointerAttribution(rows, proof) {
  if (!proof) return rows;
  if (proof.ccn !== '070006' || proof.hospital_name !== 'STAMFORD HOSPITAL'
      || proof.pointer_url !== 'https://stamfordhealth.org/cms-hpt.txt'
      || proof.pointer_sha256 !== 'f5ea2af2c5db3cf45c22d7301e03cceaf4473ddee8b118ec633c52d2e5847043'
      || proof.pointer_location_name !== 'Stamford Hospital'
      || proof.source_page_url !== 'https://www.stamfordhealth.org/patients/hospital-charges/'
      || proof.mrf_url !== 'https://www.stamfordhealth.org/-/media/project/healthcare-websites/stamfordhealth/documents/20260331_machine-readable-file.csv'
      || !Number.isFinite(Date.parse(proof.observed_at))) throw new Error('Stamford pointer attribution proof changed; manual review required');
  const corrected = rows.map(row => ({ ...row }));
  const matches = corrected.filter(row => row.record_status === 'ok'
    && row.pointer_url === proof.pointer_url && row.pointer_sha256 === proof.pointer_sha256
    && row.location_name === proof.pointer_location_name && row.source_page_url === proof.source_page_url
    && row.mrf_url === proof.mrf_url);
  if (matches.length !== 1) throw new Error(`Expected one retained Stamford pointer/file row, got ${matches.length}`);
  matches[0].matched_ccns = sorted(new Set([...String(matches[0].matched_ccns || '').split('|').filter(Boolean), proof.ccn])).join('|');
  return corrected;
}

function applyMulticareDualFileAttribution(rows, proof) {
  if (!proof) return rows;
  const pointerUrl = 'https://multicare.org/cms-hpt.txt';
  const pointerHash = '7981ae2ab16b08e52b2e8eb1120a3176f1d751b3d780b2499318b00a55b7273e';
  const allenmoreUrl = 'https://sthpiprd.blob.core.windows.net/machine-readable-files/8058/911352172-1366556227_tacoma-general-allenmore-hospital_standardcharges.csv';
  const tacomaUrl = 'https://sthpiprd.blob.core.windows.net/machine-readable-files/8062/911352172-1366556227_tacoma-general-allenmore-hospital_standardcharges.csv';
  if (proof.ccn !== '500129' || proof.pointer_url !== pointerUrl || proof.pointer_sha256 !== pointerHash
      || proof.pointer_entry_count !== 19 || proof.roster_address !== '315 S MLK JR WAY'
      || proof.allenmore?.mrf_url !== allenmoreUrl || proof.tacoma?.mrf_url !== tacomaUrl
      || proof.allenmore.sample_sha256 !== 'ea432c0dc1497fabd3f22d2891471b2a87f50231bf8ea971740a483029133f47'
      || proof.tacoma.sample_sha256 !== '0e7ddcabb174946b756b0839ff2488a0b2b87e89a9e71a0a65424f2d2d50bcf4'
      || proof.allenmore.sample_bytes !== 262144 || proof.tacoma.sample_bytes !== 262144
      || proof.allenmore.http_status !== 206 || proof.tacoma.http_status !== 206
      || proof.allenmore.declared_hospital_name !== 'Tacoma General Allenmore Hospital'
      || proof.tacoma.declared_hospital_name !== 'Tacoma General Allenmore Hospital'
      || !proof.allenmore.declared_addresses.includes('315 Martin Luther King Jr. Way, Tacoma, WA 98405')
      || !proof.tacoma.declared_addresses.includes('315 Martin Luther King Jr Way, Tacoma, WA 98405')
      || proof.allenmore.declared_license_state !== 'WA' || proof.tacoma.declared_license_state !== 'WA')
    throw new Error('MultiCare dual-file proof changed; manual review required');
  const corrected = rows.map(row => ({ ...row }));
  const siblings = corrected.filter(row => row.record_status === 'ok'
    && row.pointer_url === pointerUrl && row.pointer_sha256 === pointerHash);
  const allenmore = siblings.filter(row => row.mrf_url === allenmoreUrl);
  const tacoma = siblings.filter(row => row.mrf_url === tacomaUrl);
  if (siblings.length !== 19 || allenmore.length !== 1 || tacoma.length !== 3
      || !tacoma.every(row => String(row.matched_ccns || '').split('|').includes('500129')))
    throw new Error('MultiCare current pointer rows changed; manual review required');
  allenmore[0].matched_ccns = sorted(new Set([...String(allenmore[0].matched_ccns || '').split('|').filter(Boolean), '500129'])).join('|');
  return corrected;
}

function applyReviewedUvmSharedPointerAttribution(rows, proof, centerProof = null) {
  if (!proof) return rows;
  const hash = 'b9584a0bdb9b08b1a972d0c701d507c76f3bafa1591a59f1ab5e56998402e014';
  const pointerUrl = 'https://www.uvmhealth.org/cms-hpt.txt';
  const aliceUrl = 'https://www.uvmhealth.org/sites/default/files/150346515_alice-hyde-medical-center_standardcharges.csv';
  const champlainUrl = 'https://www.uvmhealth.org/sites/default/files/141338471_champlain-valley-physicians-hospital-medical-center_standardcharges.csv';
  if (proof.pointer_url !== pointerUrl || proof.pointer_sha256 !== hash || proof.pointer_entry_count !== 6
      || proof.alice?.ccn !== '331321' || proof.alice.mrf_url !== aliceUrl
      || proof.alice.declared_hospital_name !== 'Alice Hyde Medical Center'
      || !proof.alice.declared_addresses?.includes('133 Park Street, Malone, NY 12953')
      || proof.champlain?.ccn !== '330250' || proof.champlain.mrf_url !== champlainUrl
      || !proof.champlain.declared_addresses?.includes('75 Beekman Street, Plattsburgh, NY 12901')
      || proof.alice.file_sample_bytes !== 262144 || proof.champlain.file_sample_bytes !== 262144
      || !Number.isFinite(Date.parse(proof.observed_at)))
    throw new Error('UVM shared-pointer attribution proof changed; manual review required');
  const corrected = rows.map(row => ({ ...row }));
  const siblings = corrected.filter(row => row.record_status === 'ok'
    && row.pointer_url === pointerUrl && row.pointer_sha256 === hash);
  if (siblings.length !== 6 || new Set(siblings.map(row => row.mrf_url)).size !== 6
      || siblings.filter(row => row.mrf_url === aliceUrl).length !== 1
      || siblings.filter(row => row.mrf_url === champlainUrl).length !== 1)
    throw new Error('UVM retained pointer entries changed; manual review required');
  for (const row of siblings) {
    const ccns = new Set(String(row.matched_ccns || '').split('|').filter(Boolean));
    if (row.mrf_url !== champlainUrl) ccns.delete('330250');
    if (row.mrf_url === aliceUrl) ccns.add('331321');
    if (centerProof) {
      const centerUrl = 'https://www.uvmhealth.org/sites/default/files/030219309_university-of-vermont-medical-center-inc_standardcharges.csv';
      if (centerProof.ccn !== '470003' || centerProof.pointer_url !== pointerUrl
          || centerProof.pointer_sha256 !== hash || centerProof.mrf_url !== centerUrl
          || centerProof.declared_hospital_name !== 'University of Vermont Medical Center Inc'
          || !centerProof.declared_addresses?.includes('111 Colchester Avenue, Burlington, VT 05401')
          || centerProof.file_sample_bytes !== 262144
          || siblings.filter(item => item.mrf_url === centerUrl).length !== 1)
        throw new Error('UVM Medical Center alias proof changed; manual review required');
      if (row.mrf_url === centerUrl) ccns.add('470003');
      else ccns.delete('470003');
    }
    row.matched_ccns = sorted(ccns).join('|');
  }
  return corrected;
}

function rebindCurrentCatalogLinks(documents, catalog) {
  for (const doc of documents.values()) {
    const urls = new Set([doc.acceptedUrl, doc.finalUrl, ...doc.info.observedUrls]);
    for (const url of urls) {
      if (!catalog.urls.has(normalizeUrl(url))) continue;
      mergeInfo(doc.info, infoFor(catalog, { url }));
    }
  }
}

function toRFC4180(rows, columns = CSV_COLUMNS) {
  const escape = value => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [columns.join(','), ...rows.map(row => columns.map(column => escape(row[column])).join(','))].join('\r\n') + '\r\n';
}

async function verifyCorpusOutput(csvFile, rows, documents) {
  const parsedRows = csvToObjects(await fsp.readFile(csvFile, 'utf8'));
  if (parsedRows.length !== rows.length) {
    throw new Error(`CSV verification failed: wrote ${rows.length} rows but parsed ${parsedRows.length}`);
  }
  const csvFinalUrls = new Set(parsedRows.map(row => normalizeUrl(row.final_url)).filter(Boolean));
  if (csvFinalUrls.size !== documents.size) {
    throw new Error(`CSV verification failed: ${csvFinalUrls.size} pointer documents in CSV, expected ${documents.size}`);
  }
  let rawFiles = 0;
  for (const doc of documents.values()) {
    const raw = await fsp.readFile(doc.rawFile);
    rawFiles++;
    const hash = sha256(raw);
    if (hash !== doc.sha256) throw new Error(`Raw pointer hash mismatch: ${doc.rawFile}`);
  }
  return { csvParsedRows: parsedRows.length, pointerDocuments: csvFinalUrls.size, rawFiles, hashesVerified: rawFiles };
}

function failureSummary(catalog, documents, state) {
  const reasons = {};
  for (const domain of catalog.domains.keys()) {
    if (documentCoversDomain(documents, domain)) continue;
    const record = stateTarget(state, `domain:${domain}`);
    const reason = record && record.reason || 'not-attempted';
    reasons[reason] = (reasons[reason] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(reasons).sort(([a], [b]) => a.localeCompare(b)));
}

function targetSummary(state, prefix) {
  let ok = 0;
  const failedByReason = {};
  for (const [key, record] of Object.entries(state.targets || {})) {
    if (!key.startsWith(prefix)) continue;
    if (record.status === 'ok') ok++;
    else {
      const reason = record.reason || 'unknown';
      failedByReason[reason] = (failedByReason[reason] || 0) + 1;
    }
  }
  return { ok, failedByReason: Object.fromEntries(Object.entries(failedByReason).sort(([a], [b]) => a.localeCompare(b))) };
}

async function runCorpus(rawOptions = {}, dependencies = {}) {
  const root = path.resolve(dependencies.root || ROOT);
  const outputDir = path.resolve(dependencies.outputDir || rawOptions.out || DEFAULT_OUT);
  const fetchImpl = dependencies.fetchImpl || fetch;
  const log = dependencies.log || console.log;
  const options = {
    refresh: !!rawOptions.refresh,
    retryFailed: !!(rawOptions['retry-failed'] || rawOptions.retryFailed),
    rootOnly: !!(rawOptions['root-only'] || rawOptions.rootOnly),
    limit: rawOptions.limit ? positiveNumber(rawOptions.limit, 0) : 0,
    concurrency: positiveNumber(rawOptions.concurrency, 10),
    timeoutMs: positiveNumber(rawOptions.timeout, 20000),
    maxBytes: positiveNumber(rawOptions['max-bytes'], DEFAULT_MAX_BYTES)
  };
  const reindexOnly = !!(rawOptions['reindex-only'] || rawOptions.reindexOnly);
  const refreshUrls = String(rawOptions['refresh-url'] || rawOptions.refreshUrl || '')
    .split('|').map(normalizeUrl).filter(Boolean);
  if (refreshUrls.length && reindexOnly)
    throw new Error('A targeted pointer refresh cannot be combined with reindex-only');
  await fsp.mkdir(path.join(outputDir, 'raw'), { recursive: true });
  const stateFile = path.join(outputDir, 'crawl-state.json');
  const csvFile = path.resolve(rawOptions.csv || path.join(outputDir, 'cms_hpt_entries.csv'));
  const state = await readJsonIfPresent(stateFile, { schemaVersion: 1, targets: {} });
  state.schemaVersion = 1;
  const invalidatedHtmlPointers = await invalidateHtmlPointerSnapshots(state, root);
  if (invalidatedHtmlPointers) log(`Invalidated ${invalidatedHtmlPointers} HTML page(s) previously indexed as pointer files.`);
  const catalog = await loadSourceCatalog(root, {
    externalOnly: !!rawOptions['external-only'],
    domainCsv: rawOptions['domain-csv'] ? path.resolve(root, rawOptions['domain-csv']) : '',
    dataset: rawOptions.dataset || 'external-candidates'
  });
  for (const url of refreshUrls) if (!catalog.urls.has(url))
    throw new Error(`Targeted refresh URL is not in the source catalog: ${url}`);
  let documents = new Map();
  await loadCorpusState(state, documents, root, outputDir);
  const stateDocumentKeys = new Set(documents.keys());

  if (!rawOptions['external-only']) {
    await importPointerCache({
      storeFile: path.join(root, 'cms_data', 'hpt', 'pointers.json'),
      baseDir: root, dataset: 'current', catalog, state, documents, root, outputDir
    });
  }
  // The legacy pointer store contains valid, hash-retained documents whose
  // current domain target later failed. Keep those historical bytes in the
  // corpus even though they do not turn the later failed target into success.
  const retainedDocuments = documents;
  const legacyCacheOnlyKeys = new Set([...documents.keys()].filter(key => !stateDocumentKeys.has(key)));
  let networkBudget = options.limit || Infinity;
  let saveCount = 0;
  let saveChain = Promise.resolve();
  const saveState = force => {
    if (!force && ++saveCount % 10 !== 0) return Promise.resolve();
    saveChain = saveChain.then(() => {
      state.updatedAt = new Date().toISOString();
      return writeAtomic(stateFile, JSON.stringify(state, null, 1) + '\n');
    });
    return saveChain;
  };

  let exactTargets = reindexOnly ? [] : [...catalog.urls.entries()].sort(([a], [b]) => a.localeCompare(b)).filter(([key, item]) => {
    if (refreshUrls.length) return refreshUrls.includes(key);
    if (options.refresh) return true;
    if (documentForObservedUrl(documents, item.url)) return false;
    const prior = stateTarget(state, `url:${key}`);
    return !prior || prior.status === 'ok' || options.retryFailed;
  });
  if (Number.isFinite(networkBudget)) exactTargets = exactTargets.slice(0, networkBudget);
  networkBudget -= exactTargets.length;
  if (exactTargets.length) log(`Fetching ${exactTargets.length} known pointer URLs (free direct requests only)...`);
  await pooled(exactTargets, {
    concurrency: options.concurrency,
    keyFn: ([, item]) => hostOf(item.url),
    onProgress: (done, total) => { if (done === total || done % 50 === 0) log(`known URLs ${done}/${total}`); }
  }, async ([key, item]) => {
    const fetchedAt = new Date().toISOString();
    const result = await fetchKnownPointer(item.url, { ...options, fetchImpl });
    if (result.ok) {
      const info = infoFor(catalog, { url: item.url });
      const doc = await addDocument(documents, outputDir, { ...result, fetchedAt, info });
      updateState(state, `url:${key}`, stateRecordForDocument({ ...doc, info }, root, 'url', item.url, result.attempts));
      // A successful exact refresh of the same requested URL supersedes an
      // older domain/cache snapshot, even when the publisher now redirects to
      // a different final path. Preserve its bytes in lastSuccessful, not as
      // another current pointer document.
      for (const [targetKey, prior] of Object.entries(state.targets || {})) {
        if (!targetKey.startsWith('domain:') || prior.status !== 'ok'
            || normalizeUrl(prior.acceptedUrl) !== key || prior.sha256 === doc.sha256
            || String(prior.fetchedAt || '') > fetchedAt) continue;
        updateState(state, targetKey, { kind: 'domain', input: prior.input,
          status: 'superseded', reason: 'newer-exact-url-bytes', fetchedAt,
          supersededBy: { acceptedUrl: item.url, finalUrl: doc.finalUrl, sha256: doc.sha256 } });
      }
    } else {
      updateState(state, `url:${key}`, {
        kind: 'url', input: item.url, status: 'failed', reason: result.reason,
        fetchedAt, via: 'direct-exact', attempts: result.attempts
      });
    }
    await saveState(false);
  });

  documents = await documentsFromSuccessfulState(state, root, outputDir);
  let domainTargets = reindexOnly || refreshUrls.length ? [] : [...catalog.domains.keys()].sort().filter(domain => {
    if (documentCoversDomain(documents, domain)) return false;
    const prior = stateTarget(state, `domain:${domain}`);
    if (!prior) return true;
    if (prior.status === 'ok') return true;
    return options.refresh || options.retryFailed;
  });
  if (Number.isFinite(networkBudget)) domainTargets = domainTargets.slice(0, Math.max(0, networkBudget));
  if (domainTargets.length) {
    const scope = options.rootOnly ? 'root cms-hpt.txt, following redirects' : 'root/.well-known, apex/www, redirects';
    log(`Probing ${domainTargets.length} unresolved domains (${scope})...`);
  }
  await pooled(domainTargets, {
    concurrency: options.concurrency,
    keyFn: domain => domain,
    onProgress: (done, total) => { if (done === total || done % 50 === 0) log(`domains ${done}/${total}`); }
  }, async domain => {
    const fetchedAt = new Date().toISOString();
    const result = await fetchDomainPointer(domain, { ...options, fetchImpl });
    if (result.ok) {
      const info = infoFor(catalog, { url: result.acceptedUrl, domain });
      mergeInfo(info, infoFor(catalog, { url: result.finalUrl, domain }));
      const doc = await addDocument(documents, outputDir, {
        acceptedUrl: result.acceptedUrl, finalUrl: result.finalUrl || result.acceptedUrl,
        body: result.body, via: result.via || 'direct-domain', fetchedAt, info
      });
      updateState(state, `domain:${domain}`, stateRecordForDocument({ ...doc, info }, root, 'domain', domain, result.attempts));
    } else {
      updateState(state, `domain:${domain}`, {
        kind: 'domain', input: domain, status: 'failed', reason: result.reason,
        fetchedAt, via: 'direct-domain', attempts: result.attempts
      });
    }
    await saveState(false);
  });

  await saveState(true);
  const currentDocuments = await documentsFromSuccessfulState(state, root, outputDir);
  let historicalCacheOnlyDocuments = 0;
  for (const key of legacyCacheOnlyKeys) {
    if (currentDocuments.has(key)) continue;
    const doc = retainedDocuments.get(key);
    currentDocuments.set(key, doc);
    historicalCacheOnlyDocuments++;
  }
  // State snapshots preserve past exact links, while the reviewed manifest
  // can supersede a crossed or missing assignment. Reapply its exact URL/MRF
  // links to retained bytes; rowsForDocuments only emits links for URLs that
  // actually appear in those parsed pointer bytes.
  rebindCurrentCatalogLinks(currentDocuments, catalog);
  const resolutionFile = path.join(root, 'data/hpt-audit/reviewed-resolutions.json');
  const resolutions = await readJsonIfPresent(resolutionFile, []);
  const primeReview = await readJsonIfPresent(path.join(root, 'data/hpt-audit/reviewed-prime-corpus-links.json'), { records: [] });
  const uvmProof = await readJsonIfPresent(path.join(root, 'data/hpt-audit/reconciliation-uvm-shared-pointer-attribution-proof.json'), null);
  const uvmCenterProof = await readJsonIfPresent(path.join(root, 'data/hpt-audit/reconciliation-uvm-medical-center-alias-proof.json'), null);
  const multicareProof = await readJsonIfPresent(path.join(root, 'data/hpt-audit/reconciliation-multicare-tacoma-allenmore-dual-file-proof.json'), null);
  const stamfordProof = await readJsonIfPresent(path.join(root, 'data/hpt-audit/reconciliation-stamford-pointer-attribution-proof.json'), null);
  const rows = applyMulticareDualFileAttribution(applyReviewedStamfordPointerAttribution(applyReviewedUvmSharedPointerAttribution(applyReviewedPrimeLinks(
    applyReviewedLinkCorrections(rowsForDocuments(currentDocuments, root), resolutions), primeReview), uvmProof, uvmCenterProof), stamfordProof), multicareProof);
  await writeAtomic(csvFile, toRFC4180(rows));
  const verification = await verifyCorpusOutput(csvFile, rows, currentDocuments);
  const uniqueMrfs = new Set(rows.map(row => normalizeUrl(row.mrf_url)).filter(Boolean));
  const unresolvedDomainsByReason = failureSummary(catalog, currentDocuments, state);
  const summary = {
    generatedAt: new Date().toISOString(),
    inputRows: catalog.inputRows,
    candidateDomains: catalog.domains.size,
    knownPointerUrls: catalog.urls.size,
    pointerDocuments: currentDocuments.size,
    historicalCacheOnlyDocuments,
    knownUrlFetch: targetSummary(state, 'url:'),
    unresolvedDomains: Object.values(unresolvedDomainsByReason).reduce((sum, count) => sum + count, 0),
    unresolvedDomainsByReason,
    uniqueMrfUrls: uniqueMrfs.size,
    csvRows: rows.length,
    reviewedLinkCorrections: resolutions.filter(row => row.action === 'replace'
      && row.evidence?.corpusLinkCorrection === 'different-campus').length,
    reviewedPrimeLinks: primeReview.records.length,
    rawBytes: [...currentDocuments.values()].reduce((total, doc) => total + doc.bytes, 0),
    verification,
    csvFile: path.relative(root, csvFile)
  };
  state.summary = summary;
  state.updatedAt = summary.generatedAt;
  await writeAtomic(stateFile, JSON.stringify(state, null, 1) + '\n');
  log(JSON.stringify(summary, null, 2));
  return { summary, rows, documents: currentDocuments, state, csvFile, stateFile, outputDir };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await runCorpus(options);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error && error.stack || error);
    process.exitCode = 1;
  });
}

module.exports = {
  CSV_COLUMNS, normalizeUrl, normalizeDomain, loadSourceCatalog,
  fetchKnownPointer, fetchDomainPointer, rowsForDocuments, applyReviewedLinkCorrections,
  applyReviewedPrimeLinks, applyReviewedUvmSharedPointerAttribution, applyReviewedStamfordPointerAttribution, applyMulticareDualFileAttribution, rebindCurrentCatalogLinks, toRFC4180,
  verifyCorpusOutput, runCorpus
};
