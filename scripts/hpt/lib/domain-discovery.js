'use strict';

const crypto = require('crypto');
const dns = require('dns');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const {
  csvToObjects, hostOf, isAggregator, normalizeName, nameSimilarity,
  strictSimilarity
} = require('./util');
const { STATE_ABBREV } = require('./candidates');
const { directGet, fetchPointer, quickPointer, classify: classifyHttp } = require('./fetch');
const { parsePointer, isPlausibleMrfUrl, guessFormat } = require('./parse');
const { probeMrf } = require('./probe');
const { adjudicatePair, isAccepted } = require('./adjudicate');
const { bestPointerEntry, classifyEvidence } = require('../verify-external-links');
const {
  protectPointerTextIfEnabled, inspectPointerText
} = require('./pointer-obfuscation');

const FEDERAL = /Veterans Administration|Department of Defense/i;
const DISCOVERY_REMEDIATION = 'exa-domain-lookup';
const NAME_REMEDIATION = 'name-match-review';
const BLOCKED_REMEDIATION = 'unblocker';
const DEFAULT_SOURCES = ['prior', 'pointers', 'wikidata', 'osm', 'heuristic'];
const SUPPORTED_SOURCES = [
  ...DEFAULT_SOURCES, 'inverse', 'archive', 'cms-relations', 'nppes',
  'siblings', 'contacts', 'irs990', 'llm-domain', 'search'
];
const GENERIC_TOKENS = new Set([
  'hospital', 'hosp', 'hospitals', 'medical', 'med', 'center', 'centre', 'ctr',
  'health', 'healthcare', 'regional', 'community', 'memorial', 'general',
  'system', 'clinic', 'county', 'district', 'saint', 'st', 'the', 'of', 'and'
]);

const CANDIDATE_COLUMNS = [
  'ccn', 'hospital_name', 'address', 'city', 'state', 'zip', 'phone', 'type',
  'queue_kind', 'previous_domain', 'candidate_domain', 'sources',
  'source_record_urls', 'source_names', 'source_addresses', 'source_phones',
  'source_mrf_url',
  'source_lat', 'source_lon', 'distance_km', 'name_score', 'strict_name_score',
  'phone_match', 'address_match', 'candidate_score', 'discovered_at'
];

const EVIDENCE_COLUMNS = [
  'ccn', 'hospital_name', 'address', 'city', 'state', 'zip', 'phone', 'type',
  'queue_kind', 'previous_domain', 'candidate_domain', 'sources',
  'source_record_urls', 'source_names', 'source_addresses', 'source_phones',
  'source_mrf_url',
  'source_lat', 'source_lon', 'distance_km', 'name_score', 'strict_name_score',
  'phone_match', 'address_match', 'candidate_score', 'discovered_at',
  'status', 'reason', 'resolved_domain', 'dns_status', 'hospital_url', 'homepage_http_status',
  'homepage_title', 'homepage_canonical_domain', 'pointer_url', 'pointer_via',
  'pointer_format', 'pointer_location_name', 'pointer_match_score',
  'pointer_strict_score', 'pointer_file', 'pointer_sha256', 'source_page_url',
  'mrf_url', 'extra_mrf_urls', 'mrf_http_status', 'mrf_range_status',
  'mrf_file_kind', 'mrf_content_type', 'mrf_license_state',
  'mrf_hospital_name', 'mrf_location_name', 'mrf_name_score', 'mrf_address',
  'mrf_last_updated', 'mrf_cms_version', 'request_count', 'bytes_read',
  'llm_name_match', 'llm_name_confidence', 'llm_name_reason', 'llm_name_model',
  'llm_name_prompt_tokens', 'llm_name_completion_tokens', 'llm_name_total_tokens',
  'checked_at', 'promotion_note', 'approved'
];

const VERIFIED_COLUMNS = EVIDENCE_COLUMNS;

const MANUAL_COLUMNS = [
  'ccn', 'hospital_name', 'address', 'city', 'state', 'zip', 'phone', 'type',
  'queue_kind', 'previous_domain', 'final_status', 'phone_query',
  'address_query', 'name_query'
];

