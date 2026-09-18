'use strict';

/**
 * Export a public, sanitized summary of the preserved domain-discovery run.
 *
 * Search results remain leads. This report deliberately omits candidate domains,
 * result titles, contact fields, and raw responses; it only records which stage
 * the evidence reached so the tracker does not equate "not promoted" with
 * "nothing was checked".
 */
const fs = require('fs');
const path = require('path');
const { csvToObjects, toCSV } = require('./lib/util');

const ROOT = path.join(__dirname, '..', '..');
const DEFAULT_COMPLIANCE = path.join(ROOT, 'data', 'hpt-audit', 'compliance.csv');
const DEFAULT_EVIDENCE = path.join(ROOT, 'data', 'hpt-audit', '.domain-discovery', 'serper-579', 'evidence.csv');
const DEFAULT_SEARCH_LEADS = path.join(ROOT, 'data', 'hpt-audit', '.domain-discovery', 'serper-579', 'search_leads.csv');
const DEFAULT_OUT = path.join(ROOT, 'data', 'hpt-audit', 'domain-observations.csv');
const COLUMNS = ['ccn', 'observation', 'search_request_recorded', 'search_error_count',
  'candidate_count', 'homepage_match_count', 'pointer_count', 'blocked_count', 'checked_at', 'evidence'];

const EVIDENCE = {
  'site-observed': 'A candidate homepage response matched hospital name text and city or state; official-domain assignment and pointer/MRF linkage remain unverified.',
  'pointer-review': 'A candidate domain returned a cms-hpt.txt file, but pointer, file, or facility identity checks did not verify this hospital.',
  'candidate-found': 'Search returned one or more candidate domains, but none passed official-domain and pointer/MRF verification.',
  'search-not-run': 'No search request is recorded for this hospital in the preserved search batch; official-domain discovery remains pending.',
  'search-error': 'The recorded website search request failed before returning usable candidate results; official-domain discovery needs a retry.',
  'no-candidate': 'The recorded search returned no usable candidate domain; the official domain remains unidentified.'
};

function summarize(ccn, rows, searchRows = []) {
  const candidates = rows.filter(row => row.candidate_domain);
  const observation = rows.some(row => row.status === 'site-found') ? 'site-observed'
    : rows.some(row => row.pointer_url) ? 'pointer-review'
      : candidates.length ? 'candidate-found'
        : !searchRows.length ? 'search-not-run'
          : searchRows.some(row => row.error) ? 'search-error' : 'no-candidate';
  const checkedAt = [...rows, ...searchRows].map(row => row.checked_at).filter(Boolean).sort().at(-1) || '';
  return {
    ccn,
    observation,
    search_request_recorded: searchRows.length ? 'yes' : 'no',
    search_error_count: searchRows.filter(row => row.error).length,
    candidate_count: candidates.length,
    homepage_match_count: rows.filter(row => row.status === 'site-found').length,
    pointer_count: rows.filter(row => row.pointer_url).length,
    blocked_count: rows.filter(row => row.status === 'blocked').length,
    checked_at: checkedAt,
    evidence: EVIDENCE[observation]
  };
}

function buildObservations(compliance, evidence, searchLeads = []) {
  const byCcn = new Map();
  for (const row of evidence) {
    if (!byCcn.has(row.ccn)) byCcn.set(row.ccn, []);
    byCcn.get(row.ccn).push(row);
  }
  const searchesByCcn = new Map();
  for (const row of searchLeads) {
    if (!searchesByCcn.has(row.ccn)) searchesByCcn.set(row.ccn, []);
    searchesByCcn.get(row.ccn).push(row);
  }
  const unresolved = compliance.filter(row => row.finding === 'not-assessed-domain-unknown');
  const missing = unresolved.filter(row => !byCcn.has(row.ccn));
  if (missing.length) throw new Error(`Domain evidence is missing ${missing.length} current CCNs (first: ${missing[0].ccn})`);
  return unresolved.map(row => summarize(row.ccn, byCcn.get(row.ccn), searchesByCcn.get(row.ccn) || []))
    .sort((a, b) => a.ccn.localeCompare(b.ccn));
}

function main() {
  // Legacy pure helpers remain solely for reproducing the original snapshot.
  // Never regenerate presentation labels from one batch or silently fall back
  // to it when the cross-run inventory is unavailable.
  if (process.argv.length > 2) throw Error('Single-batch export retired; use review-domain-cohort.js inventory/export');
  require('./review-domain-cohort').exportReview();
}

module.exports = { COLUMNS, EVIDENCE, summarize, buildObservations };
if (require.main === module) main();
