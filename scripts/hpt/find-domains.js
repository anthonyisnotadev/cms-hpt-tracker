#!/usr/bin/env node
'use strict';

/**
 * Free-first hospital-domain discovery with evidence-gated verification.
 *
 * Default input: data/hpt-audit/gaps.csv
 * Default output: data/hpt-audit/.domain-discovery/ (gitignored)
 *
 * The normal command is stage-only and never changes tracker data:
 *   npm run find:domains -- --sources=prior,pointers,wikidata,osm,heuristic
 *     --queue=missing,stale --sample=100 --sample-mode=stratified --seed=20260903
 *
 * A later, explicit promotion consumes a reviewed verified.csv:
 *   npm run find:domains -- --promote=data/hpt-audit/.domain-discovery/verified.csv
 *
 * To import only rows that do not require replacement approval:
 *   npm run find:domains -- --promote-safe=data/hpt-audit/.domain-discovery/verified.csv
 */

const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const DEFAULT_INPUT = path.join(ROOT, 'data', 'hpt-audit', 'gaps.csv');
const DEFAULT_STAGE = path.join(ROOT, 'data', 'hpt-audit', '.domain-discovery');
const ROSTER_FILE = path.join(ROOT, 'cms_data', 'hpt', 'roster.json');
const COORDS_FILE = path.join(ROOT, 'cms_data', 'hpt', 'coords.json');
const DOMAINS_FILE = path.join(ROOT, 'cms_data', 'hpt', 'domains.json');
const AUDIT_DIR = path.join(ROOT, 'data', 'hpt-audit');
const PUBLIC_POINTER_DIR = path.join(AUDIT_DIR, 'pointers');
const PRIOR_FILE = path.join(AUDIT_DIR, 'found_domains.csv');

try {
  const dotenv = require('dotenv');
  dotenv.config({ path: path.join(ROOT, '.env') });
  dotenv.config({ path: path.join(ROOT, '.env.local'), override: true });
} catch (_error) {}

const { toCSV, csvToObjects, pooled, nameSimilarity, strictSimilarity } = require('./lib/util');
const { heuristicCandidates, runLlmDomainDiscovery } = require('./lib/candidates');
const { activeSearchProvider, runSearchDiscovery } = require('./lib/search');
const { inspectPointerText } = require('./lib/pointer-obfuscation');
const { adjudicateCandidate } = require('./lib/adjudicate');
const { directGet, fetchPointer, quickPointer } = require('./lib/fetch');
const { probeMrf } = require('./lib/probe');
const { parsePointer } = require('./lib/parse');
const { toRFC4180 } = require('./pointer-corpus');
const { runInverseDiscovery } = require('./lib/inverse-discovery');
const {
  runNppesDiscovery, nppesCandidateRows, siblingDomainCandidates,
  contactDomainCandidates, runIrsDiscovery, loadCmsRelationshipFiles,
  cmsRelationshipCandidates
} = require('./lib/relationship-discovery');
const {
  MANIFEST_COLS, COMPLIANCE_COLS, GAPS_COLS, updateComplianceRow
} = require('./import-corpus');
const discovery = require('./lib/domain-discovery');
const {
  DEFAULT_SOURCES, SUPPORTED_SOURCES, CANDIDATE_COLUMNS, EVIDENCE_COLUMNS, VERIFIED_COLUMNS,
  MANUAL_COLUMNS, normalizeDomain, queueRows, stratifiedSample, parseOsmElements,
  parseWikidataBindings, candidatesFromExternal, candidateRow, limitCandidates,
  verifyDiscoveryCandidate, duplicateNameKeys, applyPromotionNotes,
  validatePromotionRows, hospitalStatuses, manualSearchRows, writeProtectedPointer,
  pointerArchiveCandidates, priorCandidates, heuristicCandidatesForJobs,
  staleCandidates, readCsvIfPresent, safeJson, guessFormat
} = discovery;

const APP_UA = 'cms-hpt-tracker/0.1 hospital website discovery (public research project)';
const WIKIDATA_ENDPOINT = 'https://query.wikidata.org/sparql';
const OVERPASS_ENDPOINT = process.env.HPT_OVERPASS_URL || 'https://overpass-api.de/api/interpreter';

const LLM_COLUMNS = [
  'ccn', 'hospital_name', 'address', 'city', 'state', 'zip', 'phone', 'type',
  'queue_kind', 'previous_domain', 'candidate_domain', 'sources',
  'source_record_urls', 'source_names', 'source_addresses', 'source_phones',
  'source_mrf_url',
  'source_lat', 'source_lon', 'distance_km', 'name_score', 'strict_name_score',
  'pointer_location_name', 'pointer_match_score', 'status', 'reason',
  'llm_match', 'llm_confidence', 'llm_reason', 'llm_recommendation',
  'deterministic_guardrail',
  'llm_model', 'prompt_tokens', 'completion_tokens', 'total_tokens', 'reviewed_at'
];

const ARCHIVE_COLUMNS = [
  'ccn', 'hospital_name', 'previous_domain', 'archived_pointer_url',
  'candidate_domain', 'pointer_location_names', 'source_page_urls',
  'archive_status', 'discovered_at'
];

const NPPES_ALIAS_COLUMNS = ['ccn', 'hospital_name', 'aliases', 'npi_count', 'candidate_count'];
const IRS_COLUMNS = [
  'ccn', 'year', 'batch_id', 'ein', 'taxpayer_name', 'object_id', 'name_score',
  'strict_name_score', 'website', 'organization_name', 'address', 'city',
  'state', 'zip', 'source_url', 'error'
];
const LLM_DOMAIN_COLUMNS = [
  'ccn', 'hospital_name', 'aliases', 'candidate_domain', 'confidence',
  'reason', 'model', 'checked_at', 'error'
];
const SEARCH_COLUMNS = [
  'ccn', 'hospital_name', 'provider', 'query', 'rank', 'candidate_domain',
  'result_url', 'result_title', 'checked_at', 'error'
];

function parseArgs(argv = process.argv.slice(2)) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const match = argv[i].match(/^--([^=]+)(?:=(.*))?$/);
    if (!match) continue;
    let value = match[2];
    if (value === undefined) {
      const next = argv[i + 1];
      value = next !== undefined && !next.startsWith('--') ? (i++, next) : true;
    }
    out[match[1]] = value;
  }
  return out;
}

function list(value, fallback = []) {
  if (value === undefined) return fallback;
  return String(value).split(',').map(item => item.trim().toLowerCase()).filter(Boolean);
}