function stableHash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function normalizeDomain(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const host = hostOf(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  return host && !isAggregator(host) ? host : '';
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

function normalizeZip(value) {
  const match = String(value || '').match(/\d{5}/);
  return match ? match[0] : '';
}

function normalizeState(value) {
  const raw = String(value || '').trim();
  if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase();
  if (/^US-[A-Za-z]{2}$/i.test(raw)) return raw.slice(-2).toUpperCase();
  return STATE_ABBREV[raw.toLowerCase()] || '';
}

function streetNumber(value) {
  const match = String(value || '').trim().match(/^\D*(\d+[A-Za-z]?)/);
  return match ? match[1].toLowerCase() : '';
}

function addressTokens(value) {
  return new Set(normalizeName(value).split(' ').filter(token => token.length > 2));
}

function addressAgreement(a, b) {
  const left = addressTokens(a);
  const right = addressTokens(b);
  if (!left.size || !right.size) return false;
  const an = streetNumber(a);
  const bn = streetNumber(b);
  if (an && bn && an !== bn) return false;
  let common = 0;
  for (const token of left) if (right.has(token)) common++;
  return common >= 2 && common / Math.max(left.size, right.size) >= 0.35;
}

function coordinates(value) {
  if (!Array.isArray(value) || value.length < 2) return null;
  const lon = Number(value[0]);
  const lat = Number(value[1]);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

function haversineKm(a, b) {
  if (!a || !b) return null;
  const rad = value => value * Math.PI / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const x = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function queueRows(gaps, options = {}) {
  const kinds = new Set(options.kinds || ['missing', 'stale']);
  return gaps.filter(row => row.ccn && row.hospital_name && !FEDERAL.test(row.type || '')
    && [DISCOVERY_REMEDIATION, NAME_REMEDIATION, BLOCKED_REMEDIATION].includes(row.remediation))
    .map(row => {
      const queueKind = row.remediation === NAME_REMEDIATION ? 'name'
        : row.remediation === BLOCKED_REMEDIATION ? 'blocked'
          : row.seeded_domain ? 'stale' : 'missing';
      return {
      ...row,
      queue_kind: queueKind,
      previous_domain: normalizeDomain(row.seeded_domain)
      };
    })
    .filter(row => kinds.has(row.queue_kind));
}

function weightedSample(rows, count, seed) {
  if (count >= rows.length) return rows.slice().sort((a, b) => a.ccn.localeCompare(b.ccn));
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.state}|${row.type}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const state = [...groups].map(([key, items]) => ({
    key,
    items: items.slice().sort((a, b) => stableHash(`${seed}|${a.ccn}`).localeCompare(stableHash(`${seed}|${b.ccn}`))),
    picked: 0
  }));
  const out = [];
  while (out.length < count) {
    const available = state.filter(group => group.picked < group.items.length);
    if (!available.length) break;
    available.sort((a, b) => (a.picked / a.items.length) - (b.picked / b.items.length)
      || stableHash(`${seed}|${a.key}`).localeCompare(stableHash(`${seed}|${b.key}`)));
    const chosen = available[0];
    out.push(chosen.items[chosen.picked++]);
  }
  return out;
}

function stratifiedSample(rows, count, seed = '20260903') {
  if (!count || count >= rows.length) return rows.slice().sort((a, b) => a.ccn.localeCompare(b.ccn));
  const missing = rows.filter(row => row.queue_kind === 'missing');
  const stale = rows.filter(row => row.queue_kind === 'stale');
  let missingCount = Math.min(missing.length, Math.round(count * 0.8));
  let staleCount = Math.min(stale.length, count - missingCount);
  if (missingCount + staleCount < count) {
    const roomMissing = missing.length - missingCount;
    const addMissing = Math.min(roomMissing, count - missingCount - staleCount);
    missingCount += addMissing;
    staleCount += Math.min(stale.length - staleCount, count - missingCount - staleCount);
  }
  return [
    ...weightedSample(missing, missingCount, `${seed}|missing`),
    ...weightedSample(stale, staleCount, `${seed}|stale`)
  ].sort((a, b) => stableHash(`${seed}|${a.ccn}`).localeCompare(stableHash(`${seed}|${b.ccn}`)));
}

function sourcePosition(element) {
  if (Number.isFinite(Number(element.lat)) && Number.isFinite(Number(element.lon))) {
    return { lat: Number(element.lat), lon: Number(element.lon) };
  }
  const center = element.center || {};
  return Number.isFinite(Number(center.lat)) && Number.isFinite(Number(center.lon))
    ? { lat: Number(center.lat), lon: Number(center.lon) } : null;
}

function osmAddress(tags) {
  const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
  return [street, tags['addr:city'], tags['addr:state'], tags['addr:postcode']].filter(Boolean).join(', ');
}

function parseOsmElements(payload) {
  const out = [];
  for (const element of (payload && payload.elements) || []) {
    const tags = element.tags || {};
    const websites = [tags.website, tags['contact:website']]
      .flatMap(value => String(value || '').split(/[;,|]/))
      .map(normalizeDomain).filter(Boolean);
    if (!websites.length) continue;
    const pos = sourcePosition(element);
    out.push({
      source: 'osm',
      source_record_url: `https://www.openstreetmap.org/${element.type}/${element.id}`,
      names: [tags.name, tags.official_name, tags.alt_name, tags.operator, tags.brand].filter(Boolean),
      address: osmAddress(tags),
      city: tags['addr:city'] || '',
      state: normalizeState(tags['addr:state']),
      zip: normalizeZip(tags['addr:postcode']),
      phone: tags.phone || tags['contact:phone'] || '',
      lat: pos && pos.lat,
      lon: pos && pos.lon,
      domains: [...new Set(websites)]
    });
  }
  return out;
}

function parseWikidataBindings(payload) {
  const out = [];
  for (const binding of (((payload || {}).results || {}).bindings || [])) {
    const domain = normalizeDomain(binding.site && binding.site.value);
    if (!domain) continue;
    let lat = null;
    let lon = null;
    const point = String(binding.coord && binding.coord.value || '').match(/Point\((-?[\d.]+) (-?[\d.]+)\)/i);
    if (point) { lon = Number(point[1]); lat = Number(point[2]); }
    out.push({
      source: 'wikidata',
      source_record_url: binding.h && binding.h.value || '',
      names: [binding.hLabel && binding.hLabel.value].filter(Boolean),
      address: '', city: '',
      state: normalizeState(binding.stateCode && binding.stateCode.value),
      zip: '', phone: '', lat, lon, domains: [domain]
    });
  }
  return out;
}

function sourceCandidate(job, source, coords) {
  const jobPos = coordinates(coords && coords[job.ccn]);
  const sourcePos = Number.isFinite(source.lat) && Number.isFinite(source.lon)
    ? { lat: source.lat, lon: source.lon } : null;
  const distance = haversineKm(jobPos, sourcePos);
  let bestName = '';
  let bestScore = 0;
  let bestStrict = 0;
  for (const name of source.names || []) {
    const score = nameSimilarity(job.hospital_name, name);
    const strict = strictSimilarity(job.hospital_name, name);
    if (score > bestScore || (score === bestScore && strict > bestStrict)) {
      bestName = name; bestScore = score; bestStrict = strict;
    }
  }
  const phoneMatch = !!normalizePhone(job.phone) && normalizePhone(job.phone) === normalizePhone(source.phone);
  const zipMatch = !!normalizeZip(job.zip) && normalizeZip(job.zip) === normalizeZip(source.zip || source.address);
  const addressMatch = addressAgreement(job.address, source.address);
  const cityMatch = !!job.city && normalizeName(source.city || source.address).includes(normalizeName(job.city));
  const stateMatch = !source.state || source.state === job.state;
  const near = distance !== null && distance <= 2;
  const mid = distance !== null && distance <= 10;
  const eligible = phoneMatch
    || (stateMatch && bestScore >= 0.55 && (near || zipMatch || addressMatch || cityMatch || bestStrict >= 0.65))
    || (near && bestScore >= 0.30)
    || (mid && bestScore >= 0.60 && (zipMatch || addressMatch || cityMatch));
  if (!eligible) return null;
  const score = (phoneMatch ? 50 : 0) + (addressMatch ? 25 : 0) + (zipMatch ? 15 : 0)
    + (near ? 20 : mid ? 8 : 0) + bestScore * 20 + bestStrict * 10 + (stateMatch ? 5 : 0);
  return {
    source_name: bestName,
    source_address: source.address || '',
    source_phone: source.phone || '',
    source_lat: sourcePos ? sourcePos.lat : '',
    source_lon: sourcePos ? sourcePos.lon : '',
    distance_km: distance === null ? '' : Number(distance.toFixed(2)),
    name_score: Number(bestScore.toFixed(3)),
    strict_name_score: Number(bestStrict.toFixed(3)),
    phone_match: phoneMatch ? 'yes' : 'no',
    address_match: addressMatch ? 'yes' : 'no',
    candidate_score: Number(score.toFixed(3)),
    source_record_url: source.source_record_url || ''
  };
}

function candidatesFromExternal(jobs, sources, coords) {
  const out = [];
  for (const job of jobs) {
    for (const source of sources) {
      const evidence = sourceCandidate(job, source, coords);
      if (!evidence) continue;
      for (const domain of source.domains || []) {
        if (!normalizeDomain(domain)) continue;
        out.push(candidateRow(job, domain, source.source, evidence));
      }
    }
  }
  return out;
}

function candidateRow(job, domain, source, evidence = {}) {
  return {
    ccn: job.ccn,
    hospital_name: job.hospital_name,
    address: job.address || '', city: job.city || '', state: job.state || '',
    zip: job.zip || '', phone: job.phone || '', type: job.type || '',
    queue_kind: job.queue_kind,
    previous_domain: job.previous_domain || '',
    candidate_domain: normalizeDomain(domain),
    sources: source || '',
    source_record_urls: evidence.source_record_url || '',
    source_names: evidence.source_name || '',
    source_addresses: evidence.source_address || '',
    source_phones: evidence.source_phone || '',
    source_mrf_url: evidence.source_mrf_url || '',
    source_lat: evidence.source_lat === undefined ? '' : evidence.source_lat,
    source_lon: evidence.source_lon === undefined ? '' : evidence.source_lon,
    distance_km: evidence.distance_km === undefined ? '' : evidence.distance_km,
    name_score: evidence.name_score === undefined ? '' : evidence.name_score,
    strict_name_score: evidence.strict_name_score === undefined ? '' : evidence.strict_name_score,
    phone_match: evidence.phone_match || 'no',
    address_match: evidence.address_match || 'no',
    candidate_score: evidence.candidate_score === undefined ? 0 : evidence.candidate_score,
    discovered_at: new Date().toISOString()
  };
}

function mergeValues(...values) {
  return [...new Set(values.flatMap(value => String(value || '').split('|')).map(value => value.trim()).filter(Boolean))].join('|');
}

function mergeCandidates(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!row.candidate_domain) continue;
    const key = `${row.ccn}|${row.candidate_domain}`;
    const prior = map.get(key);
    if (!prior) { map.set(key, { ...row }); continue; }
    prior.sources = mergeValues(prior.sources, row.sources);
    prior.source_record_urls = mergeValues(prior.source_record_urls, row.source_record_urls);
    prior.source_names = mergeValues(prior.source_names, row.source_names);
    prior.source_addresses = mergeValues(prior.source_addresses, row.source_addresses);
    prior.source_phones = mergeValues(prior.source_phones, row.source_phones);
    prior.source_mrf_url = mergeValues(prior.source_mrf_url, row.source_mrf_url);
    if (Number(row.candidate_score || 0) > Number(prior.candidate_score || 0)) {
      for (const field of ['source_lat', 'source_lon', 'distance_km', 'name_score', 'strict_name_score', 'phone_match', 'address_match', 'candidate_score']) {
        prior[field] = row[field];
      }
    }
  }
  return [...map.values()];
}

const SOURCE_PRIORITY = [
  'prior', 'pointers', 'contacts', 'inverse', 'cms-relations', 'nppes-sibling',
  'nppes-endpoint', 'nppes', 'siblings', 'stale', 'archive', 'irs990',
  'serper', 'search', 'decodo', 'exa', 'llm-domain', 'wikidata', 'osm', 'heuristic'
];

function sourceRank(row) {
  const sources = String(row.sources || '').split('|');
  let best = SOURCE_PRIORITY.length;
  for (const source of sources) {
    const index = SOURCE_PRIORITY.indexOf(source);
    if (index >= 0 && index < best) best = index;
  }
  return best;
}

function limitCandidates(rows, maxPerHospital = 8) {
  const byCcn = new Map();
  for (const row of mergeCandidates(rows)) {
    if (!byCcn.has(row.ccn)) byCcn.set(row.ccn, []);
    byCcn.get(row.ccn).push(row);
  }
  const out = [];
  for (const list of byCcn.values()) {
    list.sort((a, b) => Number(b.candidate_score || 0) - Number(a.candidate_score || 0)
      || sourceRank(a) - sourceRank(b)
      || a.candidate_domain.localeCompare(b.candidate_domain));
    const chosen = [];
    for (const source of SOURCE_PRIORITY) {
      const row = list.find(item => String(item.sources).split('|').includes(source) && !chosen.includes(item));
      if (row && chosen.length < maxPerHospital) chosen.push(row);
    }
    for (const row of list) {
      if (chosen.length >= maxPerHospital) break;
      if (!chosen.includes(row)) chosen.push(row);
    }
    out.push(...chosen);
  }
  return out.sort((a, b) => a.ccn.localeCompare(b.ccn)
    || Number(b.candidate_score || 0) - Number(a.candidate_score || 0)
    || a.candidate_domain.localeCompare(b.candidate_domain));
}

function visibleText(html) {
  return String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').toLowerCase();
}

function titleOf(html) {
  const match = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 180) : '';
}

