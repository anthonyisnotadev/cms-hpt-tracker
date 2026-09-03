'use strict';

/**
 * Probe every unique MRF referenced by a normalized cms-hpt.txt corpus.
 *
 * This stage intentionally performs only HEAD and capped/ranged GET requests.
 * It never downloads a complete MRF. Results are cached by normalized URL so
 * interrupted runs can resume without repeating successful network work.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const { csvToObjects, hostOf, JsonStore, pooled } = require('./lib/util');
const { probeMrf } = require('./lib/probe');
const { matchMrfHeader } = require('./lib/mrf-header-match');
const { normalizeUrl, toRFC4180 } = require('./pointer-corpus');

const ROOT = path.join(__dirname, '..', '..');
const DEFAULT_INPUT = path.join(ROOT, 'cms_data', 'hpt', 'external_cms_hpt_entries.csv');
const DEFAULT_OUTPUT = path.join(ROOT, 'cms_data', 'hpt', 'external_cms_hpt_mrf_headers.csv');
const DEFAULT_CACHE = path.join(ROOT, 'cms_data', 'hpt', 'external-pointer-corpus', 'mrf-header-cache.json');
const CACHE_SCHEMA_VERSION = 1;
const CSV_COLUMNS = [
  'pointer_domains', 'pointer_urls', 'pointer_sha256s', 'raw_files',
  'source_datasets', 'related_ccns', 'existing_matched_ccns',
  'pointer_location_names', 'source_page_urls', 'mrf_url',
  'header_status', 'match_reason', 'mrf_http_status', 'mrf_range_status',
  'mrf_file_kind', 'mrf_inner_kind', 'mrf_content_type', 'mrf_bytes',
  'mrf_license_state', 'mrf_hospital_name', 'mrf_location_name', 'mrf_address',
  'mrf_last_updated_raw', 'mrf_last_updated', 'mrf_date_source',
  'mrf_days_since_update', 'mrf_stale_over_365', 'mrf_cms_version',
  'header_matched_ccns', 'header_matched_hospital_names',
  'review_ccns', 'review_hospital_names', 'checked_at', 'head_error', 'range_error'
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

function splitValues(value) {
  return String(value || '').split('|').map(item => item.trim()).filter(Boolean);
}

function addValues(target, value) {
  for (const item of splitValues(value)) target.add(item);
}

function sortedJoin(values) {
  return [...values].filter(Boolean).sort((a, b) => a.localeCompare(b)).join('|');
}

function groupCorpusRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const mrfUrl = normalizeUrl(row.mrf_url);
    if (!mrfUrl) continue;
    if (!groups.has(mrfUrl)) {
      groups.set(mrfUrl, {
        mrf_url: mrfUrl, refs: [], refKeys: new Set(),
        pointerDomains: new Set(), pointerUrls: new Set(), pointerSha256s: new Set(),
        rawFiles: new Set(), sourceDatasets: new Set(), relatedCcns: new Set(),
        existingMatchedCcns: new Set(), pointerLocationNames: new Set(),
        sourcePageUrls: new Set()
      });
    }
    const group = groups.get(mrfUrl);
    const domains = splitValues(row.source_domains || row.pointer_host);
    if (!domains.length && row.pointer_host) domains.push(String(row.pointer_host).trim());
    addValues(group.pointerDomains, domains.join('|'));
    addValues(group.pointerUrls, row.final_url || row.pointer_url);
    addValues(group.pointerUrls, row.observed_pointer_urls);
    addValues(group.pointerSha256s, row.pointer_sha256);
    addValues(group.rawFiles, row.raw_file);
    addValues(group.sourceDatasets, row.source_datasets);
    addValues(group.relatedCcns, row.related_ccns);
    addValues(group.existingMatchedCcns, row.matched_ccns);
    addValues(group.pointerLocationNames, row.location_name);
    addValues(group.sourcePageUrls, row.source_page_url);
    for (const domain of domains.length ? domains : ['']) {
      const ref = {
        domain,
        state: '',
        pointer_url: row.final_url || row.pointer_url || '',
        pointer_via: row.fetch_via || '',
        pointer_format: row.pointer_format || '',
        location_name: row.location_name || '',
        source_page_url: row.source_page_url || ''
      };
      const key = [ref.domain, ref.pointer_url, ref.location_name, ref.source_page_url].join('|');
      if (!group.refKeys.has(key)) {
        group.refKeys.add(key);
        group.refs.push(ref);
      }
    }
  }
  return [...groups.values()].sort((a, b) => a.mrf_url.localeCompare(b.mrf_url));
}

function cacheKey(url) {
  return `v${CACHE_SCHEMA_VERSION}:${crypto.createHash('sha256').update(url).digest('hex')}`;
}

function hostBucket(url, perHost) {
  const host = hostOf(url);
  if (perHost <= 1) return host;
  const hash = crypto.createHash('sha256').update(url).digest();
  return `${host}:${hash.readUInt32BE(0) % perHost}`;
}

function daysSince(isoDate, now = new Date()) {
  if (!isoDate) return '';
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime())) return '';
  return Math.floor((now.getTime() - parsed.getTime()) / 86400000);
}

function rowForResult(task, probe, matched, now = new Date()) {
  const days = daysSince(probe && probe.declaredLastUpdated, now);
  const matchedHospitals = matched.matches || [];
  const reviewHospitals = matched.reviews || [];
  return {
    pointer_domains: sortedJoin(task.pointerDomains),
    pointer_urls: sortedJoin(task.pointerUrls),
    pointer_sha256s: sortedJoin(task.pointerSha256s),
    raw_files: sortedJoin(task.rawFiles),
    source_datasets: sortedJoin(task.sourceDatasets),
    related_ccns: sortedJoin(task.relatedCcns),
    existing_matched_ccns: sortedJoin(task.existingMatchedCcns),
    pointer_location_names: sortedJoin(task.pointerLocationNames),
    source_page_urls: sortedJoin(task.sourcePageUrls),
    mrf_url: task.mrf_url,
    header_status: matched.status,
    match_reason: matched.reason,
    mrf_http_status: probe && probe.httpStatus || '',
    mrf_range_status: probe && probe.rangeStatus || '',
    mrf_file_kind: probe && probe.fileKind || '',
    mrf_inner_kind: probe && probe.innerKind || '',
    mrf_content_type: probe && probe.contentType || '',
    mrf_bytes: probe && probe.bytes || '',
    mrf_license_state: probe && probe.mrfLicenseState || '',
    mrf_hospital_name: probe && probe.mrfHospitalName || '',
    mrf_location_name: probe && probe.mrfLocationName || '',
    mrf_address: probe && probe.mrfAddress || '',
    mrf_last_updated_raw: probe && probe.declaredRaw || '',
    mrf_last_updated: probe && probe.declaredLastUpdated || '',
    mrf_date_source: probe && probe.dateSource || '',
    mrf_days_since_update: days,
    mrf_stale_over_365: days === '' ? '' : days > 365,
    mrf_cms_version: probe && probe.cmsVersion || '',
    header_matched_ccns: matchedHospitals.map(item => item.hospital.ccn).filter(Boolean).sort().join('|'),
    header_matched_hospital_names: matchedHospitals.map(item => item.hospital.name || item.hospital.hospital_name).filter(Boolean).sort().join('|'),
    review_ccns: reviewHospitals.map(item => item.hospital.ccn).filter(Boolean).sort().join('|'),
    review_hospital_names: reviewHospitals.map(item => item.hospital.name || item.hospital.hospital_name).filter(Boolean).sort().join('|'),
    checked_at: probe && probe.checkedAt || '',
    head_error: probe && probe.headError || '',
    range_error: probe && probe.rangeError || ''
  };
}

async function writeAtomic(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fsp.writeFile(tmp, value);
  await fsp.rename(tmp, file);
}

function countBy(rows, field) {
  const counts = {};
  for (const row of rows) {
    const key = String(row[field] || 'blank');
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

async function runHeaderCorpus(rawOptions = {}, dependencies = {}) {
  const root = path.resolve(dependencies.root || ROOT);
  const inputFile = path.resolve(root, rawOptions.input || DEFAULT_INPUT);
  const outputFile = path.resolve(root, rawOptions.out || DEFAULT_OUTPUT);
  const cacheFile = path.resolve(root, rawOptions.cache || DEFAULT_CACHE);
  const rosterFile = path.resolve(root, rawOptions.roster || path.join(root, 'cms_data', 'hpt', 'roster.json'));
  const log = dependencies.log || console.log;
  const probeImpl = dependencies.probeImpl || probeMrf;
  const concurrency = positiveNumber(rawOptions.concurrency, 30);
  const perHost = positiveNumber(rawOptions['per-host'] || rawOptions.perHost, 4);
  const timeoutMs = positiveNumber(rawOptions.timeout, 20000);
  const refresh = !!rawOptions.refresh;
  const limit = rawOptions.limit ? positiveNumber(rawOptions.limit, 0) : 0;

  const corpusRows = csvToObjects(await fsp.readFile(inputFile, 'utf8'));
  const hospitals = JSON.parse((await fsp.readFile(rosterFile, 'utf8')).replace(/^\uFEFF/, ''));
  const allTasks = groupCorpusRows(corpusRows);
  const tasks = limit ? allTasks.slice(0, limit) : allTasks;
  const cache = new JsonStore(cacheFile);
  await cache.load();
  let cacheHits = 0;
  let completed = 0;
  let saveCount = 0;
  let saveChain = Promise.resolve();
  const saveCache = force => {
    if (!force && ++saveCount % 10 !== 0) return Promise.resolve();
    saveChain = saveChain.then(() => cache.save(force));
    return saveChain;
  };

  log(`Probing ${tasks.length} unique MRF headers (HEAD plus capped Range GET only)...`);
  const probes = await pooled(tasks, {
    concurrency,
    keyFn: task => hostBucket(task.mrf_url, perHost),
    onProgress: (done, total) => {
      completed = done;
      if (done === total || done % 50 === 0) log(`MRF headers ${done}/${total}`);
    }
  }, async task => {
    const key = cacheKey(task.mrf_url);
    if (!refresh && cache.has(key)) {
      cacheHits++;
      return cache.get(key);
    }
    let result;
    try {
      result = await probeImpl(task.mrf_url, { timeoutMs, useUnblocker: false });
    } catch (error) {
      result = {
        url: task.mrf_url,
        checkedAt: new Date().toISOString(),
        rangeError: String(error && error.message || error).slice(0, 120)
      };
    }
    cache.set(key, result);
    await saveCache(false);
    return result;
  });
  await saveCache(true);

  const now = dependencies.now || new Date();
  const rows = tasks.map((task, index) => {
    const probe = probes[index] && probes[index].error
      ? { checkedAt: new Date().toISOString(), rangeError: probes[index].error }
      : probes[index];
    const matched = matchMrfHeader(task, probe, hospitals);
    return rowForResult(task, probe, matched, now);
  });
  await writeAtomic(outputFile, toRFC4180(rows, CSV_COLUMNS));
  const parsed = csvToObjects(await fsp.readFile(outputFile, 'utf8'));
  if (parsed.length !== rows.length) throw new Error(`CSV verification failed: wrote ${rows.length}, parsed ${parsed.length}`);
  const summary = {
    generatedAt: new Date().toISOString(),
    inputRows: corpusRows.length,
    uniqueMrfUrls: allTasks.length,
    probedRows: rows.length,
    completed,
    cacheHits,
    concurrency,
    perHost,
    headerStatus: countBy(rows, 'header_status'),
    rangeStatus: countBy(rows, 'mrf_range_status'),
    headersWithHospitalName: rows.filter(row => row.mrf_hospital_name || row.mrf_location_name).length,
    headersWithLicenseState: rows.filter(row => row.mrf_license_state).length,
    outputFile: path.relative(root, outputFile),
    cacheFile: path.relative(root, cacheFile)
  };
  log(JSON.stringify(summary, null, 2));
  return { summary, rows, tasks, outputFile, cacheFile };
}

async function main() {
  await runHeaderCorpus(parseArgs(process.argv.slice(2)));
}

if (require.main === module) {
  main().catch(error => {
    console.error(error && error.stack || error);
    process.exitCode = 1;
  });
}

module.exports = {
  CSV_COLUMNS, parseArgs, splitValues, groupCorpusRows, cacheKey, hostBucket,
  daysSince, rowForResult, runHeaderCorpus
};