function num(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function memoizedAsync(fn, keyFn) {
  const cache = new Map();
  return (...args) => {
    const key = keyFn(...args);
    if (!cache.has(key)) cache.set(key, Promise.resolve().then(() => fn(...args)));
    return cache.get(key);
  };
}

function sharedVerificationDependencies() {
  return {
    directGet: memoizedAsync(directGet, (url, options = {}) => `${url}|${options.timeoutMs || ''}|${options.maxBytes || ''}`),
    quickPointer: memoizedAsync(quickPointer, (domain, options = {}) => `${domain}|${options.timeoutMs || ''}|${options.maxBytes || ''}`),
    fetchPointer: memoizedAsync(fetchPointer, (domain, options = {}) => `${domain}|${options.timeoutMs || ''}|${options.maxBytes || ''}|${!!options.useUnblocker}`),
    probeMrf: memoizedAsync(probeMrf, (url, options = {}) => `${url}|${options.timeoutMs || ''}`)
  };
}

async function fileHash(file) {
  try { return sha256Buffer(await fsp.readFile(file)); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function baselineHashes() {
  const files = [DOMAINS_FILE, path.join(AUDIT_DIR, 'manifest.csv'),
    path.join(AUDIT_DIR, 'compliance.csv'), path.join(AUDIT_DIR, 'gaps.csv'),
    path.join(ROOT, 'tracker.html'), path.join(AUDIT_DIR, 'pointers.json')];
  return Object.fromEntries(await Promise.all(files.map(async file => [path.relative(ROOT, file), await fileHash(file)])));
}

async function readJson(file, fallback) {
  try { return JSON.parse((await fsp.readFile(file, 'utf8')).replace(/^\uFEFF/, '')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

async function writeAtomic(file, contents) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  await fsp.writeFile(temp, contents);
  await fsp.rename(temp, file);
}

async function cachedSource(file, options, fetcher) {
  if (!options.refresh) {
    const prior = await readJson(file, null);
    if (prior && Array.isArray(prior.rows)) return { ...prior, cacheHit: true };
  }
  if (options.offline) return { rows: [], error: 'offline-cache-miss', cacheHit: false };
  const fresh = await fetcher();
  // Empty and failed source responses are useful cache entries too. Persisting
  // them keeps offline resumes deterministic and avoids hammering an endpoint
  // that has no snapshot or is temporarily unreachable.
  if (Array.isArray(fresh.rows)) await writeAtomic(file, safeJson(fresh));
  return { ...fresh, cacheHit: false };
}

const WIKIDATA_QUERY = `SELECT ?h ?hLabel ?site ?coord ?stateCode WHERE {
  ?h wdt:P31/wdt:P279* wd:Q16917 ; wdt:P17 wd:Q30 ; wdt:P856 ?site .
  OPTIONAL { ?h wdt:P625 ?coord }
  OPTIONAL { ?h wdt:P131 ?place . ?place wdt:P300 ?stateCode }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
} LIMIT 20000`;

async function fetchWikidata() {
  let lastError = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180000);
    try {
      const url = `${WIKIDATA_ENDPOINT}?format=json&query=${encodeURIComponent(WIKIDATA_QUERY)}`;
      const response = await fetch(url, { signal: controller.signal,
        headers: { Accept: 'application/sparql-results+json', 'User-Agent': APP_UA } });
      if (!response.ok) throw new Error(`wikidata http ${response.status}`);
      return { fetched_at: new Date().toISOString(), rows: parseWikidataBindings(await response.json()) };
    } catch (error) {
      lastError = String((error && error.message) || error);
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 5000));
    } finally { clearTimeout(timer); }
  }
  return { fetched_at: new Date().toISOString(), rows: [], error: lastError };
}

function stateBounds(roster, coords, state) {
  const points = roster.filter(row => row.state === state).map(row => coords[row.ccn])
    .filter(value => Array.isArray(value) && value.length >= 2)
    .map(value => ({ lon: Number(value[0]), lat: Number(value[1]) }))
    .filter(value => Number.isFinite(value.lon) && Number.isFinite(value.lat));
  if (!points.length) return null;
  const margin = 0.35;
  return { south: Math.max(-90, Math.min(...points.map(point => point.lat)) - margin),
    west: Math.max(-180, Math.min(...points.map(point => point.lon)) - margin),
    north: Math.min(90, Math.max(...points.map(point => point.lat)) + margin),
    east: Math.min(180, Math.max(...points.map(point => point.lon)) + margin) };
}

function overpassQuery(bounds) {
  const bbox = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`;
  return `[out:json][timeout:120];(
    nwr["amenity"="hospital"]["website"](${bbox});
    nwr["amenity"="hospital"]["contact:website"](${bbox});
    nwr["healthcare"="hospital"]["website"](${bbox});
    nwr["healthcare"="hospital"]["contact:website"](${bbox});
  );out center tags;`;
}

async function fetchOsmState(state, bounds) {
  let lastError = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 150000);
    try {
      const response = await fetch(OVERPASS_ENDPOINT, { method: 'POST', signal: controller.signal,
        headers: { 'User-Agent': APP_UA, 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', Accept: 'application/json' },
        body: `data=${encodeURIComponent(overpassQuery(bounds))}` });
      if (response.status === 429 || response.status === 406) {
        lastError = `overpass http ${response.status}`;
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 30000));
        continue;
      }
      if (!response.ok) throw new Error(`overpass http ${response.status}`);
      return { state, fetched_at: new Date().toISOString(), rows: parseOsmElements(await response.json()) };
    } catch (error) {
      lastError = String((error && error.message) || error);
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 5000));
    } finally { clearTimeout(timer); }
  }
  return { state, fetched_at: new Date().toISOString(), rows: [], error: lastError };
}

async function collectOsm(states, roster, coords, cacheDir, options) {
  const rows = []; const errors = []; let cacheHits = 0;
  for (let index = 0; index < states.length; index++) {
    const state = states[index];
    console.log(`OpenStreetMap ${index + 1}/${states.length}: ${state}`);
    const bounds = stateBounds(roster, coords, state);
    if (!bounds) { errors.push(`${state}:no-coordinate-bounds`); continue; }
    const response = await cachedSource(path.join(cacheDir, 'osm', `${state}.json`), options,
      () => fetchOsmState(state, bounds));
    if (response.cacheHit) cacheHits++;
    if (response.error) errors.push(`${state}:${response.error}`);
    rows.push(...(response.rows || []));
  }
  const deduped = new Map();
  for (const row of rows) if (!deduped.has(row.source_record_url)) deduped.set(row.source_record_url, row);
  return { rows: [...deduped.values()], errors, cacheHits };
}

function rawArchiveUrl(url) {
  return String(url || '').replace(/\/web\/(\d+)(?:[a-z_]+)?\//i, '/web/$1id_/');
}

async function fetchArchiveLeads(job, timeoutMs) {
  const domain = job.previous_domain;
  const targets = [`https://${domain}/cms-hpt.txt`, `https://www.${domain}/cms-hpt.txt`,
    `https://${domain}/.well-known/cms-hpt.txt`];
  const rows = [];
  let lastError = '';
  for (const target of targets) {
    const api = `https://archive.org/wayback/available?url=${encodeURIComponent(target)}`;
    const availability = await directGet(api, { timeoutMs, maxBytes: 1048576 });
    if (!availability.body) {
      lastError = availability.error || `availability-http-${availability.status || 0}`;
      continue;
    }
    let snapshot;
    try { snapshot = JSON.parse(availability.body).archived_snapshots?.closest; }
    catch (_error) { lastError = 'availability-invalid-json'; continue; }
    if (!snapshot || !snapshot.available || Number(snapshot.status) !== 200 || !snapshot.url) continue;
    const archived = await directGet(rawArchiveUrl(snapshot.url), { timeoutMs, maxBytes: 4194304 });
    if (!archived.body) {
      lastError = archived.error || `archive-http-${archived.status || 0}`;
      continue;
    }
    let parsed;
    try { parsed = parsePointer(archived.body); }
    catch (_error) { parsed = { entries: [] }; }
    const entries = parsed.entries || [];
    const locationNames = [...new Set(entries.map(entry => entry.locationName).filter(Boolean))];
    const sourcePages = [...new Set(entries.map(entry => entry.sourcePageUrl).filter(Boolean))];
    const candidateDomains = new Set([domain]);
    for (const url of sourcePages) {
      const candidate = normalizeDomain(url);
      if (candidate && candidate !== 'web.archive.org') candidateDomains.add(candidate);
    }
    for (const candidateDomain of candidateDomains) rows.push({
      ccn: job.ccn,
      hospital_name: job.hospital_name,
      previous_domain: domain,
      archived_pointer_url: snapshot.url,
      candidate_domain: candidateDomain,
      pointer_location_names: locationNames.join('|'),
      source_page_urls: sourcePages.join('|'),
      archive_status: entries.length ? 'pointer-parsed' : 'snapshot-unparseable',
      discovered_at: new Date().toISOString()
    });
    if (rows.length) break;
  }
  return { rows, error: rows.length ? '' : lastError };
}