function homepageIdentity(home, candidate) {
  const text = visibleText(home && home.body);
  if (!text) return false;
  const distinctive = normalizeName(candidate.hospital_name).split(' ')
    .filter(token => token.length > 2 && !GENERIC_TOKENS.has(token));
  const nameHit = distinctive.length
    ? distinctive.some(token => text.includes(token))
    : text.includes(normalizeName(candidate.hospital_name));
  const cityHit = candidate.city && text.includes(String(candidate.city).toLowerCase());
  const stateHit = candidate.state && new RegExp(`\\b${String(candidate.state).toLowerCase()}\\b`).test(text);
  return !!nameHit && !!(cityHit || stateHit);
}

function canonicalHost(home) {
  const finalHost = normalizeDomain(home && home.finalUrl);
  const html = String(home && home.body || '');
  const canonical = html.match(/<link[^>]+rel=["'][^"']*canonical[^"']*["'][^>]+href=["']([^"']+)/i)
    || html.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)/i);
  return normalizeDomain(canonical && canonical[1]) || finalHost;
}

function distinctiveTokens(value) {
  return normalizeName(value).split(' ').filter(token => token.length > 2 && !GENERIC_TOKENS.has(token));
}

function genericNeedsLocation(candidate, duplicateNames) {
  return distinctiveTokens(candidate.hospital_name).length <= 1
    || (duplicateNames && duplicateNames.has(`${normalizeName(candidate.hospital_name)}|${candidate.state}`));
}

