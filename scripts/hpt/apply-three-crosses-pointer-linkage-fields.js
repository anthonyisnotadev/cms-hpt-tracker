'use strict';

// Adds the pointer-linkage fields the nationwide build consumes (pointer_* / manual_identity)
// to the 2026-10-01 Three Crosses (CCN 320091) observation. The original apply script recorded
// the pointer under latest_pointer_file_recheck only, so the build kept
// pointer-facility-match-unresolved. Idempotent; touches only CCN 320091.
const fs = require('node:fs');
const path = require('node:path');

const audit = path.resolve(__dirname, '../../data/hpt-audit');
const proofName = 'reconciliation-three-crosses-current-full-file-validated-proof-2026-10-01.json';
const proof = JSON.parse(fs.readFileSync(path.join(audit, proofName), 'utf8'));
const ptr = proof.pointer_observation;
const full = proof.current_mrf_full_file_review;
if (proof.ccn !== '320091' || ptr?.sha256?.toLowerCase() !== '57e6d622c5971878d51be47e1baf13bf82c6c7a0ba86734e044f172cea282fde'
  || ptr.content?.['mrf-url'] !== full?.url) {
  throw new Error('Three Crosses pointer/full-file proof changed; review before applying');
}

const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const doc = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
const rec = doc.records.find((r) => r.ccn === '320091' && r.observed_at === proof.observed_at && r.full_file_validated);
if (!rec) throw new Error('320091 observation for this proof not found; run apply-three-crosses-current-full-file-proof.js first');

Object.assign(rec, {
  official_domain: 'https://www.threecrossesregional.com/',
  pointer_url: ptr.url,
  pointer_status: ptr.http_status,
  pointer_sha256: ptr.sha256.toLowerCase(),
  pointer_entry_count: 1,
  pointer_entries_matching_facility: 1,
  pointer_location_name: ptr.content['location-name'],
  pointer_declared_mrf_url: ptr.content['mrf-url'],
  facility_file_url: full.url,
  file_status: full.http_status,
  declared_type_2_npis: full.required_header.type_2_npi,
  attestation: true,
  manual_identity: 'corroborated'
});
fs.writeFileSync(manualPath, JSON.stringify(doc, null, 2) + '\n');
console.log('320091 pointer-linkage fields applied');
