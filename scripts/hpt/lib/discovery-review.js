'use strict';
const crypto = require('crypto');

// These are discovery observations, never compliance verdicts. A reviewed
// resolution remains the only route from this review into an assessed tier.
const LABELS = {
  'official-hpt-pending': 'Official website identified; HPT review pending',
  'candidate-identity-unverified': 'Candidate website; identity unverified',
  'pointer-client-denied': 'Pointer access denied to this client',
  'pointer-not-retrieved': 'Pointer not retrieved from checked locations',
  'pointer-match-unresolved': 'Pointer found; hospital match unresolved',
  'mrf-request-failed': 'MRF request failed',
  'mrf-verification-pending': 'MRF verification pending',
  'search-completed-no-official': 'Official website not identified in completed search',
  'request-tool-failure': 'Discovery incomplete due to request/tool failure',
  // An honest progress state, not a substituted outcome for unfinished work.
  'review-pending': 'Discovery evidence awaiting review'
};
const finding = key => 'not-assessed-discovery-' + key;
const GENERIC_NAME_WORDS = new Set(['hospital', 'hosp', 'medical', 'med', 'center', 'centre', 'ctr', 'health', 'healthcare', 'system', 'systems', 'campus', 'facility', 'inc', 'llc', 'ltd', 'the', 'of', 'and']);
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
const digest = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