async function collectArchiveCandidates(jobs, cacheDir, options) {
  const selected = jobs.filter(job => job.queue_kind === 'stale' && job.previous_domain);
  const results = await pooled(selected, {
    concurrency: Number(options.concurrency || 3),
    keyFn: job => job.previous_domain,
    onProgress: (done, total) => {
      if (done === total || done % 20 === 0) console.log(`Archive recovery ${done}/${total}`);
    }
  }, async job => cachedSource(path.join(cacheDir, 'archive', `${job.previous_domain}.json`), {
    offline: !!options.offline, refresh: !!options.refresh
  }, () => fetchArchiveLeads(job, Number(options.timeoutMs || 30000))));
  const archiveRows = results.flatMap(result => result.rows || []);
  const jobsByCcn = new Map(jobs.map(job => [job.ccn, job]));
  const candidates = archiveRows.map(row => {
    const job = jobsByCcn.get(row.ccn);
    const sourceNames = row.pointer_location_names.split('|').filter(Boolean);
    const score = Math.max(0, ...sourceNames.map(name => nameSimilarity(job.hospital_name, name)));
    return candidateRow(job, row.candidate_domain, 'archive', {
      source_record_url: row.archived_pointer_url,
      source_name: row.pointer_location_names,
      name_score: Number(score.toFixed(3)),
      candidate_score: row.candidate_domain === row.previous_domain ? 35 : 60 + score * 20
    });
  });
  return {
    rows: archiveRows,
    candidates,
    errors: results.filter(result => result.error).map(result => result.error),
    cacheHits: results.filter(result => result.cacheHit).length
  };
}

function wikidataCandidates(jobs, sourceRows, coords) {
  const out = [];
  for (const job of jobs) for (const source of sourceRows) {
    const jobPos = discovery.coordinates(coords[job.ccn]);
    const sourcePos = Number.isFinite(source.lat) && Number.isFinite(source.lon) ? { lat: source.lat, lon: source.lon } : null;
    const distance = discovery.haversineKm(jobPos, sourcePos);
    const score = Math.max(0, ...(source.names || []).map(name => nameSimilarity(job.hospital_name, name)));
    if (score < 0.65 && !(distance !== null && distance <= 10 && score >= 0.35)) continue;
    out.push(...candidatesFromExternal([job], [source], coords));
  }
  return out;
}

function statusCounts(rows, key = 'status') {
  const out = {};
  for (const row of rows) out[row[key] || 'none'] = (out[row[key] || 'none'] || 0) + 1;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

function statusCountsBy(rows, key) {
  const out = {};
  for (const row of rows) {
    const group = row[key] || 'unknown';
    if (!out[group]) out[group] = {};
    const status = row.status || 'none';
    out[group][status] = (out[group][status] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b))
    .map(([group, counts]) => [group, Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)))]));
}

function evidenceStatusByQueueAndSource(rows) {
  const expanded = [];
  for (const row of rows) {
    for (const source of String(row.sources || 'none').split('|').filter(Boolean)) {
      expanded.push({ queue_kind: row.queue_kind, source, status: row.status });
    }
  }
  const out = {};
  for (const row of expanded) {
    const queue = row.queue_kind || 'unknown';
    if (!out[queue]) out[queue] = {};
    if (!out[queue][row.source]) out[queue][row.source] = {};
    out[queue][row.source][row.status] = (out[queue][row.source][row.status] || 0) + 1;
  }
  return out;
}

function normalizeCachedEvidence(row) {
  if (!row || row.reason !== 'cms-hpt-neterr') return row;
  const strongLead = String(row.sources || '').split('|').some(source => source && source !== 'heuristic');
  return { ...row, status: strongLead ? 'review' : 'none', reason: 'network-error',
    request_count: Number(row.request_count || 2), bytes_read: Number(row.bytes_read || 0) };
}

function llmReviewEligible(row) {
  if (!row.source_names && !row.pointer_location_name) return false;
  if (/mrf-license-state|mrf-conflict|hospital-published-mrf-unreachable/i.test(row.reason || '')) return false;
  return !!row.pointer_location_name || Number(row.name_score || 0) < 0.90;
}

function cleanModelText(value) {
  return String(value || '').replace(/[\u2013\u2014]/g, ',').replace(/\s+/g, ' ').trim();
}

function specialtyGuardrail(row) {
  const hospital = `${row.hospital_name || ''} ${row.type || ''}`.toLowerCase();
  const source = String(row.source_names || '').toLowerCase();
  if (!source) return '';
  const specialties = [
    { hospital: /child|pediatr/, source: /child|pediatr/ },
    { hospital: /psychi|mental|behav/, source: /psychi|mental|behav/ },
    { hospital: /rehab/, source: /rehab/ },
    { hospital: /surg/, source: /surg/ }
  ];
  return specialties.some(rule => rule.hospital.test(hospital) && !rule.source.test(source))
    ? 'specialty-needs-confirmation' : '';
}

function finalizeLlmResult(result, row) {
  const guardrail = specialtyGuardrail(row);
  const baseRecommendation = result.llm_reason && !result.llm_match ? 'error'
    : result.llm_match === 'yes' && result.llm_confidence === 'high' ? 'prioritize-verification'
      : result.llm_match === 'no' && result.llm_confidence === 'high' ? 'deprioritize'
        : 'manual-review';
  const recommendation = guardrail && baseRecommendation === 'prioritize-verification'
    ? 'manual-review' : baseRecommendation;
  return { ...result, llm_reason: cleanModelText(result.llm_reason),
    llm_recommendation: recommendation, deterministic_guardrail: guardrail };
}

