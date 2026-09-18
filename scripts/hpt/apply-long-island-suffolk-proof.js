'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const p = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-long-island-suffolk-proof.json'), 'utf8')).records[0];
if (p.ccn !== '330141' || p.pointer_http_status !== 200 || p.mrf_http_status !== 206
    || !p.pointer_sha256 || !p.bounded_header_sha256 || !p.mrf_url || p.observed_license_state !== 'NY')
  throw new Error('Incomplete Suffolk candidate proof');
const resolution = ledger.find(row => row.ccn === p.ccn);
if (!resolution || resolution.action !== 'quarantine') throw new Error(`Missing quarantine ${p.ccn}`);
const proof = {
  pointer_sha256: p.pointer_sha256, payload_sha256: p.payload_sha256,
  pointer_url: p.pointer_url, pointer_entry_name: p.pointer_entry_name, mrf_url: p.mrf_url,
  http_status: p.mrf_http_status, observed_at: p.observed_at,
  observed_hospital_name: p.observed_hospital_name, observed_location_name: p.observed_location_name,
  observed_address: p.observed_address, observed_license_state: p.observed_license_state,
  roster_hospital_name: p.roster_hospital_name, roster_address: p.roster_address,
  mrf_content_length: p.mrf_content_length, mrf_etag: p.mrf_etag,
  bounded_header_bytes: p.bounded_header_bytes, bounded_header_sha256: p.bounded_header_sha256,
  official_sources: [p.official_identity_url]
};
const note = `${p.official_identity_relationship} The current root pointer has an exact Suffolk entry and its dedicated 517,255,318-byte CSV header agrees on name, Patchogue street, New York state, 2026-01-01 date and CMS v3. The earlier Mineola assignment is wrong; the quarantine remains only until full-file structural validation.`;
resolution.superseded_resolutions = [...(resolution.superseded_resolutions || []),
  { action: resolution.action, reviewed_at: resolution.reviewed_at, note: resolution.note,
    evidence_run: resolution.evidence_run || '', proof: resolution.proof || null }];
resolution.evidence_run = 'long-island-suffolk-bounded-file-review-2026-09-15';
resolution.reviewed_at = p.observed_at;
resolution.note = note;
resolution.proof = proof;
fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
console.log(JSON.stringify({ updated: p.ccn, status: p.disposition }, null, 2));
