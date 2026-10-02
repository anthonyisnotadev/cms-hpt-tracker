const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const observedAt = '2026-10-01T17:25:44.217Z';
const mrfUrl = 'https://uhsfilecdn.eskycity.net/bh/200959684_poplar-springs_standardcharges.csv';

const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));

const record = {
  ccn: '494022',
  observed_at: observedAt,
  proof_file: 'reconciliation-poplar-springs-494022-pointer-mrf-webreader-proof-2026-10-01.json',
  official_domain: 'https://poplarsprings.com/',
  pointer_url: 'https://poplarsprings.com/cms-hpt.txt',
  pointer_status: 200,
  pointer_sha256: '6dfcd7f2b54f6ddbfe1476ed78ecaf66e5f8f7c0d62f330699cd90b76539d58a',
  pointer_entry_count: 1,
  pointer_entries_matching_facility: 1,
  pointer_location_name: 'Poplar Springs Hospital',
  pointer_declared_mrf_url: mrfUrl,
  facility_file_url: mrfUrl,
  file_status: 200,
  file_sample_bytes: 12130,
  file_sample_sha256: '7102e075fa3ead1d9f637d0586d499e32a2cf3ed466810f7df60d8c35e3784df',
  declared_hospital_name: 'Poplar Springs Hospital',
  declared_location_name: 'Poplar Springs Hospital',
  declared_address: '350 Poplar Drive, Petersburg, VA 23805',
  declared_type_2_npis: '1124051701',
  declared_license_state: 'VA',
  declared_last_updated: '2026-09-25',
  cms_template_version: '3.0.0',
  attestation: true,
  file_kind: 'csv',
  manual_identity: 'corroborated',
  manual_identity_gate: 'unique-pointer-entry-name-address-state-v3-attestation-agree',
  manual_disposition: 'verified-current-mrf',
  disposition: 'verified-current-mrf',
  next_action: 'Retain the pointer-to-file chain; recheck on next publisher pointer or file change. Pointer hash is of reader-extracted text, so exact pointer wire bytes remain unestablished.'
};

manual.records = manual.records.filter(x => x.ccn !== '494022');
manual.records.push(record);
manual.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: ['494022'] }, null, 2));