function normalizeWords(value) {
  return String(value || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
}

/** Parse the deliberately small CMS pointer grammar without retaining contacts. */
function parsePointerEntries(body) {
  const text = String(body || '').replace(/\r\n?|\n/g, '\n');
  if (!text || /<html|<!doctype/i.test(text.slice(0, 1000))) return [];
  if (/^\s*[\[{]/.test(text)) {
    try {
      const json = JSON.parse(text);
      const rows = Array.isArray(json) ? json : Array.isArray(json.locations) ? json.locations : [json];
      return rows.map(row => ({
        location_name: row['location-name'] || row.location_name || row.locationName || '',
        source_page_url: row['source-page-url'] || row.source_page_url || row.sourcePageUrl || '',
        mrf_url: row['mrf-url'] || row.mrf_url || row.mrfUrl || ''
      })).filter(row => row.location_name && row.mrf_url);
    } catch (_e) { return []; }
  }
  const entries = [];
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(location-name|source-page-url|mrf-url)\s*:\s*(.*?)\s*$/i);
    if (!match) {
      // Some publishers put only the URL on the line after an empty mrf-url.
      // Accept one immediate standalone HTTP(S) URL, never arbitrary text.
      const continuation = line.trim();
      if (current?.awaiting_mrf_url && /^https?:\/\/\S+$/i.test(continuation)) current.mrf_url = continuation;
      if (current) current.awaiting_mrf_url = false;
      continue;
    }
    const key = match[1].toLowerCase(), value = match[2];
    if (key === 'location-name') {
      if (current?.location_name && current.mrf_url) entries.push(current);
      current = { location_name: value, source_page_url: '', mrf_url: '', awaiting_mrf_url: false };
    } else if (current && key === 'source-page-url') current.source_page_url = value;
    else if (current && key === 'mrf-url') {
      current.mrf_url = value;
      current.awaiting_mrf_url = !value;
    }
  }
  if (current?.location_name && current.mrf_url) entries.push(current);
  return entries.map(({ awaiting_mrf_url, ...entry }) => entry);
}

/** Conservative lexical facility match; aliases must be supplied explicitly. */
function matchPointerEntry(hospitalName, entries, aliases = []) {
  const targets = [hospitalName, ...aliases].map(name => normalizeWords(name).filter(word => !GENERIC_NAME_WORDS.has(word)));
  let best = null;
  for (const entry of entries || []) {
    const words = normalizeWords(entry.location_name).filter(word => !GENERIC_NAME_WORDS.has(word));
    for (const target of targets) {
      if (!target.length || !words.length) continue;
      const hits = target.filter(word => words.includes(word));
      const targetCoverage = hits.length / target.length;
      const entryCoverage = hits.length / words.length;
      const exactPhrase = target.join(' ') === words.join(' ');
      const qualified = exactPhrase || (hits.length >= 1 && targetCoverage >= 0.6 && entryCoverage >= 0.5);
      const score = targetCoverage + entryCoverage + (exactPhrase ? 1 : 0);
      if (qualified && (!best || score > best.score)) best = { entry, score, matched_words: hits };
    }
  }
  return best;
}

// Only identical observations are merged. Distinct dates, conflicting results,
// and responses from different URLs are not votes and must remain visible.
function reconcile(entries) {
  const by = new Map();
  for (const entry of entries) {
    const id = digest(entry.observation);
    if (!by.has(id)) by.set(id, { id, observation: entry.observation, sources: [] });
    const row = by.get(id);
    row.sources = [...new Set([...row.sources, ...(entry.sources || [])])].sort();
  }
  return [...by.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function classify(review) {
  if (!review || !review.reviewed_at) return 'review-pending';
  if (!Number.isFinite(Date.parse(review.reviewed_at)) || !review.reason || !review.next_action || !review.sources?.length)
    throw Error('Reviewed discovery requires a valid date, reason, sources, and next action');
  const official = review.website?.identity === 'corroborated';
  if (official && (!review.website.domain || !review.website.name_evidence || !review.website.address_evidence))
    throw Error('Official website requires first-party name and address evidence for this CCN');
  if (review.website?.identity === 'conflict' && review.file?.facility_linked)
    throw Error('Conflicting facility identity cannot qualify a file');
  if (official) {
    const pointer = review.pointer || {}, file = review.file || {};
    if (file.facility_linked && !pointer.facility_matched) throw Error('File link requires matched official pointer evidence');
    if (file.facility_linked && file.retrieved) return 'mrf-verification-pending';
    if (file.facility_linked && file.attempted && (file.error || Number(file.http_status) >= 400)) return 'mrf-request-failed';
    if (pointer.retrieved && !pointer.facility_matched) return 'pointer-match-unresolved';
    const attempts = pointer.attempts || [];
    // Status 0 is a transport/tool failure, never a server denial or absence.
    if (pointer.confirmed_url && attempts.some(a => a.url === pointer.confirmed_url && [401, 403, 429].includes(Number(a.http_status)))) return 'pointer-client-denied';
    if (pointer.locations_complete && attempts.length && attempts.every(a => a.official_location && a.usable === false && Number(a.http_status) > 0 && !a.error)) return 'pointer-not-retrieved';
    if (attempts.length && attempts.some(a => !Number(a.http_status) || a.error)) return 'request-tool-failure';
    return 'official-hpt-pending';
  }
  if (review.website?.plausible) return 'candidate-identity-unverified';
  if (review.search?.completed && review.search?.results_adjudicated && !review.search?.error) return 'search-completed-no-official';
  if (review.search?.error || review.retrieval?.error) return 'request-tool-failure';
  return 'review-pending';
}

function applyDiscoveryReviews(rows, reviews = []) {
  const by = new Map();
  for (const r of reviews) {
    if (by.has(r.ccn)) throw Error('Duplicate discovery review ' + r.ccn);
    if (!LABELS[r.disposition]) throw Error('Unknown discovery disposition ' + r.disposition);
    by.set(r.ccn, r);
  }
  return rows.map(row => {
    const r = by.get(row.ccn);
    // Compare with the whole frozen crawl, including a changed domain or date.
    // This also prevents overriding an already applied reviewed resolution.
    if (!r || digest(row) !== r.base_sha256 || row.finding !== 'not-assessed-domain-unknown') return row;
    if (r.reviewed_at && (!Number.isFinite(Date.parse(r.reviewed_at)) || (row.checked_at && Date.parse(row.checked_at) > Date.parse(r.reviewed_at)))) return row;
    return { ...row, finding: finding(r.disposition), assessable: 'no',
      evidence: r.reason + ' Next: ' + r.next_action,
      // Generation time is not a website observation date.
      checked_at: r.observed_at || row.checked_at };
  });
}

module.exports = { LABELS, finding, digest, reconcile, classify, applyDiscoveryReviews, parsePointerEntries, matchPointerEntry };
