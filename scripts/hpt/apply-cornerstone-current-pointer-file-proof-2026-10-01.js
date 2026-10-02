'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
const ccn = '450825';
const record = {
  ccn,
  observed_at: '2026-10-01T18:45:09.847Z',
  proof_file: 'reconciliation-cornerstone-current-pointer-file-proof-2026-10-01.json',
  official_domain: 'https://cornerstoneregional.com/',
  official_facility_name: 'CORNERSTONE REGIONAL HOSPITAL',
  official_facility_address: '2302 Cornerstone Boulevard, Edinburg, TX 78539',
  pointer_url: 'https://cornerstoneregional.com/cms-hpt.txt',
  pointer_status: 200,
  pointer_sha256: '54B6F6F242DEA6184C03CBBDAA8F202817E798452428FB698D75C7A35A4DEAA1',
  pointer_location_name: 'Cornerstone Regional Hospital',
  pointer_declared_mrf_url: 'https://uhsfilecdn.eskycity.net/ac/742829611_cornerstone-regional-hospital_standardcharges.csv',
  pointer_entry_count: 1,
  pointer_entries_matching_facility: 1,
  facility_file_url: 'https://uhsfilecdn.eskycity.net/ac/742829611_cornerstone-regional-hospital_standardcharges.csv',
  file_status: 200,
  file_bytes: 171856,
  file_sha256: '2FF5EE61DE8DA77339E1DA28E99369BB2EBB9D5C9F98ABCB74C97B74B01E9240',
  declared_hospital_name: 'Cornerstone Regional Hospital',
  declared_location_name: 'Cornerstone Regional Hospital',
  declared_address: '2302 Cornerstone Boulevard, Edinburg, TX 78539',
  declared_license_number: '830',
  declared_license_state: 'TX',
  declared_type_2_npis: '1386652527',
  declared_last_updated: '2026-09-01',
  cms_template_version: '3.0.0',
  attestation: true,
  file_kind: 'csv',
  pointer_transport_note: 'Pointer retrieved via web-reader MCP; curl remains 403-blocked, so pointer_sha256 is of reader-extracted text, not wire bytes. The complete MRF was fetched directly with exact bytes and SHA-256.',
  manual_identity: 'corroborated',
  manual_identity_gate: 'exact-pointer-file-name-address-state-v3-attestation-agree',
  manual_disposition: 'verified-current-mrf',
  disposition: 'verified-current-mrf',
  next_action: 'Retain the exact pointer/file chain and recheck on the next publisher pointer or file change.'
};
manual.records = manual.records.filter(x => x.ccn !== ccn);
manual.records.push(record);
manual.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: ccn, disposition: record.disposition }, null, 2));
