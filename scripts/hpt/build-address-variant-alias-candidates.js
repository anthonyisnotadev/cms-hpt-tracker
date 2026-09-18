'use strict';

// Leads only. A matching street with different ZIPs needs independent
// publisher/campus confirmation before any reviewed resolution.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { csvToObjects } = require('./lib/util');
const { splitHeaderValues, strongAddressAgreement } = require('./lib/mrf-header-match');
const { addressHasZip } = require('./lib/address-candidate-normalize');

const root = path.resolve(__dirname, '../..');
const sources = {
  roster: 'cms_data/Hospital_General_Information.csv',
  worklist: 'data/hpt-audit/unresolved-investigation-worklist.json',
  headers: 'cms_data/hpt/nationwide-verification/mrf-headers.csv'
};
const sourceBytes = Object.fromEntries(Object.entries(sources).map(([key, relative]) =>
  [key, fs.readFileSync(path.join(root, relative))]));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const roster = new Map(csvToObjects(sourceBytes.roster.toString('utf8'))
  .map(row => [row['Facility ID'], row]));
const worklist = JSON.parse(sourceBytes.worklist.toString('utf8')).records
  .filter(row => row.evidence_gate === 'pointer-facility-match');
const headers = csvToObjects(sourceBytes.headers.toString('utf8'))
  .filter(row => ['unmatched', 'review', 'matched'].includes(row.header_status));

function declaredZip(address) {
  const withoutStreet = String(address || '').replace(/^\s*\d+\b/, '');
  return [...withoutStreet.matchAll(/\b(\d{5})(?:[- ]?\d{4})?\b/g)].map(match => match[1]);
}

function candidatesFor(item, facility, header) {
  if (!String(header.related_ccns).split('|').includes(item.ccn)
    || header.mrf_license_state !== facility.State) return [];
  const city = String(facility['City/Town'] || '').toUpperCase();
  const state = String(facility.State || '').toUpperCase();
  const zip = String(facility['ZIP Code'] || '');
  if (!city || !/^[A-Z]{2}$/.test(state) || !/^\d{5}$/.test(zip)) return [];
  return splitHeaderValues(header.mrf_address).filter(address => {
    const normalized = address.toUpperCase();
    const zips = declaredZip(address);
    return strongAddressAgreement(facility.Address, address)
      && normalized.includes(city)
      && new RegExp(`(?:^|[\\s,])${state}(?:[\\s,]|$)`).test(normalized)
      && zips.length && !addressHasZip(address, zip);
  }).map(address => {
    const url = new URL(header.mrf_url);
    const matchedCcns = String(header.header_matched_ccns || '').split('|').filter(Boolean);
    return {
      ccn: item.ccn,
      roster_name: facility['Facility Name'],
      roster_street: facility.Address,
      roster_city: facility['City/Town'],
      roster_state: state,
      roster_zip: zip,
      pointer_location_names: header.pointer_location_names,
      declared_hospital_name: header.mrf_hospital_name,
      declared_location_name: header.mrf_location_name,
      matched_declared_address: address,
      declared_zip: declaredZip(address),
      declared_license_state: header.mrf_license_state,
      declared_date: header.mrf_last_updated,
      declared_version: header.mrf_cms_version,
      source_header_status: header.header_status,
      source_header_matched_ccns: matchedCcns,
      requires_sibling_review: matchedCcns.some(ccn => ccn !== item.ccn),
      requires_multi_campus_review: new Set(splitHeaderValues(header.mrf_address)
        .map(value => value.toUpperCase().replace(/\s+/g, ' ').trim())).size > 1,
      mrf_url_sha256: sha(header.mrf_url),
      mrf_host: url.host,
      mrf_path: url.pathname,
      mrf_query_values_withheld: !!url.search,
      pointer_sha256s: String(header.pointer_sha256s || '').split('|').filter(Boolean),
      reviewed_follow_up: !!item.reviewed_follow_up,
      latest_review_at: item.latest_review_at || '',
      priority: matchedCcns.some(ccn => ccn !== item.ccn) ? 3 : item.reviewed_follow_up ? 2 : 1,
      next_action: 'Check the current first-party facility page and authoritative alias/roster ZIP history; then recheck the exact root pointer, pricing-page link and bounded file bytes. Resolve sibling and multi-campus attribution separately. Do not promote on street/city/state agreement alone.'
    };
  });
}

const candidates = [];
const seen = new Set();
for (const item of worklist) {
  const facility = roster.get(item.ccn);
  if (!facility) continue;
  for (const header of headers) {
    for (const candidate of candidatesFor(item, facility, header)) {
      const key = `${candidate.ccn}\u0000${candidate.mrf_url_sha256}\u0000${candidate.matched_declared_address}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(candidate);
    }
  }
}
candidates.sort((a, b) => a.priority - b.priority || a.ccn.localeCompare(b.ccn));
const result = {
  summary: {
    unresolved_pointer_match_ccns: worklist.length,
    candidate_pairs: candidates.length,
    candidate_ccns: new Set(candidates.map(row => row.ccn)).size,
    by_priority: Object.fromEntries([1, 2, 3].map(priority =>
      [priority, candidates.filter(row => row.priority === priority).length])),
    sibling_review_pairs: candidates.filter(row => row.requires_sibling_review).length,
    multi_campus_pairs: candidates.filter(row => row.requires_multi_campus_review).length
  },
  candidates,
  source_sha256: Object.fromEntries(Object.entries(sources).map(([key, relative]) =>
    [relative, sha(sourceBytes[key])])),
  limitation: 'These are investigation leads, not CCN-to-file assignments or compliance findings. A different roster ZIP may be a mailing address, stale roster value, or a different campus; verify independently. Query values are withheld.'
};
if (require.main === module) {
  fs.writeFileSync(path.join(root, 'data/hpt-audit/address-variant-alias-candidates.json'),
    JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result.summary));
}

module.exports = { candidatesFor, declaredZip, result };
