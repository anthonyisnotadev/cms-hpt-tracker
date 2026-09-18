'use strict';

// Leads only: a street/ZIP match cannot by itself prove that a file belongs to a CCN.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');
const { compactStreet, compactSiteStreet, addressHasZip } = require('./lib/address-candidate-normalize');

const root = path.resolve(__dirname, '../..');
const sources = {
  roster: 'cms_data/Hospital_General_Information.csv',
  worklist: 'data/hpt-audit/unresolved-investigation-worklist.json',
  headers: 'cms_data/hpt/nationwide-verification/mrf-headers.csv',
};
const bytes = Object.fromEntries(Object.entries(sources).map(([key, relative]) =>
  [key, fs.readFileSync(path.join(root, relative))]));
const roster = new Map(csvToObjects(bytes.roster.toString('utf8')).map(row => [row['Facility ID'], row]));
const worklist = JSON.parse(bytes.worklist.toString('utf8')).records
  .filter(row => row.evidence_gate === 'pointer-facility-match');
const headers = csvToObjects(bytes.headers.toString('utf8'))
  .filter(row => ['unmatched', 'review', 'matched'].includes(row.header_status));
const candidates = [];
const seen = new Set();
for (const item of worklist) {
  const facility = roster.get(item.ccn);
  if (!facility) continue;
  const street = compactSiteStreet(facility.Address);
  const zip = facility['ZIP Code'];
  if (street.length < 6 || !/^\d{5}$/.test(zip)) continue;
  for (const header of headers) {
    const matchedAddress = String(header.mrf_address || '').split('|').find(address =>
      compactStreet(address).includes(street) && addressHasZip(address, zip));
    if (!String(header.related_ccns).split('|').includes(item.ccn)
        || header.mrf_license_state !== facility.State
        || !matchedAddress) continue;
    const key = `${item.ccn}\u0000${header.mrf_url}\u0000${header.mrf_address}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const matchedCcns = String(header.header_matched_ccns || '').split('|').filter(Boolean);
    candidates.push({
      ccn: item.ccn, roster_name: facility['Facility Name'], roster_address: facility.Address,
      roster_city: facility['City/Town'], roster_state: facility.State, roster_zip: zip,
      pointer_location_names: header.pointer_location_names,
      declared_hospital_name: header.mrf_hospital_name,
      declared_address: header.mrf_address, matched_declared_address: matchedAddress,
      declared_state: header.mrf_license_state,
      declared_date: header.mrf_last_updated, declared_version: header.mrf_cms_version,
      mrf_url: header.mrf_url, source_header_status: header.header_status,
      source_header_matched_ccns: matchedCcns,
      requires_sibling_review: matchedCcns.some(ccn => ccn !== item.ccn),
      requires_multi_campus_review: header.mrf_address.includes('|') || header.pointer_location_names.includes('|'),
      candidate_kind: item.reviewed_follow_up ? 'already-reviewed-follow-up' : 'new-address-lead',
      reviewed_sources: item.reviewed_sources || [],
      latest_review_at: item.latest_review_at || '',
      next_action: item.reviewed_follow_up
        ? `${item.next_action} Do not promote on address and ZIP alone.`
        : 'Verify the current first-party facility identity and rename/ownership history, then independently recheck root pointer, pricing-page link and bounded file bytes. If the header matched another CCN, distinguish its campus and enrollment. Do not promote on address and ZIP alone.',
    });
  }
}
candidates.sort((a, b) => a.ccn.localeCompare(b.ccn) || a.mrf_url.localeCompare(b.mrf_url));
const source_sha256 = Object.fromEntries(Object.entries(bytes).map(([key, data]) =>
  [sources[key], crypto.createHash('sha256').update(data).digest('hex')]));
const output = {
  summary: { unresolved_pointer_match_ccns: worklist.length, candidate_pairs: candidates.length,
    candidate_ccns: new Set(candidates.map(row => row.ccn)).size,
    new_address_lead_pairs: candidates.filter(row => row.candidate_kind === 'new-address-lead').length,
    already_reviewed_follow_up_pairs: candidates.filter(row => row.candidate_kind === 'already-reviewed-follow-up').length,
    multi_campus_pairs: candidates.filter(row => row.requires_multi_campus_review).length,
    sibling_review_pairs: candidates.filter(row => row.requires_sibling_review).length,
    by_header_status: Object.fromEntries(['unmatched', 'review', 'matched'].map(status =>
      [status, candidates.filter(row => row.source_header_status === status).length])) },
  candidates, source_sha256,
  limitation: 'A normalized base street and exact five-digit ZIP match, including a ZIP+4 address or an omitted suite, is a lead, not a facility identity adjudication or verified MRF assignment. A header already matched to a sibling CCN or reviewed for conflict requires explicit campus and enrollment adjudication.',
};
const target = path.join(root, 'data/hpt-audit/exact-address-alias-candidates.json');
fs.writeFileSync(target, JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify(output.summary));
