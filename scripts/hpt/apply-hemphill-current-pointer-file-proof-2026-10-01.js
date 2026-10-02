'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const observedAt = '2026-10-01T19:45:04.867Z';
const proofFile = 'reconciliation-hemphill-current-pointer-file-proof-2026-10-01.json';

const p = JSON.parse(fs.readFileSync(path.join(audit, proofFile), 'utf8'));

const fileBytes = fs.readFileSync(path.join(root, 'tmp/autonomy/hcchd-declared-mrf.csv'));
const fileSha = crypto.createHash('sha256').update(fileBytes).digest('hex');
if (fileBytes.length !== p.facility_file_full_bytes || fileSha !== p.facility_file_full_sha256) {
  throw new Error('Hemphill declared-MRF bytes do not match proof');
}
if (p.facility_file_license_state !== 'TX' || p.facility_file_cms_template_version !== '3.0.0' || !p.facility_file_attestation) {
  throw new Error('Incomplete Hemphill MRF proof');
}

const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));

const record = {
  ccn: '671301',
  observed_at: observedAt,
  proof_file: proofFile,
  official_domain: 'https://hchdst.org/',
  pointer_url: p.pointer_url,
  pointer_status: 200,
  pointer_sha256: p.pointer_sha256,
  pointer_entry_count: 1,
  pointer_entries_matching_facility: 1,
  pointer_location_name: p.pointer_location_name,
  pointer_declared_mrf_url: p.pointer_declared_mrf_url,
  facility_file_url: p.facility_file_url,
  file_status: 200,
  file_full_bytes: p.facility_file_full_bytes,
  file_full_sha256: p.facility_file_full_sha256,
  file_sample_bytes: p.facility_file_full_bytes,
  file_sample_sha256: p.facility_file_full_sha256,
  declared_hospital_name: p.facility_file_declared_name,
  declared_location_name: p.facility_file_declared_location_name,
  declared_address: p.facility_file_declared_address,
  declared_type_2_npis: p.facility_file_declared_type_2_npis,
  declared_license_state: p.facility_file_license_state,
  declared_license_number: p.facility_file_declared_license_number,
  declared_last_updated: p.facility_file_declared_last_updated,
  cms_template_version: p.facility_file_cms_template_version,
  attestation: true,
  file_kind: 'csv',
  manual_identity: 'corroborated',
  manual_identity_gate: 'unique-pointer-entry-name-address-state-v3-attestation-agree',
  manual_disposition: 'verified-current-mrf',
  disposition: 'verified-current-mrf',
  next_action: 'Retain the pointer-to-file chain; recheck on next publisher pointer or file change. Pointer hash is of same-origin in-browser fetched text; direct curl GET of the pointer and site returns a 202 robot challenge.'
};

manual.records = manual.records.filter(x => x.ccn !== '671301');
manual.records.push(record);
manual.records.sort((a, b) => String(a.ccn).localeCompare(String(b.ccn)));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: '671301', disposition: record.disposition, fileSha256: fileSha }, null, 2));