function concreteLocationAgreement(candidate, best, probe) {
  const values = [
    best && best.entry && best.entry.locationName,
    probe && probe.mrfHospitalName,
    probe && probe.mrfLocationName,
    probe && probe.mrfAddress
  ].filter(Boolean).join(' | ');
  const normalized = normalizeName(values);
  const zip = normalizeZip(candidate.zip);
  if (zip && String(values).includes(zip)) return true;
  if (candidate.city && normalized.includes(normalizeName(candidate.city))) return true;
  if (candidate.address && addressAgreement(candidate.address, values)) return true;
  return false;
}

const dnsChecks = new Map();

async function resolveDns(domain, options = {}) {
  const host = normalizeDomain(domain);
  if (!host) return 'invalid';
  if (dnsChecks.has(host)) return dnsChecks.get(host);
  const timeoutMs = Number(options.timeoutMs || 5000);
  const check = (async () => {
    const names = host.startsWith('www.') ? [host] : [host, `www.${host}`];
    let transient = false;
    for (const name of names) {
      try {
        const addresses = await Promise.race([
          dns.promises.lookup(name, { all: true }),
          new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('DNS timeout'), { code: 'ETIMEOUT' })), timeoutMs))
        ]);
        if (addresses && addresses.length) return 'ok';
      } catch (error) {
        if (!['ENOTFOUND', 'ENODATA', 'EAI_NONAME'].includes(error && error.code)) transient = true;
      }
    }
    return transient ? 'network-error' : 'nxdomain';
  })();
  dnsChecks.set(host, check);
  return check;
}