async function runLlmReview(evidence, stageDir, options) {
  if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is required for --llm-review');
  const model = String(options.model || 'z-ai/glm-5.3-flash');
  let selected = evidence.filter(llmReviewEligible);
  const statuses = new Set(list(options['llm-status'], []).map(value => value.toLowerCase()));
  const reasons = new Set(list(options['llm-reason'], []).map(value => value.toLowerCase()));
  if (statuses.size) selected = selected.filter(row => statuses.has(String(row.status || '').toLowerCase()));
  if (reasons.size) selected = selected.filter(row => reasons.has(String(row.reason || '').toLowerCase()));
  if (options['llm-limit']) selected = selected.slice(0, num(options['llm-limit'], selected.length));
  const cacheFile = path.join(stageDir, 'llm-cache.json');
  const cache = await readJson(cacheFile, {});
  let requests = 0; let cacheHits = 0; let completed = 0;
  const rows = await pooled(selected, {
    concurrency: num(options['llm-concurrency'], 4),
    keyFn: row => row.candidate_domain,
    onProgress: (done, total) => { if (done === total || done % 10 === 0) console.log(`LLM name review ${done}/${total}`); }
  }, async row => {
    const identity = JSON.stringify([model, row.ccn, row.candidate_domain, row.source_names,
      row.source_addresses, row.source_phones, row.distance_km, row.pointer_location_name]);
    const key = sha256Buffer(Buffer.from(identity));
    let result = cache[key];
    if (result && !options['llm-refresh']
        && !(options['llm-retry-errors'] && result.llm_recommendation === 'error')) {
      cacheHits++;
      result = finalizeLlmResult(result, row);
      cache[key] = result;
      return result;
    }
    requests++;
    const verdict = await adjudicateCandidate({
      ccn: row.ccn, name: row.hospital_name, type: row.type, address: row.address,
      city: row.city, state: row.state, zip: row.zip, phone: row.phone
    }, row, { model, timeoutMs: num(options['llm-timeout'], 60000) });
    const recommendation = verdict && verdict.error ? 'error'
      : verdict && verdict.match && verdict.confidence === 'high' ? 'prioritize-verification'
        : verdict && !verdict.match && verdict.confidence === 'high' ? 'deprioritize'
          : 'manual-review';
    result = {
      ...Object.fromEntries(LLM_COLUMNS.map(column => [column, ''])), ...row,
      resolved_domain: undefined,
      llm_match: verdict && !verdict.error ? (verdict.match ? 'yes' : 'no') : '',
      llm_confidence: verdict && !verdict.error ? verdict.confidence : '',
      llm_reason: verdict && (verdict.error || verdict.reason) || '',
      llm_recommendation: recommendation,
      llm_model: verdict && verdict.model || model,
      prompt_tokens: Number(verdict && verdict.promptTokens || 0),
      completion_tokens: Number(verdict && verdict.completionTokens || 0),
      total_tokens: Number(verdict && verdict.totalTokens || 0),
      reviewed_at: new Date().toISOString()
    };
    result = finalizeLlmResult(result, row);
    cache[key] = result;
    if (++completed % 10 === 0) await writeAtomic(cacheFile, safeJson(cache));
    return result;
  });
  await writeAtomic(cacheFile, safeJson(cache));
  await Promise.all([
    writeAtomic(path.join(stageDir, 'llm_review.csv'), toCSV(rows, LLM_COLUMNS)),
    writeAtomic(path.join(stageDir, 'llm_priority.csv'), toCSV(rows.filter(row => row.llm_recommendation === 'prioritize-verification'), LLM_COLUMNS))
  ]);
  return {
    enabled: true, model, selected: selected.length, requests, cache_hits: cacheHits,
    status_filter: [...statuses], reason_filter: [...reasons],
    recommendations: statusCounts(rows, 'llm_recommendation'),
    confidence: statusCounts(rows, 'llm_confidence'),
    prompt_tokens: rows.reduce((sum, row) => sum + Number(row.prompt_tokens || 0), 0),
    completion_tokens: rows.reduce((sum, row) => sum + Number(row.completion_tokens || 0), 0),
    total_tokens: rows.reduce((sum, row) => sum + Number(row.total_tokens || 0), 0)
  };
}

