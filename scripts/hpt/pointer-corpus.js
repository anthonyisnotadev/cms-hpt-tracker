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
    const manifestPaths = [
      path.join(root, 'cms_data', 'hpt', 'manifest.csv'),
      path.join(root, 'data', 'hpt-audit', 'manifest.csv')
    ];
    for (const file of manifestPaths) {
      const rows = await readCsvIfPresent(file);
      catalog.inputRows.current += rows.length;
      for (const row of rows) {
        const domain = normalizeDomain(row.domain || hostOf(row.pointer_url));
        touchDomain(catalog, domain, 'current', row.ccn);
        const info = touchUrl(catalog, row.pointer_url, 'current', domain, row.ccn);
        if (info) addLink(info, row.mrf_url, row.ccn);
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
  state.targets[key] = { ...prior, ...record, history };
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

async function addDocument(documents, outputDir, candidate) {
  if (!candidate.body || !looksLikePointer(candidate.body)) return null;
  const doc = makeDocument(candidate);
  const key = normalizeUrl(doc.finalUrl);
  if (!key) return null;
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
}

async function persistRaw(doc, outputDir) {
  const file = path.join(outputDir, 'raw', rawName(doc.finalUrl));
  await writeAtomic(file, doc.body);
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

async function importPointerCache({ storeFile, baseDir, dataset, catalog, state, documents, root, outputDir }) {
  const store = await readJsonIfPresent(storeFile, {});
  for (const [domain, record] of Object.entries(store || {})) {
    const key = `domain:${normalizeDomain(domain)}`;
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
        updateState(state, key, stateRecordForDocument(doc, root, 'domain', normalizeDomain(domain), record.attempts || []));
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
  await fsp.mkdir(path.join(outputDir, 'raw'), { recursive: true });
  const stateFile = path.join(outputDir, 'crawl-state.json');
  const csvFile = path.resolve(rawOptions.csv || path.join(outputDir, 'cms_hpt_entries.csv'));
  const state = await readJsonIfPresent(stateFile, { schemaVersion: 1, targets: {} });
  state.schemaVersion = 1;
  const catalog = await loadSourceCatalog(root, {
    externalOnly: !!rawOptions['external-only'],
    domainCsv: rawOptions['domain-csv'] ? path.resolve(root, rawOptions['domain-csv']) : '',
    dataset: rawOptions.dataset || 'external-candidates'
  });
  const documents = new Map();
  await loadCorpusState(state, documents, root, outputDir);

  if (!rawOptions['external-only']) {
    await importPointerCache({
      storeFile: path.join(root, 'cms_data', 'hpt', 'pointers.json'),
      baseDir: root, dataset: 'current', catalog, state, documents, root, outputDir
    });
  }
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

  let exactTargets = [...catalog.urls.entries()].sort(([a], [b]) => a.localeCompare(b)).filter(([key, item]) => {
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
      updateState(state, `url:${key}`, stateRecordForDocument(doc, root, 'url', item.url, result.attempts));
    } else {
      updateState(state, `url:${key}`, {
        kind: 'url', input: item.url, status: 'failed', reason: result.reason,
        fetchedAt, via: 'direct-exact', attempts: result.attempts
      });
    }
    await saveState(false);
  });

  let domainTargets = [...catalog.domains.keys()].sort().filter(domain => {
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
      updateState(state, `domain:${domain}`, stateRecordForDocument(doc, root, 'domain', domain, result.attempts));
    } else {
      updateState(state, `domain:${domain}`, {
        kind: 'domain', input: domain, status: 'failed', reason: result.reason,
        fetchedAt, via: 'direct-domain', attempts: result.attempts
      });
    }
    await saveState(false);
  });

  await saveState(true);
  const rows = rowsForDocuments(documents, root);
  await writeAtomic(csvFile, toRFC4180(rows));
  const verification = await verifyCorpusOutput(csvFile, rows, documents);
  const uniqueMrfs = new Set(rows.map(row => normalizeUrl(row.mrf_url)).filter(Boolean));
  const unresolvedDomainsByReason = failureSummary(catalog, documents, state);
  const summary = {
    generatedAt: new Date().toISOString(),
    inputRows: catalog.inputRows,
    candidateDomains: catalog.domains.size,
    knownPointerUrls: catalog.urls.size,
    pointerDocuments: documents.size,
    knownUrlFetch: targetSummary(state, 'url:'),
    unresolvedDomains: Object.values(unresolvedDomainsByReason).reduce((sum, count) => sum + count, 0),
    unresolvedDomainsByReason,
    uniqueMrfUrls: uniqueMrfs.size,
    csvRows: rows.length,
    rawBytes: [...documents.values()].reduce((total, doc) => total + doc.bytes, 0),
    verification,
    csvFile: path.relative(root, csvFile)
  };
  state.summary = summary;
  state.updatedAt = summary.generatedAt;
  await writeAtomic(stateFile, JSON.stringify(state, null, 1) + '\n');
  log(JSON.stringify(summary, null, 2));
  return { summary, rows, documents, state, csvFile, stateFile, outputDir };
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
  fetchKnownPointer, fetchDomainPointer, rowsForDocuments, toRFC4180,
  verifyCorpusOutput, runCorpus
};
