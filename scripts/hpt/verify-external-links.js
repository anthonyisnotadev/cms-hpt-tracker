#!/usr/bin/env node
'use strict';

/**
 * Turn a third-party link export into independently verified hospital domains.
 *
 * The input is used only as a lead source. The durable outputs contain facts
 * fetched from the hospital: its homepage, cms-hpt.txt, the pointer entry, and
 * identifying fields from the MRF header. No third-party counts, labels, or
 * other metadata are copied into the tracker.
 *
 *   node scripts/hpt/verify-external-links.js --input="C:\\path\\export.csv"
 *   node scripts/hpt/verify-external-links.js --input="..." --limit=25
 *   node scripts/hpt/verify-external-links.js --input="..." --promote
 *
 * Outputs under cms_data/hpt:
 *   external_link_candidates.csv       disposable lead worklist (gitignored)
 *   external_link_unmapped.csv          rows not safely tied to the CMS roster
 *   external_link_checks.json           resumable direct-check cache (gitignored)
 *   external_link_evidence.csv          independently fetched evidence
 *   external_link_review.csv            evidence that needs human review
 *   external_link_verified_domains.csv  gaps-import-compatible verified rows
 *
 * By default, hospitals already present in manifest.json are skipped. Use
 * --include-known to audit them too. --promote adds only unconflicted verified
 * domains to domains.json; it never replaces an existing domain assignment.
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'cms_data', 'hpt');
const FILES = {
  roster: path.join(OUT, 'roster.json'),
  manifest: path.join(OUT, 'manifest.json'),
  domains: path.join(OUT, 'domains.json'),
  candidates: path.join(OUT, 'external_link_candidates.csv'),
  unmapped: path.join(OUT, 'external_link_unmapped.csv'),
  cache: path.join(OUT, 'external_link_checks.json'),
  evidence: path.join(OUT, 'external_link_evidence.csv'),
  review: path.join(OUT, 'external_link_review.csv'),
  verified: path.join(OUT, 'external_link_verified_domains.csv')
};

const {
  csvToObjects, toCSV, hostOf, isAggregator, normalizeName,
  nameSimilarity, strictSimilarity, JsonStore, pooled
} = require('./lib/util');
const { directGet, fetchPointer } = require('./lib/fetch');
const { parsePointer, isPlausibleMrfUrl } = require('./lib/parse');
const { probeMrf } = require('./lib/probe');

const log = (...m) => console.log(...m);
const num = (v, d) => v === undefined ? d : Number(v);

const NAME_KEYS = new Set([
  'hospitalname', 'hospital', 'facilityname', 'providername', 'locationname',
  'organizationname', 'organisationname'
]);
const STATE_KEYS = new Set([
  'state', 'hospitalstate', 'facilitystate', 'providerstate', 'locationstate'
]);
const CCN_KEYS = new Set([
  'ccn', 'facilityid', 'providerid', 'cmscertificationnumber',
  'cmscertificationnum', 'cmsproviderid'
]);
const URL_KEY_PRIORITY = new Map([
  ['hospitalurl', 0], ['hospitalwebsite', 0], ['officialwebsite', 0],
  ['website', 1], ['homepage', 1], ['domain', 1],
  ['sourcepageurl', 2], ['standardchargespage', 2],
  ['pricetransparencyurl', 2], ['pricingurl', 2],
  ['mrfurl', 3], ['machinereadableurl', 3],
  ['machinereadablefileurl', 3], ['fileurl', 3], ['downloadurl', 3],
  ['url', 4], ['link', 4]
]);

// These sites may supply leads, but they are not hospital domains and are never
// persisted as resolved domains. Subdomains are covered by the suffix check.
const LEAD_SOURCE_HOSTS = [
  'hospitalpricingfiles.org', 'payerset.com',
  'patientrightsadvocate.org', 'powertothepatients.org'
];

const STATE_NAMES = Object.fromEntries(Object.entries({
  AL: 'alabama', AK: 'alaska', AZ: 'arizona', AR: 'arkansas', CA: 'california',
  CO: 'colorado', CT: 'connecticut', DE: 'delaware', DC: 'district of columbia',
  FL: 'florida', GA: 'georgia', HI: 'hawaii', ID: 'idaho', IL: 'illinois',
  IN: 'indiana', IA: 'iowa', KS: 'kansas', KY: 'kentucky', LA: 'louisiana',
  ME: 'maine', MD: 'maryland', MA: 'massachusetts', MI: 'michigan', MN: 'minnesota',
  MS: 'mississippi', MO: 'missouri', MT: 'montana', NE: 'nebraska', NV: 'nevada',
  NH: 'new hampshire', NJ: 'new jersey', NM: 'new mexico', NY: 'new york',
  NC: 'north carolina', ND: 'north dakota', OH: 'ohio', OK: 'oklahoma',
  OR: 'oregon', PA: 'pennsylvania', RI: 'rhode island', SC: 'south carolina',
  SD: 'south dakota', TN: 'tennessee', TX: 'texas', UT: 'utah', VT: 'vermont',
  VA: 'virginia', WA: 'washington', WV: 'west virginia', WI: 'wisconsin',
  WY: 'wyoming', PR: 'puerto rico', GU: 'guam', VI: 'virgin islands',
  AS: 'american samoa', MP: 'northern mariana islands'
}).flatMap(([abbr, name]) => [[name, abbr], [abbr.toLowerCase(), abbr]]));

function parseArgs(argv = process.argv.slice(2)) {
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const m = argv[i].match(/^--([^=]+)(?:=(.*))?$/);
    if (!m) continue;
    let value = m[2];
    if (value === undefined) {
      const next = argv[i + 1];
      value = next !== undefined && !next.startsWith('--') ? (i++, next) : true;
    }
    opt[m[1]] = value;
  }
  return opt;
}

function canonicalKey(value) {
  return String(value || '').replace(/^\uFEFF/, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function field(row, aliases, override) {
  if (override && Object.prototype.hasOwnProperty.call(row, override)) return row[override];
  for (const [key, value] of Object.entries(row || {})) {
    if (aliases.has(canonicalKey(key)) && String(value || '').trim()) return value;
  }
  return '';
}

function normalizeCcn(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits || digits.length > 6) return '';
  return digits.padStart(6, '0');
}

function normalizeState(value) {
  const key = String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return STATE_NAMES[key] || '';
}

function cleanUrl(value) {
  const raw = String(value || '').trim().replace(/^["'(<\[]+/, '').replace(/["')>\],.;]+$/, '');
  try {
    const u = new URL(raw);
    return /^https?:$/.test(u.protocol) ? u.toString() : '';
  } catch (_e) { return ''; }
}

function urlsFromValue(value) {
  const text = String(value || '').replace(/&amp;/gi, '&');
  const direct = cleanUrl(text);
  if (direct) return [direct];
  return [...text.matchAll(/https?:\/\/[^\s"'<>\[\]]+/gi)]
    .map(m => cleanUrl(m[0])).filter(Boolean);
}

function rowUrls(row, override) {
  const out = [];
  for (const [key, value] of Object.entries(row || {})) {
    if (override && key !== override) continue;
    const canonical = canonicalKey(key);
    const rank = URL_KEY_PRIORITY.has(canonical) ? URL_KEY_PRIORITY.get(canonical) : 10;
    for (const url of urlsFromValue(value)) out.push({ url, field: key, rank });
  }
  const seen = new Set();
  return out.sort((a, b) => a.rank - b.rank)
    .filter(item => !seen.has(item.url) && seen.add(item.url));
}

function isLeadSourceHost(host) {
  const h = String(host || '').toLowerCase().replace(/^www\./, '');
  return LEAD_SOURCE_HOSTS.some(source => h === source || h.endsWith('.' + source));
}

function usableHospitalDomain(host) {
  return !!host && !isAggregator(host) && !isLeadSourceHost(host);
}

function buildRosterIndex(roster) {
  const byCcn = new Map();
  const byNameState = new Map();
  for (const hospital of roster) {
    byCcn.set(hospital.ccn, hospital);
    const key = `${normalizeName(hospital.name)}|${hospital.state}`;
    if (!byNameState.has(key)) byNameState.set(key, []);
    byNameState.get(key).push(hospital);
  }
  return { byCcn, byNameState };
}

function mapRowToRoster(row, index, options = {}) {
  const rawCcn = field(row, CCN_KEYS, options.ccnColumn);
  const ccn = normalizeCcn(rawCcn);
  if (ccn) {
    const hospital = index.byCcn.get(ccn);
    return hospital
      ? { hospital, method: 'ccn' }
      : { hospital: null, reason: 'ccn-not-in-cms-roster' };
  }

  const name = String(field(row, NAME_KEYS, options.nameColumn) || '').trim();
  const state = normalizeState(field(row, STATE_KEYS, options.stateColumn));
  if (!name) return { hospital: null, reason: 'missing-hospital-name' };
  if (!state) return { hospital: null, reason: 'missing-or-invalid-state' };
  const matches = index.byNameState.get(`${normalizeName(name)}|${state}`) || [];
  if (matches.length === 1) return { hospital: matches[0], method: 'exact-name-state' };
  if (matches.length > 1) return { hospital: null, reason: 'ambiguous-exact-name-state' };
  return { hospital: null, reason: 'no-exact-cms-name-state-match' };
}

function discoverCandidates(rows, roster, options = {}) {
  const index = buildRosterIndex(roster);
  const covered = options.coveredCcns || new Set();
  const candidates = [];
  const unmapped = [];
  const seen = new Set();
  const stats = { inputRows: rows.length, covered: 0, mapped: 0, candidates: 0, noUsableUrl: 0, unmapped: 0 };

  rows.forEach((row, zeroIndex) => {
    const rowNumber = zeroIndex + 2;
    const mapped = mapRowToRoster(row, index, options);
    const publicUrls = rowUrls(row, options.urlColumn);
    if (!mapped.hospital) {
      stats.unmapped++;
      unmapped.push({
        source_row: rowNumber,
        hospital_name: String(field(row, NAME_KEYS, options.nameColumn) || '').trim(),
        state: normalizeState(field(row, STATE_KEYS, options.stateColumn)) || String(field(row, STATE_KEYS, options.stateColumn) || '').trim(),
        reason: mapped.reason,
        public_urls: publicUrls.map(u => u.url).join('|')
      });
      return;
    }
    const h = mapped.hospital;
    if (!options.includeKnown && covered.has(h.ccn)) { stats.covered++; return; }
    stats.mapped++;

    const usable = publicUrls
      .map(item => ({ ...item, domain: hostOf(item.url) }))
      .filter(item => usableHospitalDomain(item.domain));
    if (!usable.length) {
      stats.noUsableUrl++;
      unmapped.push({
        source_row: rowNumber, hospital_name: h.name, state: h.state,
        reason: publicUrls.length ? 'no-hospital-domain-url' : 'no-public-url',
        public_urls: publicUrls.map(u => u.url).join('|')
      });
      return;
    }

    for (const item of usable) {
      const key = `${h.ccn}|${item.domain}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({
        ccn: h.ccn, hospital_name: h.name, address: h.address || '', city: h.city || '',
        state: h.state, zip: h.zip || '', type: h.type || '',
        domain: item.domain, lead_url: item.url, mapping_method: mapped.method,
        source_row: rowNumber
      });
    }
  });
  stats.candidates = candidates.length;
  return { candidates, unmapped, stats };
}

function htmlTitle(html) {
  return ((String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '')
    .replace(/<[^>]+>/g, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim().slice(0, 180);
}

function bestPointerEntry(entries, hospital) {
  let best = null;
  for (const entry of entries || []) {
    const locationName = String(entry.locationName || '');
    const score = nameSimilarity(locationName, hospital.hospital_name);
    const strictScore = strictSimilarity(locationName, hospital.hospital_name);
    const exact = normalizeName(locationName) === normalizeName(hospital.hospital_name);
    const candidate = {
      entry, locationName, score: Number(score.toFixed(3)),
      strictScore: Number(strictScore.toFixed(3)), exact
    };
    if (!best || candidate.score > best.score ||
        (candidate.score === best.score && candidate.strictScore > best.strictScore)) best = candidate;
  }
  return best;
}

function successfulStatus(value) {
  const status = Number(value || 0);
  return status >= 200 && status < 300;
}

function mrfNameEvidence(probe, hospitalName) {
  const values = [probe && probe.mrfHospitalName, probe && probe.mrfLocationName].filter(Boolean);
  if (!values.length) return { value: '', score: 0 };
  return values.map(value => ({ value, score: nameSimilarity(value, hospitalName) }))
    .sort((a, b) => b.score - a.score)[0];
}

function mrfLocationConflicts(probe, best, hospital) {
  const rosterZip = String(hospital && hospital.zip || '').match(/\d{5}/);
  const headerZips = String(probe && probe.mrfAddress || '').match(/\b\d{5}(?:-\d{4})?\b/g) || [];
  if (!rosterZip || !headerZips.length || headerZips.some(zip => zip.slice(0, 5) === rosterZip[0])) return false;

  // Some system MRFs identify the facility in the location name while using a
  // corporate/main-campus address in the header. Preserve those, but refuse a
  // same-state, same-generic-name match when the only concrete location points
  // at a different ZIP (for example Fort Worth vs Sherman).
  const city = normalizeName(hospital && hospital.city);
  const identifyingNames = [
    best && best.entry && best.entry.locationName,
    probe && probe.mrfHospitalName,
    probe && probe.mrfLocationName
  ].filter(Boolean).map(normalizeName);
  return !city || !identifyingNames.some(name => (` ${name} `).includes(` ${city} `));
}

function classifyEvidence({ home, pointer, best, probe, hospital, requireHomepage = true }) {
  if (requireHomepage && !successfulStatus(home && home.status)) return { status: 'rejected', reason: 'hospital-homepage-unreachable' };
  if (!pointer || !pointer.ok) return { status: 'rejected', reason: `cms-hpt-${(pointer && pointer.reason) || 'not-found'}` };
  if (!best || best.score < 0.55) return { status: 'rejected', reason: 'cms-hpt-does-not-name-hospital' };
  const mrfUrl = best.entry.mrfUrl || (best.entry.mrfUrls && best.entry.mrfUrls[0]) || '';
  if (!isPlausibleMrfUrl(mrfUrl)) return { status: 'rejected', reason: 'cms-hpt-entry-has-no-valid-mrf-url' };
  if (!successfulStatus(probe && probe.rangeStatus)) return { status: 'rejected', reason: 'hospital-published-mrf-unreachable' };
  if (!probe || !probe.mrfLicenseState) return { status: 'review', reason: 'mrf-header-has-no-license-state' };
  if (probe.mrfLicenseState !== hospital.state) {
    return { status: 'rejected', reason: `mrf-license-state-${probe.mrfLicenseState}-not-${hospital.state}` };
  }

  // The pointer name itself must be exact or strong in both matching measures.
  // State alone is not enough because one system can publish sibling hospitals
  // in the same state from the same domain.
  const pointerIdentityStrong = best.exact || (best.score >= 0.75 && best.strictScore >= 0.60);
  if (!pointerIdentityStrong) return { status: 'review', reason: 'pointer-name-match-needs-review' };

  const headerName = mrfNameEvidence(probe, hospital.hospital_name);
  if (headerName.value && headerName.score < 0.45) {
    return { status: 'review', reason: 'mrf-header-name-conflicts-with-cms-roster' };
  }
  if (mrfLocationConflicts(probe, best, hospital)) {
    return { status: 'review', reason: 'mrf-header-location-conflicts-with-cms-roster' };
  }
  return { status: 'verified', reason: 'hospital-site-pointer-and-mrf-header-agree' };
}

async function verifyCandidate(candidate, options = {}, deps = {}) {
  const get = deps.directGet || directGet;
  const getPointer = deps.fetchPointer || fetchPointer;
  const probe = deps.probeMrf || probeMrf;
  const parse = deps.parsePointer || parsePointer;
  const timeoutMs = num(options.timeoutMs, 20000);
  const probeTimeoutMs = num(options.probeTimeoutMs, 45000);
  const checkedAt = new Date().toISOString();

  const home = await get(`https://${candidate.domain}/`, { timeoutMs, maxBytes: 524288 });
  const pointer = await getPointer(candidate.domain, {
    timeoutMs, maxBytes: 4194304, useUnblocker: false
  });
  const parsed = pointer && pointer.ok ? parse(pointer.body) : { entries: [], format: '' };
  const best = bestPointerEntry(parsed.entries, candidate);
  const mrfUrl = best && (best.entry.mrfUrl || (best.entry.mrfUrls && best.entry.mrfUrls[0])) || '';
  let mrfProbe = null;
  // Do not fetch a file until the official pointer has a plausible identity
  // match. Shared health-system pointers can contain hundreds of sibling MRFs;
  // probing the "best" weak match would waste bandwidth and attach unrelated
  // header facts to this hospital's evidence row.
  if (best && best.score >= 0.55 && isPlausibleMrfUrl(mrfUrl)) {
    try { mrfProbe = await probe(mrfUrl, { timeoutMs: probeTimeoutMs, useUnblocker: false }); }
    catch (error) { mrfProbe = { rangeError: String((error && error.message) || error) }; }
  }
  const verdict = classifyEvidence({
    home, pointer, best, probe: mrfProbe, hospital: candidate,
    requireHomepage: options.requireHomepage !== false
  });
  const headerName = mrfNameEvidence(mrfProbe, candidate.hospital_name);
  const resolvedDomain = pointer && pointer.ok
    ? (hostOf(pointer.finalUrl || pointer.url) || pointer.redirectedTo || candidate.domain)
    : '';

  return {
    ccn: candidate.ccn,
    hospital_name: candidate.hospital_name,
    address: candidate.address,
    city: candidate.city,
    state: candidate.state,
    zip: candidate.zip,
    type: candidate.type,
    status: verdict.status,
    reason: verdict.reason,
    resolved_domain: usableHospitalDomain(resolvedDomain) ? resolvedDomain : '',
    hospital_url: successfulStatus(home && home.status) ? (home.finalUrl || `https://${candidate.domain}/`) : '',
    homepage_http_status: (home && home.status) || 0,
    homepage_title: htmlTitle(home && home.body),
    pointer_url: pointer && pointer.ok ? (pointer.finalUrl || pointer.url || '') : '',
    pointer_via: pointer && pointer.ok ? (pointer.via || '') : '',
    pointer_format: parsed.format || '',
    pointer_location_name: best ? best.locationName : '',
    pointer_match_score: best ? best.score : '',
    pointer_strict_score: best ? best.strictScore : '',
    source_page_url: best && best.entry.sourcePageUrl || '',
    mrf_url: mrfUrl,
    mrf_http_status: mrfProbe && mrfProbe.httpStatus || '',
    mrf_range_status: mrfProbe && mrfProbe.rangeStatus || '',
    mrf_file_kind: mrfProbe && (mrfProbe.innerKind || mrfProbe.fileKind) || '',
    mrf_content_type: mrfProbe && mrfProbe.contentType || '',
    mrf_license_state: mrfProbe && mrfProbe.mrfLicenseState || '',
    mrf_hospital_name: mrfProbe && mrfProbe.mrfHospitalName || '',
    mrf_location_name: mrfProbe && mrfProbe.mrfLocationName || '',
    mrf_name_score: headerName.value ? Number(headerName.score.toFixed(3)) : '',
    mrf_address: mrfProbe && mrfProbe.mrfAddress || '',
    mrf_last_updated: mrfProbe && mrfProbe.declaredLastUpdated || '',
    mrf_cms_version: mrfProbe && mrfProbe.cmsVersion || '',
    checked_at: (mrfProbe && mrfProbe.checkedAt) || checkedAt
  };
}

function selectPromotable(evidence, domains) {
  const existingByCcn = new Map();
  for (const [domain, meta] of Object.entries(domains || {})) {
    for (const ccn of meta.ccns || []) {
      if (!existingByCcn.has(ccn)) existingByCcn.set(ccn, new Set());
      existingByCcn.get(ccn).add(domain);
    }
  }
  const verifiedByCcn = new Map();
  for (const row of evidence.filter(r => r.status === 'verified' && r.resolved_domain)) {
    if (!verifiedByCcn.has(row.ccn)) verifiedByCcn.set(row.ccn, []);
    verifiedByCcn.get(row.ccn).push(row);
  }

  const selected = [];
  for (const [ccn, rows] of verifiedByCcn) {
    const distinct = [...new Set(rows.map(r => r.resolved_domain))];
    const prior = [...(existingByCcn.get(ccn) || [])];
    if (distinct.length !== 1) {
      for (const row of rows) row.promotion_note = 'multiple-verified-domains';
      continue;
    }
    if (prior.length && !prior.includes(distinct[0])) {
      for (const row of rows) row.promotion_note = `existing-domain:${prior.join('|')}`;
      continue;
    }
    const row = rows.sort((a, b) => Number(b.pointer_match_score || 0) - Number(a.pointer_match_score || 0))[0];
    row.promotion_note = prior.length ? 'already-assigned' : 'eligible';
    selected.push(row);
  }
  return selected;
}

function mergeVerifiedDomains(domains, selected, options = {}) {
  const out = JSON.parse(JSON.stringify(domains || {}));
  let added = 0;
  for (const row of selected) {
    const domain = row.resolved_domain;
    if (!out[domain]) out[domain] = {
      domain, ccns: [], source: options.source || 'independently-verified-external-lead'
    };
    if (!out[domain].ccns.includes(row.ccn)) {
      out[domain].ccns.push(row.ccn);
      out[domain].ccns.sort();
      added++;
    }
  }
  return { domains: out, added };
}

function failedVerification(candidate, error) {
  return {
    ccn: candidate.ccn,
    hospital_name: candidate.hospital_name,
    address: candidate.address,
    city: candidate.city,
    state: candidate.state,
    zip: candidate.zip,
    type: candidate.type,
    status: 'rejected',
    reason: `verification-error:${String((error && error.message) || error || 'unknown').slice(0, 160)}`,
    resolved_domain: '',
    checked_at: new Date().toISOString()
  };
}

const CANDIDATE_COLUMNS = [
  'ccn', 'hospital_name', 'address', 'city', 'state', 'zip', 'type',
  'domain', 'lead_url', 'mapping_method', 'source_row'
];
const UNMAPPED_COLUMNS = ['source_row', 'hospital_name', 'state', 'reason', 'public_urls'];
const EVIDENCE_COLUMNS = [
  'ccn', 'hospital_name', 'address', 'city', 'state', 'zip', 'type',
  'status', 'reason', 'resolved_domain', 'hospital_url', 'homepage_http_status',
  'homepage_title', 'pointer_url', 'pointer_via', 'pointer_format',
  'pointer_location_name', 'pointer_match_score', 'pointer_strict_score',
  'source_page_url', 'mrf_url', 'mrf_http_status', 'mrf_range_status',
  'mrf_file_kind', 'mrf_content_type', 'mrf_license_state',
  'mrf_hospital_name', 'mrf_location_name', 'mrf_name_score', 'mrf_address',
  'mrf_last_updated', 'mrf_cms_version', 'checked_at', 'promotion_note'
];
const VERIFIED_COLUMNS = [
  'ccn', 'hospital_name', 'address', 'city', 'state', 'zip', 'type',
  'resolved_domain', 'hospital_url', 'pointer_url', 'pointer_location_name',
  'mrf_url', 'mrf_license_state', 'mrf_last_updated', 'mrf_cms_version',
  'checked_at', 'promotion_note'
];

async function main() {
  const opt = parseArgs();
  if (opt.help || opt.h || !opt.input) {
    const doc = await fsp.readFile(__filename, 'utf8');
    log(doc.slice(doc.indexOf('/**') + 3, doc.indexOf('*/')).replace(/^ \* ?/gm, '').trim());
    if (!opt.input && !opt.help && !opt.h) process.exitCode = 1;
    return;
  }

  const input = path.resolve(String(opt.input));
  const [raw, rosterRaw, manifestRaw, domainsRaw] = await Promise.all([
    fsp.readFile(input, 'utf8'),
    fsp.readFile(FILES.roster, 'utf8'),
    fsp.readFile(FILES.manifest, 'utf8').catch(() => '[]'),
    fsp.readFile(FILES.domains, 'utf8')
  ]);
  const rows = csvToObjects(raw.replace(/^\uFEFF/, ''));
  const roster = JSON.parse(rosterRaw);
  const manifest = JSON.parse(manifestRaw);
  const domains = JSON.parse(domainsRaw);
  const discovered = discoverCandidates(rows, roster, {
    coveredCcns: new Set(manifest.map(row => row.ccn)),
    includeKnown: !!opt['include-known'],
    nameColumn: opt['name-column'], stateColumn: opt['state-column'],
    ccnColumn: opt['ccn-column'], urlColumn: opt['url-column']
  });
  let candidates = discovered.candidates;
  if (opt.limit) candidates = candidates.slice(0, num(opt.limit));

  await fsp.mkdir(OUT, { recursive: true });
  await Promise.all([
    fsp.writeFile(FILES.candidates, toCSV(candidates, CANDIDATE_COLUMNS)),
    fsp.writeFile(FILES.unmapped, toCSV(discovered.unmapped, UNMAPPED_COLUMNS))
  ]);
  log(`${rows.length} export rows -> ${discovered.stats.mapped} CMS-roster rows -> ${discovered.candidates.length} hospital-domain candidates.`);
  log(`Skipped ${discovered.stats.covered} hospitals already in manifest; ${discovered.stats.unmapped} rows did not map exactly; ${discovered.stats.noUsableUrl} mapped rows had no hospital-domain URL.`);
  log(`Lead worklist: ${path.relative(ROOT, FILES.candidates)} (disposable; no source metadata is promoted)`);

  if (opt['discover-only']) return;
  const cache = new JsonStore(FILES.cache);
  await cache.load();
  // One source export often names many hospitals on the same health-system
  // domain. Reuse the homepage, pointer, and identical MRF requests within a
  // run while retaining candidate-specific identity decisions and cache rows.
  const homeFetches = new Map();
  const pointerFetches = new Map();
  const mrfProbes = new Map();
  const once = (map, key, start) => {
    if (!map.has(key)) map.set(key, Promise.resolve().then(start));
    return map.get(key);
  };
  const memoizedDeps = {
    directGet: (url, options) => once(homeFetches, url, () => directGet(url, options)),
    fetchPointer: (domain, options) => once(pointerFetches, domain, () => fetchPointer(domain, options)),
    probeMrf: (url, options) => once(mrfProbes, url, () => probeMrf(url, options))
  };
  let done = 0;
  let cacheSave = Promise.resolve();
  const queueCacheSave = force => {
    cacheSave = cacheSave.then(() => cache.save(force));
    return cacheSave;
  };
  const results = await pooled(candidates, {
    concurrency: num(opt.concurrency, 8),
    keyFn: row => row.domain,
    onProgress: (count, total) => process.stdout.write(`\rDirect verification ${count}/${total}   `)
  }, async candidate => {
    const key = `${candidate.ccn}|${candidate.domain}`;
    let result = !opt.retry && cache.get(key);
    if (!result) {
      try {
        result = await verifyCandidate(candidate, {
          timeoutMs: num(opt.timeout, 20000),
          probeTimeoutMs: num(opt['probe-timeout'], 45000)
        }, memoizedDeps);
      } catch (error) {
        result = failedVerification(candidate, error);
      }
      cache.set(key, result);
      if (++done % 20 === 0) await queueCacheSave(false);
    }
    return result;
  });
  await queueCacheSave(true);
  if (candidates.length) process.stdout.write('\n');

  const evidence = results.map((row, index) => row && row.status
    ? row
    : failedVerification(candidates[index], row && row.error || 'worker-returned-no-status'))
    .sort((a, b) =>
    a.status.localeCompare(b.status) || a.state.localeCompare(b.state) || a.hospital_name.localeCompare(b.hospital_name));
  const selected = selectPromotable(evidence, domains);
  const review = evidence.filter(row => row.status !== 'verified' || !selected.includes(row));
  await Promise.all([
    fsp.writeFile(FILES.evidence, toCSV(evidence, EVIDENCE_COLUMNS)),
    fsp.writeFile(FILES.review, toCSV(review, EVIDENCE_COLUMNS)),
    fsp.writeFile(FILES.verified, toCSV(selected, VERIFIED_COLUMNS))
  ]);

  const counts = {};
  for (const row of evidence) counts[row.status] = (counts[row.status] || 0) + 1;
  log(`Verification results: ${JSON.stringify(counts)}; ${selected.length} domain assignments are promotion-safe.`);
  log(`Independent evidence: ${path.relative(ROOT, FILES.evidence)}`);
  log(`Verified import:      ${path.relative(ROOT, FILES.verified)}`);
  log(`Review queue:         ${path.relative(ROOT, FILES.review)}`);

  if (opt.promote) {
    const merged = mergeVerifiedDomains(domains, selected);
    await fsp.writeFile(FILES.domains, JSON.stringify(merged.domains, null, 1));
    log(`Promoted ${merged.added} independently verified CCN/domain assignments to ${path.relative(ROOT, FILES.domains)}.`);
    if (merged.added) log('Next: node scripts/hpt/run.js pointers && node scripts/hpt/run.js match');
  } else if (selected.length) {
    log('Nothing was promoted. Re-run with --promote after reviewing the evidence CSV.');
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('\nERROR:', (error && error.stack) || error);
    process.exitCode = 1;
  });
}

module.exports = {
  canonicalKey, normalizeCcn, normalizeState, rowUrls, isLeadSourceHost,
  usableHospitalDomain, buildRosterIndex, mapRowToRoster, discoverCandidates,
  bestPointerEntry, classifyEvidence, verifyCandidate, selectPromotable,
  mergeVerifiedDomains, failedVerification
};