function sourceCounts(rows) {
  const out = {};
  for (const row of rows) for (const source of String(row.sources || '').split('|').filter(Boolean)) out[source] = (out[source] || 0) + 1;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

const safeRelative = file => path.relative(ROOT, file).replace(/\\/g, '/');
const emptyManifest = () => Object.fromEntries(MANIFEST_COLS.map(column => [column, '']));

function manifestFromEvidence(row, hospital) {
  const updated = row.mrf_last_updated ? new Date(`${row.mrf_last_updated}T00:00:00Z`) : null;
  const days = updated && !Number.isNaN(updated.getTime()) ? Math.max(0, Math.floor((Date.now() - updated.getTime()) / 86400000)) : '';
  return { ...emptyManifest(), ccn: hospital.ccn, hospital_name: hospital.name,
    city: hospital.city, state: hospital.state, type: hospital.type,
    domain: row.resolved_domain, pointer_url: row.pointer_url,
    pointer_via: row.pointer_via || 'domain-discovery', location_name: row.pointer_location_name,
    mrf_url: row.mrf_url, source_page_url: row.source_page_url || '',
    extra_mrf_urls: row.extra_mrf_urls || '', mrf_format: guessFormat(row.mrf_url),
    match_score: row.pointer_match_score || '1', match_method: 'domain-discovery-verified',
    mrf_last_updated: row.mrf_last_updated || '', mrf_last_updated_raw: row.mrf_last_updated || '',
    mrf_date_source: row.mrf_last_updated ? 'file-metadata' : '', mrf_days_since_update: days,
    mrf_stale_over_365: days === '' ? '' : (days > 365 ? 'yes' : 'no'),
    mrf_cms_version: row.mrf_cms_version || '',
    match_corroboration: `hospital-site-pointer-and-mrf-header-agree; sources=${row.sources || ''}`,
    mrf_content_type: row.mrf_content_type || '', mrf_file_kind: row.mrf_file_kind || '',
    mrf_http_status: row.mrf_http_status || row.mrf_range_status || '', mrf_checked_at: row.checked_at || '' };
}

async function promote(file, { safeOnly = false } = {}) {
  const rows = readCsvIfPresent(path.resolve(file));
  if (!rows.length) throw new Error(`No reviewed rows found in ${file}`);
  const selected = safeOnly
    ? rows.filter(row => row.status === 'verified' && ['eligible', 'already-assigned'].includes(row.promotion_note))
    : rows;
  if (!selected.length) throw new Error(`No promotion-safe rows found in ${file}`);
  if (safeOnly && selected.length !== rows.length) console.log(`Skipped ${rows.length - selected.length} row(s) that require review or replacement approval.`);
  const accepted = validatePromotionRows(selected);
  const byCcn = new Map();
  for (const row of accepted) {
    if (!row.ccn || !normalizeDomain(row.resolved_domain) || !row.pointer_url || !row.mrf_url) throw new Error(`Promotion row for ${row.ccn || 'unknown CCN'} is missing verified evidence`);
    if (byCcn.has(row.ccn)) throw new Error(`Promotion file contains more than one accepted row for CCN ${row.ccn}`);
    byCcn.set(row.ccn, row);
  }
  const [roster, domains, manifest, compliance, gaps] = await Promise.all([
    readJson(ROSTER_FILE, []), readJson(DOMAINS_FILE, {}),
    fsp.readFile(path.join(AUDIT_DIR, 'manifest.csv'), 'utf8').then(csvToObjects),
    fsp.readFile(path.join(AUDIT_DIR, 'compliance.csv'), 'utf8').then(csvToObjects),
    fsp.readFile(path.join(AUDIT_DIR, 'gaps.csv'), 'utf8').then(csvToObjects)
  ]);
  const rosterByCcn = new Map(roster.map(row => [row.ccn, row]));
  const existingManifest = new Set(manifest.map(row => row.ccn));
  const additions = [];
  for (const row of accepted) {
    if (existingManifest.has(row.ccn)) throw new Error(`CCN ${row.ccn} is already present in manifest.csv`);
    const hospital = rosterByCcn.get(row.ccn);
    if (!hospital) throw new Error(`CCN ${row.ccn} is not in the current CMS roster`);
    const pointerFile = path.resolve(ROOT, row.pointer_file || '');
    const pointerText = await fsp.readFile(pointerFile, 'utf8');
    if (inspectPointerText(pointerText).plaintext) throw new Error(`Pointer for ${row.ccn} contains plaintext contact data`);
    additions.push({ row, hospital, manifest: manifestFromEvidence(row, hospital), pointerFile });
  }
  for (const item of additions) {
    const row = item.row;
    if (row.promotion_note === 'replacement-needs-approval') for (const [domain, meta] of Object.entries(domains)) {
      meta.ccns = (meta.ccns || []).filter(ccn => ccn !== row.ccn);
      if (!meta.ccns.length) delete domains[domain];
    }
    const domain = normalizeDomain(row.resolved_domain);
    if (!domains[domain]) domains[domain] = { domain, ccns: [], source: 'domain-discovery-verified' };
    if (!domains[domain].ccns.includes(row.ccn)) domains[domain].ccns.push(row.ccn);
    domains[domain].ccns.sort();
    await fsp.copyFile(item.pointerFile, path.join(PUBLIC_POINTER_DIR, `${domain.replace(/[^a-z0-9._-]/gi, '_')}.txt`));
  }
  const nextManifest = [...manifest, ...additions.map(item => item.manifest)]
    .sort((a, b) => a.ccn.localeCompare(b.ccn) || String(a.mrf_url).localeCompare(String(b.mrf_url)));
  const nextCompliance = compliance.map(existing => {
    const item = additions.find(entry => entry.row.ccn === existing.ccn);
    if (!item) return existing;
    const row = item.row;
    return updateComplianceRow(existing, item.hospital, item.manifest, {
      checkedAt: row.checked_at, httpStatus: Number(row.mrf_http_status || 0), rangeStatus: Number(row.mrf_range_status || 0),
      blocked: Number(row.mrf_http_status) === 403 || Number(row.mrf_http_status) === 429
    }, { fetched_at: row.checked_at });
  });
  if (nextCompliance.filter(row => byCcn.has(row.ccn)).length !== additions.length) throw new Error('Every promoted CCN must already have a compliance row');
  const nextGaps = gaps.filter(row => !byCcn.has(row.ccn));
  await Promise.all([
    writeAtomic(DOMAINS_FILE, safeJson(Object.fromEntries(Object.entries(domains).sort(([a], [b]) => a.localeCompare(b))))),
    writeAtomic(path.join(AUDIT_DIR, 'manifest.csv'), toRFC4180(nextManifest, MANIFEST_COLS)),
    writeAtomic(path.join(AUDIT_DIR, 'compliance.csv'), toRFC4180(nextCompliance, COMPLIANCE_COLS)),
    writeAtomic(path.join(AUDIT_DIR, 'gaps.csv'), toRFC4180(nextGaps, GAPS_COLS))
  ]);
  for (const script of ['export-pointers.js', 'build-tracker.js']) {
    const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts', script)], { cwd: ROOT, stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`${script} failed after promotion`);
  }
  console.log(`Promoted ${additions.length} reviewed hospital domain assignments.`);
}

async function main() {
  const opt = parseArgs();
  if (opt.help || opt.h) {
    console.log(fs.readFileSync(__filename, 'utf8').match(/\/\*\*([\s\S]*?)\*\//)[1].replace(/^\s*\* ?/gm, '').trim());
    return;
  }
  if (opt.promote && opt['promote-safe']) throw new Error('Use either --promote or --promote-safe, not both');
  if (opt.promote) return promote(opt.promote);
  if (opt['promote-safe']) return promote(opt['promote-safe'], { safeOnly: true });
  const startedAt = new Date().toISOString();
  const input = path.resolve(String(opt.input || DEFAULT_INPUT));
  const stageDir = path.resolve(String(opt['stage-dir'] || DEFAULT_STAGE));
  const cacheDir = path.join(stageDir, 'source-cache');
  const relationshipCacheDir = opt['relationship-cache']
    ? path.resolve(String(opt['relationship-cache'])) : cacheDir;
  const pointerDir = path.join(stageDir, 'pointers');
  const sources = list(opt.sources, DEFAULT_SOURCES);
  for (const source of sources) if (!SUPPORTED_SOURCES.includes(source)) throw new Error(`Unknown source: ${source}`);
  const queueKinds = list(opt.queue, ['missing', 'stale']);
  const before = await baselineHashes();
  const [gapText, roster, coords, domains] = await Promise.all([
    fsp.readFile(input, 'utf8'), readJson(ROSTER_FILE, []), readJson(COORDS_FILE, {}), readJson(DOMAINS_FILE, {})
  ]);
  let jobs = queueRows(csvToObjects(gapText.replace(/^\uFEFF/, '')), { kinds: queueKinds });
  const queueTotal = jobs.length;
  const candidateFile = opt['candidate-file'] ? path.resolve(String(opt['candidate-file'])) : '';
  const targetedCandidates = candidateFile ? readCsvIfPresent(candidateFile) : null;
  if (targetedCandidates) {
    if (!targetedCandidates.length) throw new Error(`Candidate file has no rows: ${candidateFile}`);
    const targetCcns = new Set(targetedCandidates.map(row => row.ccn).filter(Boolean));
    jobs = jobs.filter(row => targetCcns.has(row.ccn));
    const missing = [...targetCcns].filter(ccn => !jobs.some(row => row.ccn === ccn));
    if (missing.length) throw new Error(`Candidate CCNs are not in the current domain-discovery queue: ${missing.join(', ')}`);
  } else if (opt.limit) jobs = jobs.slice().sort((a, b) => a.ccn.localeCompare(b.ccn)).slice(0, num(opt.limit, jobs.length));
  else if (opt.sample) jobs = stratifiedSample(jobs, num(opt.sample, 100), String(opt.seed || '20260903'));
  const queueCounts = Object.fromEntries([...new Set(queueKinds)].map(kind => [kind, jobs.filter(row => row.queue_kind === kind).length]));
  console.log(`${queueTotal} current discovery gaps; selected ${jobs.length} (${Object.entries(queueCounts).map(([kind, count]) => `${count} ${kind}`).join(', ')}).`);
  await fsp.mkdir(stageDir, { recursive: true });

  const candidates = [];
  const sourceStats = {
    wikidata: {}, osm: {}, inverse: {}, archive: {}, cms_relations: {},
    nppes: {}, siblings: {}, contacts: {}, irs990: {}, llm_domain: {}, search: {}
  };
  const relationshipAliases = new Map();
  const mergeAliases = incoming => {
    for (const [ccn, names] of incoming || []) relationshipAliases.set(ccn,
      [...new Set([...(relationshipAliases.get(ccn) || []), ...(names || [])])]);
  };
  if (targetedCandidates) {
    const selectedCcns = new Set(jobs.map(row => row.ccn));
    candidates.push(...targetedCandidates
      .filter(row => selectedCcns.has(row.ccn) && normalizeDomain(row.candidate_domain))
      .map(row => Object.fromEntries(CANDIDATE_COLUMNS.map(column => [column, row[column] || '']))));
    if (!candidates.length) throw new Error('--candidate-file did not contain any usable domain rows');
    sourceStats.candidate_file = safeRelative(candidateFile);
    console.log(`Candidate collection: loaded ${candidates.length} reviewed rows from ${safeRelative(candidateFile)}.`);
  } else if (opt['reuse-candidates']) {
    const selectedCcns = new Set(jobs.map(row => row.ccn));
    candidates.push(...readCsvIfPresent(path.join(stageDir, 'candidates.csv')).filter(row => selectedCcns.has(row.ccn)));
    if (!candidates.length) throw new Error('--reuse-candidates requested, but candidates.csv has no rows for this selection');
    sourceStats.reused_candidates = candidates.length;
    console.log(`Candidate collection: reused ${candidates.length} staged rows.`);
  } else {
  if (sources.includes('prior')) {
    const found = priorCandidates(jobs, readCsvIfPresent(PRIOR_FILE)); candidates.push(...found);
    console.log(`Prior cache: ${found.length} current candidate assignments.`);
  }
  if (sources.includes('pointers')) {
    const found = pointerArchiveCandidates(jobs, PUBLIC_POINTER_DIR); candidates.push(...found);
    console.log(`Pointer archive: ${found.length} candidate assignments from ${fs.readdirSync(PUBLIC_POINTER_DIR).filter(file => file.endsWith('.txt')).length} files.`);
  }
  candidates.push(...staleCandidates(jobs));
  if (sources.includes('archive')) {
    console.log('Archive recovery: checking historical pointer locations for stale domains...');
    const result = await collectArchiveCandidates(jobs, cacheDir, {
      offline: !!opt.offline,
      refresh: !!opt['refresh-sources'],
      concurrency: num(opt['archive-concurrency'], 3),
      timeoutMs: num(opt['archive-timeout'], 30000)
    });
    candidates.push(...result.candidates);
    await writeAtomic(path.join(stageDir, 'archive_leads.csv'), toCSV(result.rows, ARCHIVE_COLUMNS));
    sourceStats.archive = {
      rows: result.rows.length, candidate_assignments: result.candidates.length,
      cache_hits: result.cacheHits, errors: result.errors.length
    };
    console.log(`Archive recovery: ${result.rows.length} leads, ${result.errors.length} errors.`);
  }
  if (sources.includes('inverse')) {
    console.log('Inverse pointer/MRF pass: probing unrepresented pointer entries...');
    const inverse = await runInverseDiscovery({
      jobs,
      pointerDir: PUBLIC_POINTER_DIR,
      manifestRows: readCsvIfPresent(path.join(AUDIT_DIR, 'manifest.csv')),
      stageDir,
      cacheFile: opt['inverse-cache'] ? path.resolve(String(opt['inverse-cache'])) : '',
      limit: opt['inverse-limit'] ? num(opt['inverse-limit'], 0) : 0,
      concurrency: num(opt['inverse-concurrency'], 16),
      timeoutMs: num(opt['probe-timeout'], 45000),
      refresh: !!opt['inverse-refresh'],
      log: console.log
    });
    const found = inverse.leads.map(lead => candidateRow(lead.job, lead.domain, 'inverse', lead.evidence));
    candidates.push(...found);
    sourceStats.inverse = {
      mrf_tasks: inverse.tasks, total_mrf_tasks: inverse.totalTasks,
      requests: inverse.requests, cache_hits: inverse.cacheHits, candidate_assignments: found.length
    };
    console.log(`Inverse pointer/MRF pass: ${inverse.tasks} headers, ${found.length} candidate assignments.`);
  }
  if (sources.includes('cms-relations')) {
    console.log('CMS relationships: loading enrollment, ownership, and change-of-ownership records...');
    const files = await loadCmsRelationshipFiles(path.join(relationshipCacheDir, 'cms-relations'), {
      enrollmentsFile: opt['cms-enrollments'], ownersFile: opt['cms-owners'], chowFile: opt['cms-chow'],
      enrollmentsUrl: opt['cms-enrollments-url'], ownersUrl: opt['cms-owners-url'], chowUrl: opt['cms-chow-url'],
      timeoutMs: num(opt['source-timeout'], 30000), downloadTimeoutMs: num(opt['download-timeout'], 240000)
    });
    const related = cmsRelationshipCandidates(jobs, files, domains, roster);
    candidates.push(...related.candidates);
    mergeAliases(related.aliases);
    sourceStats.cms_relations = Object.fromEntries(Object.entries(files).map(([kind, value]) => [kind, {
      rows: value.rows.length, source: value.url || safeRelative(value.file), error: value.error
    }]));
    await writeAtomic(path.join(stageDir, 'cms_relationship_sources.json'), safeJson(sourceStats.cms_relations));
    console.log(`CMS relationships: ${related.candidates.length} candidate assignments.`);
  }
  if (sources.includes('nppes')) {
    console.log('NPPES: loading organization aliases, locations, and public endpoints...');
    const nppes = await runNppesDiscovery({
      jobs, cacheFile: path.join(relationshipCacheDir, 'nppes.json'),
      concurrency: num(opt['nppes-concurrency'], 4), timeoutMs: num(opt['nppes-timeout'], 30000),
      refresh: !!opt['refresh-sources']
    });
    const related = nppesCandidateRows(jobs, nppes.results, domains, roster, {
      includeHeuristics: !!opt['nppes-heuristics']
    });
    candidates.push(...related.candidates);
    mergeAliases(related.aliases);
    const jobByCcn = new Map(jobs.map(job => [job.ccn, job]));
    const aliasRows = [...related.aliases].map(([ccn, aliases]) => ({
      ccn, hospital_name: jobByCcn.get(ccn)?.hospital_name || '', aliases: aliases.join('|'),
      npi_count: (nppes.results.find(row => row.ccn === ccn)?.rows || []).length,
      candidate_count: related.candidates.filter(row => row.ccn === ccn).length
    }));
    await writeAtomic(path.join(stageDir, 'nppes_aliases.csv'), toCSV(aliasRows, NPPES_ALIAS_COLUMNS));
    sourceStats.nppes = {
      requests: nppes.requests, cache_hits: nppes.cacheHits,
      matched_hospitals: related.aliases.size, candidate_assignments: related.candidates.length
    };
    console.log(`NPPES: ${related.aliases.size} hospitals with matched aliases, ${related.candidates.length} candidate assignments.`);
  }
  if (sources.includes('siblings')) {
    const found = siblingDomainCandidates(jobs, domains, roster);
    candidates.push(...found);
    sourceStats.siblings = { candidate_assignments: found.length };
    console.log(`Resolved sibling domains: ${found.length} candidate assignments.`);
  }
  if (sources.includes('contacts')) {
    const found = contactDomainCandidates(jobs, PUBLIC_POINTER_DIR);
    candidates.push(...found.candidates);
    sourceStats.contacts = {
      files: found.files, contact_domains_examined: found.contactDomains,
      candidate_assignments: found.candidates.length, error: found.error
    };
    console.log(`Protected contact domains: ${found.candidates.length} candidate assignments; no contact values persisted.`);
  }
  if (sources.includes('irs990')) {
    console.log('IRS Form 990: scanning current nonprofit filing indexes...');
    const irs = await runIrsDiscovery({
      jobs, aliases: relationshipAliases, cacheDir: path.join(relationshipCacheDir, 'irs990'),
      concurrency: num(opt['irs-concurrency'], 6), timeoutMs: num(opt['irs-timeout'], 60000),
      indexTimeoutMs: num(opt['download-timeout'], 240000),
      years: opt['irs-years'] ? list(opt['irs-years']).map(Number).filter(Number.isFinite) : undefined,
      maxFilings: num(opt['irs-max-filings'], 500)
    });
    candidates.push(...irs.candidates);
    await writeAtomic(path.join(stageDir, 'irs990_leads.csv'), toCSV(irs.rows, IRS_COLUMNS));
    sourceStats.irs990 = {
      indexes: irs.indexes.map(row => ({ year: row.year, cache_hit: !!row.cacheHit, error: row.error || '' })),
      selected_filings: irs.selected, requests: irs.requests, cache_hits: irs.cacheHits,
      candidate_assignments: irs.candidates.length
    };
    console.log(`IRS Form 990: ${irs.selected} filings checked, ${irs.candidates.length} candidate assignments.`);
  }
  if (sources.includes('llm-domain')) {
    if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is required for source llm-domain');
    const model = String(opt.model || 'z-ai/glm-5.3-flash');
    console.log(`GLM domain discovery: generating official-site leads with ${model}...`);
    const result = await runLlmDomainDiscovery({
      hospitals: jobs, aliases: relationshipAliases,
      cacheFile: path.join(relationshipCacheDir, 'llm-domains.json'),
      batchSize: num(opt['llm-batch-size'], 8),
      concurrency: num(opt['llm-concurrency'], 2),
      timeoutMs: num(opt['llm-timeout'], 90000), model,
      refresh: !!opt['llm-refresh'], retryErrors: !opt['llm-skip-errors']
    });
    const jobByCcn = new Map(jobs.map(job => [job.ccn, job]));
    const leadRows = [];
    let assignments = 0;
    for (const row of result.rows) {
      const job = jobByCcn.get(row.ccn);
      if (!job) continue;
      if (!(row.domains || []).length) leadRows.push({
        ccn: row.ccn, hospital_name: job.hospital_name,
        aliases: (relationshipAliases.get(row.ccn) || []).join('|'),
        candidate_domain: '', confidence: '', reason: '', model: row.model || model,
        checked_at: row.checked_at || '', error: row.error || ''
      });
      for (const suggestion of row.domains || []) {
        leadRows.push({
          ccn: row.ccn, hospital_name: job.hospital_name,
          aliases: (relationshipAliases.get(row.ccn) || []).join('|'),
          candidate_domain: suggestion.domain, confidence: suggestion.confidence,
          reason: suggestion.reason, model: row.model || model,
          checked_at: row.checked_at || '', error: row.error || ''
        });
        candidates.push(candidateRow(job, suggestion.domain, 'llm-domain', {
          source_record_url: `openrouter:${row.model || model}`,
          source_name: (relationshipAliases.get(row.ccn) || []).join('|'),
          candidate_score: suggestion.confidence === 'high' ? 55
            : suggestion.confidence === 'medium' ? 40 : 22
        }));
        assignments++;
      }
    }
    await writeAtomic(path.join(stageDir, 'llm_domain_leads.csv'), toCSV(leadRows, LLM_DOMAIN_COLUMNS));
    sourceStats.llm_domain = { model, requests: result.requests,
      cache_hits: result.cacheHits, candidate_assignments: assignments };
    console.log(`GLM domain discovery: ${assignments} candidate assignments from ${result.requests} requests.`);
  }
  if (sources.includes('search')) {
    const provider = activeSearchProvider();
    if (!provider) throw new Error('Search source requires HPT_SEARCH and its credentials');
    console.log(`${provider.name}: searching selected hospitals once and caching all returned domain leads...`);
    const result = await runSearchDiscovery({
      jobs, provider, cacheFile: path.join(relationshipCacheDir, `search-${provider.name}.json`),
      maxQueries: num(opt['search-limit'], jobs.length),
      concurrency: num(opt['search-concurrency'], 5),
      timeoutMs: num(opt['search-timeout'], 20000),
      num: num(opt['search-results'], 6),
      refresh: !!opt['search-refresh'], retryErrors: !!opt['search-retry-errors']
    });
    const keep = Math.max(1, num(opt['search-candidates'], 1));
    const jobByCcn = new Map(jobs.map(job => [job.ccn, job]));
    const leadRows = [];
    let assignments = 0;
    for (const row of result.rows) {
      const job = jobByCcn.get(row.ccn);
      if (!job) continue;
      if (!(row.candidates || []).length) leadRows.push({
        ccn: row.ccn, hospital_name: job.hospital_name, provider: row.provider,
        query: row.query, rank: '', candidate_domain: '', result_url: '', result_title: '',
        checked_at: row.checked_at || '', error: row.error || ''
      });
      for (const [index, suggestion] of (row.candidates || []).entries()) {
        leadRows.push({
          ccn: row.ccn, hospital_name: job.hospital_name, provider: row.provider,
          query: row.query, rank: index + 1, candidate_domain: suggestion.domain,
          result_url: suggestion.url, result_title: suggestion.title,
          checked_at: row.checked_at || '', error: row.error || ''
        });
        if (index >= keep) continue;
        candidates.push(candidateRow(job, suggestion.domain, provider.name, {
          source_record_url: suggestion.url, source_name: suggestion.title,
          candidate_score: 68 - index * 8
        }));
        assignments++;
      }
    }
    await writeAtomic(path.join(stageDir, 'search_leads.csv'), toCSV(leadRows, SEARCH_COLUMNS));
    sourceStats.search = { provider: provider.name, requests: result.requests,
      cache_hits: result.cacheHits, returned_domain_leads: leadRows.filter(row => row.candidate_domain).length,
      candidate_assignments: assignments };
    console.log(`${provider.name}: ${assignments} candidate assignments from ${result.requests} search requests.`);
  }
  if (sources.includes('wikidata')) {
    console.log('Wikidata: loading one bulk official-site dataset...');
    const result = await cachedSource(path.join(cacheDir, 'wikidata.json'), { offline: !!opt.offline, refresh: !!opt['refresh-sources'] }, fetchWikidata);
    sourceStats.wikidata = { rows: result.rows.length, cache_hit: !!result.cacheHit, error: result.error || '' };
    const found = wikidataCandidates(jobs, result.rows, coords); candidates.push(...found);
    console.log(`Wikidata: ${result.rows.length} source rows, ${found.length} candidate assignments.`);
  }
  if (sources.includes('osm')) {
    const states = [...new Set(jobs.map(row => row.state).filter(Boolean))].sort();
    const result = await collectOsm(states, roster, coords, cacheDir, { offline: !!opt.offline, refresh: !!opt['refresh-sources'] });
    sourceStats.osm = { rows: result.rows.length, cache_hits: result.cacheHits, errors: result.errors };
    const found = candidatesFromExternal(jobs, result.rows, coords); candidates.push(...found);
    console.log(`OpenStreetMap: ${result.rows.length} source rows, ${found.length} candidate assignments, ${result.errors.length} errors.`);
  }
  if (sources.includes('heuristic')) {
    const found = heuristicCandidatesForJobs(jobs, heuristicCandidates); candidates.push(...found);
    console.log(`Heuristics: ${found.length} raw candidate assignments.`);
  }
  }
  const limited = limitCandidates(candidates, num(opt['max-candidates'], 8));
  await writeAtomic(path.join(stageDir, 'candidates.csv'), toCSV(limited, CANDIDATE_COLUMNS));
  console.log(`Candidate pool: ${limited.length} unique CCN/domain pairs.`);

  const cacheFile = path.join(stageDir, 'cache.json');
  const rawCache = await readJson(cacheFile, {});
  const cache = Object.fromEntries(Object.entries(rawCache).map(([key, row]) => [key, normalizeCachedEvidence(row)]));
  const retryStatuses = new Set(list(opt['retry-status'], []));
  const retryReasons = new Set(list(opt['retry-reason'], []));
  const duplicates = duplicateNameKeys(roster);
  const sharedVerifier = sharedVerificationDependencies();
  let networkChecks = 0; let cacheHits = 0; let completed = 0;
  const evidence = await pooled(limited, { concurrency: num(opt.concurrency, 8), keyFn: row => row.candidate_domain,
    onProgress: (done, total) => { if (done === total || done % 25 === 0) console.log(`Verification ${done}/${total}`); } }, async candidate => {
    const key = `${candidate.ccn}|${candidate.candidate_domain}`;
    let row = cache[key];
    if (row && !retryStatuses.has(row.status) && !retryReasons.has(String(row.reason || '').toLowerCase())) { cacheHits++; return row; }
    if (opt.offline) return { ...candidate, status: 'none', reason: 'offline-cache-miss', resolved_domain: '', checked_at: new Date().toISOString() };
    networkChecks++;
    try {
      row = await verifyDiscoveryCandidate(candidate, { timeoutMs: num(opt.timeout, 15000),
        probeTimeoutMs: num(opt['probe-timeout'], 45000), duplicateNames: duplicates,
        trustedDomain: ['name', 'blocked', 'stale'].includes(candidate.queue_kind),
        llmNameMatch: !!opt['llm-name-match'], llmModel: String(opt.model || 'z-ai/glm-5.3-flash'),
        llmTimeoutMs: num(opt['llm-timeout'], 60000) }, sharedVerifier);
      const pointerFile = await writeProtectedPointer(row, pointerDir);
      if (pointerFile) row.pointer_file = safeRelative(pointerFile);
      delete row._pointerBody;
    } catch (error) {
      row = { ...candidate, status: 'rejected', reason: `verification-error:${String(error.message || error).slice(0, 180)}`, resolved_domain: '', checked_at: new Date().toISOString() };
    }
    cache[key] = row;
    if (++completed % 20 === 0) await writeAtomic(cacheFile, safeJson(cache));
    return row;
  });
  await writeAtomic(cacheFile, safeJson(cache));
  const presentCcns = new Set(evidence.map(row => row.ccn));
  for (const job of jobs) if (!presentCcns.has(job.ccn)) evidence.push({ ...candidateRow(job, '', '', {}), status: 'none', reason: 'no-candidate-domain', resolved_domain: '', checked_at: new Date().toISOString() });
  evidence.sort((a, b) => a.ccn.localeCompare(b.ccn) || a.candidate_domain.localeCompare(b.candidate_domain));
  const llmReview = opt['llm-review']
    ? await runLlmReview(evidence, stageDir, opt)
    : { enabled: false };
  const verified = applyPromotionNotes(evidence, domains);
  const review = evidence.filter(row => row.status !== 'verified' || row.promotion_note !== 'eligible');
  const statuses = hospitalStatuses(jobs, evidence);
  const manual = manualSearchRows(jobs, statuses);
  await Promise.all([
    writeAtomic(path.join(stageDir, 'evidence.csv'), toCSV(evidence, EVIDENCE_COLUMNS)),
    writeAtomic(path.join(stageDir, 'verified.csv'), toCSV(verified, VERIFIED_COLUMNS)),
    writeAtomic(path.join(stageDir, 'review.csv'), toCSV(review, EVIDENCE_COLUMNS)),
    writeAtomic(path.join(stageDir, 'manual_search.csv'), toCSV(manual, MANUAL_COLUMNS))
  ]);
  const after = await baselineHashes();
  const canonicalUnchanged = JSON.stringify(before) === JSON.stringify(after);
  if (!canonicalUnchanged) throw new Error('Stage-only invariant failed: canonical tracker files changed during discovery');
  const hospitalRows = [...statuses].map(([ccn, status]) => ({ ccn, status }));
  const report = { schema_version: 1, started_at: startedAt, completed_at: new Date().toISOString(),
    input: safeRelative(input), input_sha256: sha256Buffer(Buffer.from(gapText)),
    options: { sources, queue: queueKinds, sample: opt.sample ? num(opt.sample, 100) : null,
      sample_mode: opt['sample-mode'] || (opt.sample ? 'stratified' : null), seed: String(opt.seed || '20260903'),
      max_candidates: num(opt['max-candidates'], 8), concurrency: num(opt.concurrency, 8), offline: !!opt.offline,
      reuse_candidates: !!opt['reuse-candidates'], candidate_file: candidateFile ? safeRelative(candidateFile) : '',
      llm_name_match: !!opt['llm-name-match'], llm_name_model: opt['llm-name-match'] ? String(opt.model || 'z-ai/glm-5.3-flash') : '',
      retry_status: [...retryStatuses], retry_reason: [...retryReasons] },
    queue_total: queueTotal, selected: jobs.length, selected_by_queue: queueCounts,
    candidates: limited.length, candidates_by_source: sourceCounts(limited), source_stats: sourceStats,
    network_candidate_checks: networkChecks, verification_cache_hits: cacheHits, evidence_rows: evidence.length,
    evidence_status_counts: statusCounts(evidence), evidence_status_by_queue: statusCountsBy(evidence, 'queue_kind'),
    evidence_status_by_queue_and_source: evidenceStatusByQueueAndSource(evidence),
    hospital_status_counts: statusCounts(hospitalRows),
    hospital_status_by_queue: statusCountsBy(jobs.map(job => ({ ...job, status: statuses.get(job.ccn) })), 'queue_kind'),
    request_count: evidence.reduce((sum, row) => sum + Number(row.request_count || 0), 0),
    bytes_read: evidence.reduce((sum, row) => sum + Number(row.bytes_read || 0), 0),
    metrics_rows: evidence.filter(row => row.request_count !== undefined && row.request_count !== '').length,
    llm_review: llmReview,
    verified_rows: verified.length, manual_search_rows: manual.length, canonical_unchanged: canonicalUnchanged,
    baseline_hashes: before, final_hashes: after };
  await writeAtomic(path.join(stageDir, 'run.json'), safeJson(report));
  console.log(JSON.stringify(report, null, 2));
  console.log(`Staged artifacts: ${safeRelative(stageDir)}`);
  console.log('Nothing was promoted. Review verified.csv and use --promote=FILE only after approval.');
}

main().catch(error => { console.error(`\nERROR: ${error && error.stack || error}`); process.exitCode = 1; });