async function verifyDiscoveryCandidate(candidate, options = {}, deps = {}) {
  const get = deps.directGet || directGet;
  const getPointer = options.trustedDomain
    ? (deps.fetchPointer || fetchPointer)
    : (deps.quickPointer || quickPointer);
  const probe = deps.probeMrf || probeMrf;
  const parse = deps.parsePointer || parsePointer;
  const resolve = deps.resolveDns || resolveDns;
  const adjudicate = deps.adjudicatePair || adjudicatePair;
  const timeoutMs = Number(options.timeoutMs || 15000);
  const probeTimeoutMs = Number(options.probeTimeoutMs || 45000);
  const checkedAt = new Date().toISOString();
  const dnsStatus = await resolve(candidate.candidate_domain, { timeoutMs: Math.min(timeoutMs, 5000) });
  if (dnsStatus === 'invalid' || dnsStatus === 'nxdomain') {
    return {
      ...Object.fromEntries(EVIDENCE_COLUMNS.map(column => [column, ''])),
      ...candidate,
      status: 'rejected',
      reason: dnsStatus,
      resolved_domain: '',
      dns_status: dnsStatus,
      checked_at: checkedAt
    };
  }
  const home = await get(`https://${candidate.candidate_domain}/`, { timeoutMs, maxBytes: 524288 });
  const canonical = canonicalHost(home);
  let pointer = await getPointer(candidate.candidate_domain, {
    timeoutMs, maxBytes: 4194304, useUnblocker: false
  });
  if ((!pointer || !pointer.ok) && canonical && canonical !== candidate.candidate_domain) {
    const redirected = await getPointer(canonical, { timeoutMs });
    if (redirected && redirected.ok) pointer = { ...redirected, via: 'homepage-redirect' };
  }
  const parsed = pointer && pointer.ok ? parse(pointer.body) : { entries: [], format: '' };
  const sourceMrfUrls = new Set(String(candidate.source_mrf_url || '').split('|').filter(Boolean));
  const targetedEntries = sourceMrfUrls.size ? parsed.entries.filter(entry => {
    const urls = [entry.mrfUrl, ...(entry.mrfUrls || [])].filter(Boolean);
    return urls.some(url => sourceMrfUrls.has(url));
  }) : [];
  const best = bestPointerEntry(targetedEntries.length ? targetedEntries : parsed.entries, candidate);
  const mrfUrl = best && (best.entry.mrfUrl || (best.entry.mrfUrls && best.entry.mrfUrls[0])) || '';
  let mrfProbe = null;
  const deterministicNameStrong = !!(best && (best.exact
    || (best.score >= 0.75 && best.strictScore >= 0.60)));
  const llmProbeEligible = !!(options.llmNameMatch && best && best.score >= 0.25);
  if (best && (best.score >= 0.55 || llmProbeEligible) && isPlausibleMrfUrl(mrfUrl)) {
    try { mrfProbe = await probe(mrfUrl, { timeoutMs: probeTimeoutMs, useUnblocker: false }); }
    catch (error) { mrfProbe = { rangeError: String((error && error.message) || error), checkedAt }; }
  }
  let llmNameVerdict = null;
  if (options.llmNameMatch && best && !deterministicNameStrong && isPlausibleMrfUrl(mrfUrl)) {
    llmNameVerdict = await adjudicate({
      ccn: candidate.ccn, name: candidate.hospital_name, type: candidate.type,
      address: candidate.address, city: candidate.city, state: candidate.state,
      zip: candidate.zip, phone: candidate.phone
    }, {
      locationName: best.locationName, domain: candidate.candidate_domain
    }, {
      mrfHospitalName: mrfProbe && mrfProbe.mrfHospitalName,
      mrfLocationName: mrfProbe && mrfProbe.mrfLocationName,
      mrfAddress: mrfProbe && mrfProbe.mrfAddress,
      mrfLicenseState: mrfProbe && mrfProbe.mrfLicenseState
    }, {
      model: options.llmModel || 'z-ai/glm-5.3-flash',
      timeoutMs: Number(options.llmTimeoutMs || 60000)
    });
    best.llmAccepted = isAccepted(llmNameVerdict);
  }
  const baseCandidate = { ...candidate, domain: candidate.candidate_domain };
  let verdict = classifyEvidence({
    home, pointer, best, probe: mrfProbe, hospital: baseCandidate,
    requireHomepage: false
  });
  const homeMatches = homepageIdentity(home, candidate);
  if (!pointer || !pointer.ok) {
    const reason = pointer && pointer.reason || classifyHttp(home && home.status, home && home.body);
    const strongLead = String(candidate.sources || '').split('|').some(source => source && source !== 'heuristic');
    verdict = reason === 'blocked'
      ? { status: 'blocked', reason: 'cms-hpt-blocked' }
      : homeMatches
        ? { status: 'site-found', reason: 'homepage-identifies-hospital-but-pointer-unverified' }
        : reason === 'neterr' || reason === 'server'
          ? { status: strongLead ? 'review' : 'none', reason: reason === 'neterr' ? 'network-error' : 'server-error' }
        : { status: 'rejected', reason: `cms-hpt-${reason || 'not-found'}` };
  }
  if (verdict.status === 'verified'
      && genericNeedsLocation(candidate, options.duplicateNames)
      && !concreteLocationAgreement(candidate, best, mrfProbe)) {
    verdict = { status: 'review', reason: 'generic-name-needs-location' };
  }
  const resolvedDomain = verdict.status === 'verified'
    ? normalizeDomain(pointer && (pointer.finalUrl || pointer.url)) || canonical || candidate.candidate_domain
    : '';
  const headerName = mrfProbe && (mrfProbe.mrfHospitalName || mrfProbe.mrfLocationName) || '';
  const extraMrfUrls = best && best.entry && best.entry.mrfUrls
    ? best.entry.mrfUrls.filter(url => url !== mrfUrl).join('|') : '';
  return {
    ...Object.fromEntries(EVIDENCE_COLUMNS.map(column => [column, ''])),
    ...candidate,
    status: verdict.status,
    reason: verdict.reason,
    resolved_domain: resolvedDomain,
    dns_status: dnsStatus,
    hospital_url: home && home.status >= 200 && home.status < 400 ? (home.finalUrl || `https://${candidate.candidate_domain}/`) : '',
    homepage_http_status: home && home.status || 0,
    homepage_title: titleOf(home && home.body),
    homepage_canonical_domain: canonical || '',
    pointer_url: pointer && pointer.ok ? (pointer.finalUrl || pointer.url || '') : '',
    pointer_via: pointer && pointer.ok ? (pointer.via || 'quick') : '',
    pointer_format: parsed.format || '',
    pointer_location_name: best ? best.locationName : '',
    pointer_match_score: best ? best.score : '',
    pointer_strict_score: best ? best.strictScore : '',
    pointer_sha256: pointer && pointer.ok ? stableHash(pointer.body) : '',
    source_page_url: best && best.entry.sourcePageUrl || '',
    mrf_url: mrfUrl,
    extra_mrf_urls: extraMrfUrls,
    mrf_http_status: mrfProbe && mrfProbe.httpStatus || '',
    mrf_range_status: mrfProbe && mrfProbe.rangeStatus || '',
    mrf_file_kind: mrfProbe && (mrfProbe.innerKind || mrfProbe.fileKind) || '',
    mrf_content_type: mrfProbe && mrfProbe.contentType || '',
    mrf_license_state: mrfProbe && mrfProbe.mrfLicenseState || '',
    mrf_hospital_name: mrfProbe && mrfProbe.mrfHospitalName || '',
    mrf_location_name: mrfProbe && mrfProbe.mrfLocationName || '',
    mrf_name_score: headerName ? Number(nameSimilarity(headerName, candidate.hospital_name).toFixed(3)) : '',
    mrf_address: mrfProbe && mrfProbe.mrfAddress || '',
    mrf_last_updated: mrfProbe && mrfProbe.declaredLastUpdated || '',
    mrf_cms_version: mrfProbe && mrfProbe.cmsVersion || '',
    llm_name_match: llmNameVerdict && !llmNameVerdict.error ? (llmNameVerdict.match ? 'yes' : 'no') : '',
    llm_name_confidence: llmNameVerdict && !llmNameVerdict.error ? llmNameVerdict.confidence : '',
    llm_name_reason: llmNameVerdict && (llmNameVerdict.error || llmNameVerdict.reason) || '',
    llm_name_model: llmNameVerdict && llmNameVerdict.model || '',
    llm_name_prompt_tokens: Number(llmNameVerdict && llmNameVerdict.promptTokens || 0),
    llm_name_completion_tokens: Number(llmNameVerdict && llmNameVerdict.completionTokens || 0),
    llm_name_total_tokens: Number(llmNameVerdict && llmNameVerdict.totalTokens || 0),
    request_count: 2 + (pointer && pointer.via === 'homepage-redirect' ? 1 : 0) + Number(mrfProbe && mrfProbe.requestCount || 0),
    bytes_read: Number(home && home.bytesRead || 0) + Number(pointer && pointer.bytesRead || 0) + Number(mrfProbe && mrfProbe.bytesRead || 0),
    checked_at: mrfProbe && mrfProbe.checkedAt || checkedAt,
    _pointerBody: pointer && pointer.ok ? pointer.body : ''
  };
}

