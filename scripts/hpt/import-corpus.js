'use strict';

/**
 * Import exact facility links from the normalized cms-hpt pointer corpus into
 * the tracker snapshot. The operation is intentionally two-phase:
 *
 *   node scripts/hpt/import-corpus.js
 *   node scripts/hpt/run.js dates --noUnblocker
 *   node scripts/hpt/import-corpus.js --publish
 *
 * A reviewed header-evidence directory can be used instead of the default
 * pointer corpus. This consumes only rows that the conservative MRF-header
 * matcher marked `matched`; review/unmatched rows remain untouched:
 *
 *   node scripts/hpt/import-corpus.js --evidence-dir=cms_data/hpt/new
 *   node scripts/hpt/run.js dates --noUnblocker
 *   node scripts/hpt/import-corpus.js --evidence-dir=cms_data/hpt/new --publish
 *
 * The prepare phase writes a working manifest and seeds mrf_dates.json from
 * the published snapshot, so `dates` probes only genuinely new URLs. The
 * publish phase updates the existing compliance rows, removes newly matched
 * hospitals from gaps, and refreshes the three published CSVs.
 *
 * Only corpus `matched_ccns` are accepted. `related_ccns` are pointer-level
 * context and are never promoted to facility matches.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const { csvToObjects, hostOf } = require('./lib/util');
const { guessFormat, isPlausibleMrfUrl } = require('./lib/parse');
const { normalizeUrl, normalizeDomain, toRFC4180 } = require('./pointer-corpus');

const ROOT = path.join(__dirname, '..', '..');
const DEFAULT_WORK = path.join(ROOT, 'cms_data', 'hpt');
const DEFAULT_SOURCE = path.join(ROOT, 'data', 'hpt-audit');
const DEFAULT_CORPUS = path.join(DEFAULT_WORK, 'pointer-corpus', 'cms_hpt_entries.csv');
const HEADER_EVIDENCE_FILES = [
  { name: 'external_cms_hpt_mrf_headers.csv', source: 'external-links-header-evidence' },
  { name: 'direct_mrf_headers.csv', source: 'direct-mrf-header-evidence', requireClaimedCcn: true }
];

const MANIFEST_COLS = [
  'ccn', 'hospital_name', 'city', 'state', 'type', 'domain', 'pointer_url', 'pointer_via',
  'location_name', 'mrf_url', 'source_page_url', 'extra_mrf_urls', 'mrf_format',
  'match_score', 'match_method',
  'mrf_last_updated', 'mrf_last_updated_raw', 'mrf_date_source', 'mrf_days_since_update',
  'mrf_stale_over_365', 'mrf_cms_version', 'mrf_bytes',
  'match_corroboration',
  'mrf_content_type', 'mrf_file_kind', 'mrf_http_status', 'mrf_checked_at',
  'mrf_http_last_modified_diagnostic'
];
const COMPLIANCE_COLS = [
  'ccn', 'hospital_name', 'city', 'state', 'type', 'finding', 'assessable', 'evidence',
  'domain', 'pointer_url', 'mrf_url', 'mrf_last_updated', 'mrf_days_since_update',
  'cms_template_version', 'checked_at'
];
const GAPS_COLS = [
  'ccn', 'hospital_name', 'address', 'city', 'state', 'zip', 'phone', 'type',
  'seeded_domain', 'pointer_status', 'remediation', 'reason', 'exa_query', 'resolved_domain'
];

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (match) out[match[1]] = match[2] === undefined ? true : match[2];
  }
  return out;
}

async function exists(file) {
  try { await fsp.access(file); return true; }
  catch (_e) { return false; }
}

async function readCsv(file) {
  return csvToObjects((await fsp.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
}

async function readJson(file, fallback) {
  try { return JSON.parse((await fsp.readFile(file, 'utf8')).replace(/^\uFEFF/, '')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

async function writeAtomic(file, contents) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fsp.writeFile(tmp, contents);
  await fsp.rename(tmp, file);
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function splitCcns(value) {
  return [...new Set(String(value || '').split('|').map(v => v.trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

function candidateRank(row) {
  return (String(row.pointer_url || '').startsWith('https://') ? 8 : 0)
    + (String(row.final_url || '').startsWith('https://') ? 4 : 0)
    + (String(row.source_datasets || '').split('|').includes('current') ? 2 : 0)
    + (row.location_name ? 1 : 0);
}

function chooseCandidate(rows) {
  return rows.slice().sort((a, b) => candidateRank(b) - candidateRank(a)
    || String(b.fetched_at || '').localeCompare(String(a.fetched_at || ''))
    || String(a.pointer_url || '').localeCompare(String(b.pointer_url || '')))[0];
}

function collectExactCandidates(corpusRows, { excludeCcns = new Set(), conflicts = null } = {}) {
  const byCcn = new Map();
  for (const row of corpusRows) {
    if (row.record_status !== 'ok' || !isPlausibleMrfUrl(row.mrf_url)) continue;
    for (const ccn of splitCcns(row.matched_ccns)) {
      if (excludeCcns.has(ccn)) continue;
      if (!byCcn.has(ccn)) byCcn.set(ccn, []);
      byCcn.get(ccn).push(row);
    }
  }

  const selected = new Map();
  for (const [ccn, rows] of byCcn) {
    const byUrl = new Map();
    for (const row of rows) {
      const key = normalizeUrl(row.mrf_url);
      if (!byUrl.has(key)) byUrl.set(key, []);
      byUrl.get(key).push(row);
    }
    if (byUrl.size !== 1) {
      const mrfUrls = [...byUrl.keys()].sort((a, b) => a.localeCompare(b));
      if (conflicts) {
        conflicts.push({ ccn, mrf_urls: mrfUrls });
        continue;
      }
      throw new Error(`Corpus links CCN ${ccn} to conflicting MRF URLs: ${mrfUrls.join(' | ')}`);
    }
    selected.set(ccn, chooseCandidate([...byUrl.values()][0]));
  }
  return selected;
}

function splitValues(value) {
  return [...new Set(String(value || '').split('|').map(item => item.trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

function preferredUrl(value) {
  return splitValues(value).sort((a, b) => {
    const rank = url => String(url).startsWith('https://') ? 0 : (String(url).startsWith('http://') ? 1 : 2);
    return rank(a) - rank(b) || a.localeCompare(b);
  })[0] || '';
}

function headerEvidenceCandidate(row, source, options = {}) {
  if (row.header_status !== 'matched') return null;
  let matchedCcns = splitValues(row.header_matched_ccns || row.matched_ccns || '');
  if (options.requireClaimedCcn) {
    const claimed = new Set(splitValues(row.related_ccns));
    matchedCcns = matchedCcns.filter(ccn => claimed.has(ccn));
  }
  matchedCcns = matchedCcns.join('|');
  if (!matchedCcns || !isPlausibleMrfUrl(row.mrf_url)) return null;
  const pointerUrl = preferredUrl(row.pointer_urls);
  const pointerHost = normalizeDomain(hostOf(pointerUrl));
  const domains = splitValues(row.pointer_domains).map(normalizeDomain).filter(Boolean);
  const matchingDomain = domains.find(domain => pointerHost === domain || pointerHost.endsWith(`.${domain}`));
  return {
    record_status: 'ok',
    mrf_url: row.mrf_url,
    matched_ccns: matchedCcns,
    pointer_url: pointerUrl,
    final_url: pointerUrl,
    pointer_host: matchingDomain || domains[0] || pointerHost,
    source_domains: domains.join('|'),
    source_datasets: [source, row.source_datasets].filter(Boolean).join('|'),
    location_name: splitValues(row.pointer_location_names).join('|'),
    source_page_url: preferredUrl(row.source_page_urls),
    fetch_via: 'header-evidence',
    fetched_at: row.checked_at || '',
    pointer_sha256: splitValues(row.pointer_sha256s).join('|'),
    _headerEvidence: row
  };
}

async function readHeaderEvidence(evidenceDir) {
  const candidates = [];
  const inputFiles = [];
  for (const spec of HEADER_EVIDENCE_FILES) {
    const file = path.join(evidenceDir, spec.name);
    if (!(await exists(file))) continue;
    const bytes = await fsp.readFile(file);
    const rows = csvToObjects(bytes.toString('utf8').replace(/^\uFEFF/, ''));
    for (const row of rows) {
      const candidate = headerEvidenceCandidate(row, spec.source, spec);
      if (candidate) candidates.push(candidate);
    }
    inputFiles.push({ file, sha256: sha256(bytes), rows: rows.length });
  }
  if (!inputFiles.length) {
    throw new Error(`No supported header-evidence CSVs found in ${evidenceDir}`);
  }
  return { candidates, inputFiles };
}

function emptyManifestRow() {
  return Object.fromEntries(MANIFEST_COLS.map(column => [column, '']));
}

function importedManifestRow(candidate, hospital) {
  const sources = splitValues(candidate.source_datasets);
  const isDirectMrf = sources.includes('direct-mrf-links') || sources.includes('direct-mrf-header-evidence');
  const domain = normalizeDomain(candidate.pointer_host || hostOf(candidate.pointer_url)
    || String(candidate.source_domains || '').split('|')[0] || hostOf(candidate.mrf_url));
  const corroboration = [
    isDirectMrf
      ? 'Exact CCN claim independently confirmed by MRF header identity and location'
      : 'exact MRF URL from pointer corpus matched_ccns',
    candidate.source_datasets ? `sources=${candidate.source_datasets}` : '',
    candidate.pointer_sha256 ? `pointer_sha256=${candidate.pointer_sha256}` : '',
    candidate.fetched_at ? `pointer_fetched_at=${candidate.fetched_at}` : ''
  ].filter(Boolean).join('; ');
  return {
    ...emptyManifestRow(),
    ccn: hospital.ccn,
    hospital_name: hospital.name,
    city: hospital.city,
    state: hospital.state,
    type: hospital.type,
    domain,
    pointer_url: isDirectMrf ? '' : candidate.pointer_url,
    pointer_via: isDirectMrf ? 'direct-mrf' : (candidate.fetch_via || 'pointer-corpus'),
    location_name: candidate.location_name || '',
    mrf_url: candidate.mrf_url,
    source_page_url: candidate.source_page_url || '',
    mrf_format: guessFormat(candidate.mrf_url),
    match_score: '1',
    match_method: isDirectMrf ? 'ccn+mrf-header' : 'exact-mrf-url-corpus',
    match_corroboration: corroboration
  };
}

function manifestDateRecord(row) {
  const status = row.mrf_http_status === '' ? undefined : Number(row.mrf_http_status);
  const bytes = row.mrf_bytes === '' ? null : Number(row.mrf_bytes);
  return {
    url: row.mrf_url,
    checkedAt: row.mrf_checked_at || '',
    httpStatus: Number.isFinite(status) ? status : undefined,
    httpLastModified: row.mrf_http_last_modified_diagnostic || null,
    bytes: Number.isFinite(bytes) ? bytes : null,
    contentType: row.mrf_content_type || null,
    fileKind: row.mrf_file_kind || null,
    declaredRaw: row.mrf_last_updated_raw || null,
    declaredLastUpdated: row.mrf_last_updated || null,
    dateSource: row.mrf_date_source || null,
    cmsVersion: row.mrf_cms_version || null,
    blocked: status === 403 || status === 429,
    ok: !!row.mrf_last_updated
  };
}

function seedDateCache(cache, baselineRows) {
  const out = { ...(cache || {}) };
  for (const row of baselineRows) {
    if (row.mrf_url && !Object.prototype.hasOwnProperty.call(out, row.mrf_url)) {
      out[row.mrf_url] = manifestDateRecord(row);
    }
  }
  return out;
}

function headerEvidenceDateRecord(candidate) {
  const row = candidate && candidate._headerEvidence;
  if (!row) return null;
  const httpStatus = Number(row.mrf_http_status);
  const rangeStatus = Number(row.mrf_range_status);
  const bytes = Number(row.mrf_bytes);
  const declaredLastUpdated = row.mrf_last_updated || null;
  const blockedStatus = Number.isFinite(rangeStatus) ? rangeStatus : httpStatus;
  return {
    url: candidate.mrf_url,
    checkedAt: row.checked_at || '',
    httpStatus: Number.isFinite(httpStatus) ? httpStatus : undefined,
    rangeStatus: Number.isFinite(rangeStatus) ? rangeStatus : undefined,
    httpLastModified: null,
    bytes: Number.isFinite(bytes) ? bytes : null,
    contentType: row.mrf_content_type || null,
    fileKind: row.mrf_file_kind || null,
    innerKind: row.mrf_inner_kind || null,
    declaredRaw: row.mrf_last_updated_raw || declaredLastUpdated,
    declaredLastUpdated,
    dateSource: row.mrf_date_source || (declaredLastUpdated ? 'file-metadata' : null),
    cmsVersion: row.mrf_cms_version || null,
    mrfLicenseState: row.mrf_license_state || null,
    mrfHospitalName: row.mrf_hospital_name || null,
    mrfLocationName: row.mrf_location_name || null,
    mrfAddress: row.mrf_address || null,
    blocked: blockedStatus === 403 || blockedStatus === 429,
    ok: !!declaredLastUpdated || (Number.isFinite(rangeStatus) && rangeStatus >= 200 && rangeStatus < 300),
    headError: row.head_error || null,
    rangeError: row.range_error || null
  };
}

function seedHeaderEvidenceDates(cache, imports) {
  let seeded = 0;
  for (const item of imports) {
    const incoming = headerEvidenceDateRecord(item.candidate);
    if (!incoming) continue;
    const prior = cache[incoming.url];
    const priorTime = Date.parse(prior && prior.checkedAt || '') || 0;
    const incomingTime = Date.parse(incoming.checkedAt || '') || 0;
    if (!prior || (!prior.declaredLastUpdated && incoming.declaredLastUpdated) || incomingTime > priorTime) {
      cache[incoming.url] = incoming;
      seeded++;
    }
  }
  return seeded;
}

function clearNewDateRecords(cache, imports, baselineRows) {
  const baselineUrls = new Set(baselineRows.map(row => row.mrf_url).filter(Boolean));
  let cleared = 0;
  for (const item of imports) {
    const url = item.candidate.mrf_url;
    if (!baselineUrls.has(url) && Object.prototype.hasOwnProperty.call(cache, url)) {
      delete cache[url];
      cleared++;
    }
  }
  return cleared;
}

function mergeDomains(domains, imports) {
  const out = { ...(domains || {}) };
  for (const item of imports) {
    const domain = normalizeDomain(item.manifest.domain);
    if (!domain) continue;
    const prior = out[domain] || { domain, ccns: [], source: 'pointer-corpus' };
    out[domain] = {
      ...prior,
      domain,
      ccns: [...new Set([...(prior.ccns || []).map(String), item.ccn])]
        .sort((a, b) => a.localeCompare(b))
    };
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

function countBy(rows, key) {
  const counts = {};
  for (const row of rows) counts[row[key]] = (counts[row[key]] || 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function findingFor(manifest, probe, type) {
  if (/Veterans Administration|Department of Defense/i.test(type || '')) {
    return { finding: 'not-applicable-federal', assessable: 'no', evidence: 'federally owned; outside 45 CFR 180' };
  }
  if (!manifest.mrf_url) {
    return {
      finding: 'pointer-lists-no-mrf-url', assessable: 'yes',
      evidence: `pointer file lists "${manifest.location_name}" but gives no mrf-url for it`
    };
  }
  const bodyReadable = !!manifest.mrf_last_updated
    || !!(probe && probe.rangeStatus >= 200 && probe.rangeStatus < 300);
  if (probe && probe.blocked && !bodyReadable) {
    return {
      finding: 'mrf-blocked-to-automation', assessable: 'yes',
      evidence: `MRF URL refused automated access (HTTP ${probe.httpStatus || manifest.mrf_http_status || ''})`
    };
  }
  const status = Number((probe && probe.httpStatus) || manifest.mrf_http_status || 0);
  if (status >= 400 && !bodyReadable) {
    return { finding: 'mrf-url-unreachable', assessable: 'yes', evidence: `MRF URL returned HTTP ${status}` };
  }
  if (manifest.mrf_stale_over_365 === 'yes') {
    return {
      finding: 'mrf-stale-over-365-days', assessable: 'yes',
      evidence: `last_updated_on ${manifest.mrf_last_updated} is ${manifest.mrf_days_since_update} days old; 45 CFR 180.50 requires annual updates`
    };
  }
  if (manifest.mrf_cms_version && !/^3\./.test(manifest.mrf_cms_version)) {
    return {
      finding: 'old-template-version', assessable: 'yes',
      evidence: `file declares CMS template version ${manifest.mrf_cms_version}`
    };
  }
  if (!manifest.mrf_last_updated) {
    return {
      finding: 'compliant-date-unverified', assessable: 'yes',
      evidence: `${manifest.pointer_url ? 'cms-hpt.txt and MRF found' : 'direct MRF found'}, but last_updated_on could not be read`
    };
  }
  return {
    finding: 'compliant-observed', assessable: 'yes',
    evidence: `${manifest.pointer_url ? 'cms-hpt.txt found; ' : ''}MRF last_updated_on ${manifest.mrf_last_updated}`
  };
}

function updateComplianceRow(existing, hospital, manifest, probe, imported) {
  const result = findingFor(manifest, probe, hospital.type);
  return {
    ccn: hospital.ccn,
    hospital_name: existing.hospital_name || hospital.name,
    city: existing.city || hospital.city,
    state: existing.state || hospital.state,
    type: existing.type || hospital.type,
    ...result,
    domain: manifest.domain || '',
    pointer_url: manifest.pointer_url || '',
    mrf_url: manifest.mrf_url || '',
    mrf_last_updated: manifest.mrf_last_updated || '',
    mrf_days_since_update: manifest.mrf_days_since_update || '',
    cms_template_version: manifest.mrf_cms_version || '',
    checked_at: manifest.mrf_checked_at || (probe && probe.checkedAt) || imported.fetched_at || ''
  };
}

function resolvePaths(options = {}) {
  const workDir = path.resolve(options.work || DEFAULT_WORK);
  const sourceDir = path.resolve(options.source || DEFAULT_SOURCE);
  const evidenceDir = options['evidence-dir'] ? path.resolve(options['evidence-dir']) : '';
  return {
    workDir,
    sourceDir,
    evidenceDir,
    corpusFile: evidenceDir ? '' : path.resolve(options.corpus || DEFAULT_CORPUS),
    rosterFile: path.resolve(options.roster || path.join(workDir, 'roster.json')),
    domainsFile: path.resolve(options.domains || path.join(workDir, 'domains.json')),
    reportFile: path.resolve(options.report || path.join(workDir, 'corpus_import.json')),
    dateFile: path.resolve(options.dates || path.join(workDir, 'mrf_dates.json')),
    workManifestCsv: path.join(workDir, 'manifest.csv'),
    workManifestJson: path.join(workDir, 'manifest.json')
  };
}

async function prepareImport(options = {}) {
  const files = resolvePaths(options);
  const sourceManifest = path.join(files.sourceDir, 'manifest.csv');
  const [input, baseline, roster, domains, priorDates] = await Promise.all([
    files.evidenceDir
      ? readHeaderEvidence(files.evidenceDir)
      : fsp.readFile(files.corpusFile).then(bytes => ({
          candidates: csvToObjects(bytes.toString('utf8').replace(/^\uFEFF/, '')),
          inputFiles: [{ file: files.corpusFile, sha256: sha256(bytes) }]
        })),
    readCsv(sourceManifest),
    readJson(files.rosterFile, []),
    readJson(files.domainsFile, {}),
    readJson(files.dateFile, {})
  ]);
  const corpus = input.candidates;
  const required = ['record_status', 'mrf_url', 'matched_ccns'];
  if (corpus.length && required.some(column => !(column in corpus[0]))) {
    throw new Error(`Corpus is missing required columns: ${required.filter(column => !(column in corpus[0])).join(', ')}`);
  }

  const rosterByCcn = new Map(roster.map(row => [String(row.ccn), row]));
  const existing = new Set(baseline.map(row => String(row.ccn)));
  const conflicts = [];
  const candidates = collectExactCandidates(corpus, { excludeCcns: existing, conflicts });
  const imports = [];
  for (const [ccn, candidate] of candidates) {
    if (existing.has(ccn)) continue;
    const hospital = rosterByCcn.get(ccn);
    if (!hospital) throw new Error(`Corpus matched CCN ${ccn}, which is absent from the tracker roster`);
    imports.push({ ccn, candidate, manifest: importedManifestRow(candidate, hospital) });
  }
  imports.sort((a, b) => a.ccn.localeCompare(b.ccn));

  const merged = [...baseline, ...imports.map(item => item.manifest)]
    .sort((a, b) => String(a.ccn).localeCompare(String(b.ccn))
      || normalizeUrl(a.mrf_url).localeCompare(normalizeUrl(b.mrf_url)));
  if (merged.length !== baseline.length + imports.length) throw new Error('Manifest row count reconciliation failed');

  const dates = seedDateCache(priorDates, baseline);
  const seededHeaderEvidenceDates = seedHeaderEvidenceDates(dates, imports);
  const resetNewDateRecords = options['retry-new'] ? clearNewDateRecords(dates, imports, baseline) : 0;
  const mergedDomains = mergeDomains(domains, imports);
  const report = {
    schemaVersion: 1,
    preparedAt: new Date().toISOString(),
    corpusFile: files.corpusFile || null,
    corpusSha256: files.corpusFile ? input.inputFiles[0].sha256 : null,
    evidenceDir: files.evidenceDir || null,
    inputFiles: input.inputFiles,
    sourceManifest: sourceManifest,
    baselineManifestRows: baseline.length,
    exactCandidateCcns: candidates.size,
    conflictingCcns: conflicts,
    importedCcns: imports.map(item => ({
      ccn: item.ccn,
      mrf_url: item.candidate.mrf_url,
      pointer_url: item.candidate.pointer_url,
      fetched_at: item.candidate.fetched_at || ''
    }))
  };

  await writeAtomic(files.workManifestCsv, toRFC4180(merged, MANIFEST_COLS));
  await writeAtomic(files.workManifestJson, JSON.stringify(merged, null, 1) + '\n');
  await writeAtomic(files.dateFile, JSON.stringify(dates, null, 1) + '\n');
  await writeAtomic(files.domainsFile, JSON.stringify(mergedDomains, null, 1) + '\n');
  await writeAtomic(files.reportFile, JSON.stringify(report, null, 1) + '\n');

  return {
    phase: 'prepared',
    corpusRows: corpus.length,
    baselineManifestRows: baseline.length,
    exactCandidateCcns: candidates.size,
    importedCcns: imports.length,
    workingManifestRows: merged.length,
    cachedExistingMrfUrls: Object.keys(dates).length,
    resetNewDateRecords,
    seededHeaderEvidenceDates,
    conflictingCcns: conflicts.length,
    newMrfUrlsToProbe: new Set(imports.map(item => item.candidate.mrf_url)
      .filter(url => !Object.prototype.hasOwnProperty.call(dates, url))).size,
    workManifest: files.workManifestCsv,
    importReport: files.reportFile
  };
}

async function publishImport(options = {}) {
  const files = resolvePaths(options);
  const report = await readJson(files.reportFile, null);
  if (!report || !Array.isArray(report.importedCcns)) throw new Error('No prepared corpus import report found');
  if (Array.isArray(report.inputFiles) && report.inputFiles.length) {
    for (const input of report.inputFiles) {
      const bytes = await fsp.readFile(input.file);
      if (sha256(bytes) !== input.sha256) throw new Error(`Import input changed after prepare: ${input.file}`);
    }
  } else {
    const corpusBytes = await fsp.readFile(files.corpusFile);
    if (sha256(corpusBytes) !== report.corpusSha256) throw new Error('Corpus changed after prepare; run prepare again');
  }

  const [manifest, compliance, gaps, roster, dates] = await Promise.all([
    readCsv(files.workManifestCsv),
    readCsv(path.join(files.sourceDir, 'compliance.csv')),
    readCsv(path.join(files.sourceDir, 'gaps.csv')),
    readJson(files.rosterFile, []),
    readJson(files.dateFile, {})
  ]);
  const imported = new Map(report.importedCcns.map(row => [String(row.ccn), row]));
  const rosterByCcn = new Map(roster.map(row => [String(row.ccn), row]));
  const manifestByCcn = new Map(manifest.map(row => [String(row.ccn), row]));

  let updated = 0;
  const nextCompliance = compliance.map(row => {
    const info = imported.get(String(row.ccn));
    const hospital = rosterByCcn.get(String(row.ccn));
    const manifestRow = manifestByCcn.get(String(row.ccn));
    if (!manifestRow) return row;
    if (!hospital) throw new Error(`Manifest CCN ${row.ccn} is missing from the roster`);
    updated++;
    return updateComplianceRow(row, hospital, manifestRow, dates[manifestRow.mrf_url], info || {});
  });
  const importedComplianceRows = nextCompliance.filter(row => imported.has(String(row.ccn))).length;
  if (importedComplianceRows !== imported.size) {
    throw new Error(`Compliance represents ${importedComplianceRows}/${imported.size} imported CCNs`);
  }
  const nextGaps = gaps.filter(row => !imported.has(String(row.ccn)));
  const expectedGaps = gaps.length - [...imported.keys()].filter(ccn => gaps.some(row => String(row.ccn) === ccn)).length;
  if (nextGaps.length !== expectedGaps) throw new Error('Gap row count reconciliation failed');

  const outputs = [
    [path.join(files.workDir, 'compliance.csv'), toRFC4180(nextCompliance, COMPLIANCE_COLS)],
    [path.join(files.workDir, 'gaps.csv'), toRFC4180(nextGaps, GAPS_COLS)],
    [path.join(files.sourceDir, 'manifest.csv'), toRFC4180(manifest, MANIFEST_COLS)],
    [path.join(files.sourceDir, 'compliance.csv'), toRFC4180(nextCompliance, COMPLIANCE_COLS)],
    [path.join(files.sourceDir, 'gaps.csv'), toRFC4180(nextGaps, GAPS_COLS)]
  ];
  for (const [file, contents] of outputs) await writeAtomic(file, contents);

  return {
    phase: 'published',
    importedCcns: imported.size,
    refreshedManifestComplianceRows: updated,
    manifestRows: manifest.length,
    complianceRows: nextCompliance.length,
    gapsBefore: gaps.length,
    gapsAfter: nextGaps.length,
    importedFindings: countBy(nextCompliance.filter(row => imported.has(String(row.ccn))), 'finding'),
    totalFindings: countBy(nextCompliance, 'finding'),
    sourceDir: files.sourceDir
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const summary = options.publish ? await publishImport(options) : await prepareImport(options);
  console.log(JSON.stringify(summary, null, 2));
}

if (require.main === module) {
  main().catch(error => {
    console.error(error && error.stack || error);
    process.exitCode = 1;
  });
}

module.exports = {
  MANIFEST_COLS, COMPLIANCE_COLS, GAPS_COLS,
  splitCcns, collectExactCandidates, headerEvidenceCandidate, headerEvidenceDateRecord,
  importedManifestRow, seedDateCache, seedHeaderEvidenceDates, clearNewDateRecords,
  mergeDomains, findingFor, updateComplianceRow,
  prepareImport, publishImport
};