function duplicateNameKeys(roster) {
  const counts = new Map();
  for (const row of roster) {
    const key = `${normalizeName(row.name || row.hospital_name)}|${row.state}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return new Set([...counts].filter(([, count]) => count > 1).map(([key]) => key));
}

function applyPromotionNotes(evidence, domains) {
  const existing = new Map();
  for (const [domain, meta] of Object.entries(domains || {})) {
    for (const ccn of meta.ccns || []) {
      if (!existing.has(ccn)) existing.set(ccn, new Set());
      existing.get(ccn).add(domain);
    }
  }
  const byCcn = new Map();
  for (const row of evidence.filter(row => row.status === 'verified' && row.resolved_domain)) {
    if (!byCcn.has(row.ccn)) byCcn.set(row.ccn, []);
    byCcn.get(row.ccn).push(row);
  }
  const verified = [];
  for (const [ccn, rows] of byCcn) {
    const domainsFound = [...new Set(rows.map(row => row.resolved_domain))];
    const mrfUrls = [...new Set(rows.map(row => row.mrf_url).filter(Boolean))];
    const prior = [...(existing.get(ccn) || [])];
    if (domainsFound.length !== 1) {
      for (const row of rows) row.promotion_note = 'multiple-verified-domains';
      continue;
    }
    if (mrfUrls.length !== 1) {
      for (const row of rows) row.promotion_note = 'mrf-conflict';
      continue;
    }
    let note = 'eligible';
    if (prior.includes(domainsFound[0])) note = 'already-assigned';
    else if (prior.length && rows[0].queue_kind === 'stale') note = 'replacement-needs-approval';
    else if (prior.length) note = 'existing-domain-conflict';
    const winner = rows.slice().sort((a, b) => Number(b.pointer_match_score || 0) - Number(a.pointer_match_score || 0))[0];
    for (const row of rows) row.promotion_note = note;
    winner.approved = '';
    if (note === 'eligible' || note === 'already-assigned' || note === 'replacement-needs-approval') verified.push(winner);
  }
  return verified.sort((a, b) => a.ccn.localeCompare(b.ccn));
}

function validatePromotionRows(rows) {
  if (!rows || !rows.length) throw new Error('No reviewed rows found');
  const invalidStatus = rows.find(row => row.status !== 'verified');
  if (invalidStatus) throw new Error(`Promotion refuses status=${invalidStatus.status || 'none'} for CCN ${invalidStatus.ccn || 'unknown'}`);
  const refused = rows.find(row => !['eligible', 'already-assigned'].includes(row.promotion_note)
    && !(row.promotion_note === 'replacement-needs-approval' && String(row.approved).toLowerCase() === 'yes'));
  if (refused) throw new Error(`Promotion refuses ${refused.promotion_note || 'unreviewed'} for CCN ${refused.ccn || 'unknown'}`);
  return rows;
}

function hospitalStatuses(jobs, evidence) {
  const priority = ['verified', 'review', 'blocked', 'site-found', 'rejected', 'none'];
  const byCcn = new Map();
  for (const row of evidence) {
    if (!byCcn.has(row.ccn)) byCcn.set(row.ccn, []);
    byCcn.get(row.ccn).push(row.status);
  }
  return new Map(jobs.map(job => {
    const statuses = byCcn.get(job.ccn) || [];
    return [job.ccn, priority.find(status => statuses.includes(status)) || 'none'];
  }));
}

function manualSearchRows(jobs, statuses) {
  return jobs.filter(job => statuses.get(job.ccn) !== 'verified').map(job => ({
    ccn: job.ccn, hospital_name: job.hospital_name, address: job.address || '',
    city: job.city || '', state: job.state || '', zip: job.zip || '',
    phone: job.phone || '', type: job.type || '', queue_kind: job.queue_kind,
    previous_domain: job.previous_domain || '', final_status: statuses.get(job.ccn) || 'none',
    phone_query: job.phone ? `"${normalizePhone(job.phone)}" hospital` : '',
    address_query: job.address ? `"${job.address}" ${job.city} ${job.state} hospital` : '',
    name_query: `"${job.hospital_name}" ${job.city} ${job.state} official website`
  }));
}

async function writeProtectedPointer(result, pointerDir) {
  if (!result._pointerBody || result.status !== 'verified') return '';
  await fsp.mkdir(pointerDir, { recursive: true });
  const file = path.join(pointerDir, `${result.resolved_domain.replace(/[^a-z0-9._-]/gi, '_')}.txt`);
  const protectedText = protectPointerTextIfEnabled(result._pointerBody);
  const inspection = inspectPointerText(protectedText);
  if (inspection.plaintext) throw new Error(`pointer privacy failure for ${result.resolved_domain}`);
  await fsp.writeFile(file, protectedText);
  return file;
}

function pointerArchiveCandidates(jobs, pointerDir) {
  const out = [];
  if (!fs.existsSync(pointerDir)) return out;
  const entries = [];
  for (const name of fs.readdirSync(pointerDir).filter(file => file.endsWith('.txt'))) {
    const domain = normalizeDomain(name.slice(0, -4));
    if (!domain) continue;
    let parsed;
    try { parsed = parsePointer(fs.readFileSync(path.join(pointerDir, name), 'utf8')); }
    catch (_error) { continue; }
    for (const entry of parsed.entries || []) entries.push({ domain, entry });
  }
  for (const job of jobs) {
    for (const item of entries) {
      const name = item.entry.locationName || '';
      const score = nameSimilarity(job.hospital_name, name);
      const strict = strictSimilarity(job.hospital_name, name);
      const exact = normalizeName(job.hospital_name) === normalizeName(name);
      if (!exact && (score < 0.75 || strict < 0.60)) continue;
      const evidence = {
        source_name: name, name_score: Number(score.toFixed(3)),
        strict_name_score: Number(strict.toFixed(3)),
        candidate_score: exact ? 90 : 50 + score * 20 + strict * 10,
        source_record_url: `data/hpt-audit/pointers/${path.basename(item.domain)}.txt`
      };
      out.push(candidateRow(job, item.domain, 'pointers', evidence));
      const pageDomain = normalizeDomain(item.entry.sourcePageUrl);
      if (pageDomain && pageDomain !== item.domain) out.push(candidateRow(job, pageDomain, 'pointers', evidence));
    }
  }
  return out;
}

function priorCandidates(jobs, rows) {
  const byCcn = new Map(jobs.map(job => [job.ccn, job]));
  const out = [];
  for (const row of rows || []) {
    const job = byCcn.get(row.ccn);
    const domain = normalizeDomain(row.domain || row.resolved_domain);
    if (!job || !domain) continue;
    out.push(candidateRow(job, domain, 'prior', {
      source_name: row.matched_location_name || row.name || '',
      name_score: Number(row.matchScore || 0),
      candidate_score: row.status === 'verified' ? 80 : row.status === 'site-found' ? 45 : 20
    }));
  }
  return out;
}

function heuristicCandidatesForJobs(jobs, generator) {
  const out = [];
  for (const job of jobs) {
    for (const item of generator({ name: job.hospital_name }, { maxPerHospital: 14 })) {
      out.push(candidateRow(job, item.domain, 'heuristic', { candidate_score: 1 }));
    }
  }
  return out;
}

function staleCandidates(jobs) {
  return jobs.filter(job => job.previous_domain)
    .map(job => candidateRow(job, job.previous_domain, 'stale', { candidate_score: 70 }));
}

function readCsvIfPresent(file) {
  try { return csvToObjects(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

function safeJson(value) {
  return JSON.stringify(value, null, 1) + '\n';
}

module.exports = {
  DEFAULT_SOURCES, SUPPORTED_SOURCES, CANDIDATE_COLUMNS, EVIDENCE_COLUMNS, VERIFIED_COLUMNS,
  MANUAL_COLUMNS, normalizeDomain, normalizePhone, normalizeState, addressAgreement, coordinates,
  haversineKm, queueRows, weightedSample, stratifiedSample, parseOsmElements,
  parseWikidataBindings, sourceCandidate, candidatesFromExternal, candidateRow,
  mergeCandidates, limitCandidates, verifyDiscoveryCandidate, duplicateNameKeys, resolveDns,
  applyPromotionNotes, validatePromotionRows, hospitalStatuses, manualSearchRows, writeProtectedPointer,
  pointerArchiveCandidates, priorCandidates, heuristicCandidatesForJobs,
  staleCandidates, readCsvIfPresent, stableHash, safeJson, guessFormat
};
