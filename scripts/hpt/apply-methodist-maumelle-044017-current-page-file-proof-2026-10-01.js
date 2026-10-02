'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
const ccn = '044017';
const record = {
  ccn,
  observed_at: '2026-10-01T20:29:40.000Z',
  proof_file: 'reconciliation-methodist-maumelle-current-page-file-proof-2026-10-01.json',
  official_domain: 'https://www.methodistfamily.org/',
  official_facility_name: "Methodist Children's Behavioral Hospital-Maumelle (renamed from United Methodist Behavioral Hospital, documented by operator history)",
  official_facility_address: '1601 Murphy Drive, Maumelle, AR 72113',
  source_page_url: 'https://www.methodistfamily.org/transparency-in-coverage-rule/',
  pointer_url: 'https://www.methodistfamily.org/cms-hpt.txt',
  pointer_status: 200,
  pointer_sha256: '43f797eb6f926cd2951af073b350ad2b3abaa26c331392fff54e74b1d369e099',
  pointer_location_name: 'United Methodist Behavioral Health System',
  pointer_declared_mrf_url: 'https://www.methodistfamily.org/transparency-in-coverage-rule/710855633_united_methodist_behavioral_health_system_standardcharges.csv',
  pointer_declared_mrf_status: 404,
  pointer_entry_count: 1,
  pointer_entries_matching_facility: 0,
  facility_file_url: 'https://www.methodistfamily.org/wp-content/uploads/2026/09/710855633_united_methodist_behavioral_health_system_standardcharges.csv',
  file_status: 200,
  file_bytes: 10387,
  file_sha256: '5afbb4ddea2d19d9b9cdb7612862e7c4a1667a01710206e3d9c1b271e94fa8ce',
  declared_hospital_name: "Methodist Children's Behavioral Hospital-Maumelle",
  declared_location_name: "Methodist Children's Behavioral Hospital-Maumelle",
  declared_address: '1601 Murphy Drive, Maumelle, AR  72113',
  declared_license_number: '4089',
  declared_license_state: 'AR',
  declared_type_2_npis: '1063415800',
  declared_last_updated: '2026-09-01',
  cms_template_version: '3.0.0',
  attestation: true,
  file_kind: 'csv',
  pointer_transport_note: 'Root pointer live but stale: its declared mrf-url returns 404; the source page links the current CSV at /wp-content/uploads/2026/09/. Complete file bytes fetched and hashed.',
  manual_identity: 'corroborated',
  manual_identity_gate: 'exact-page-file-name-address-state-v3-attestation-agree-with-documented-2025-rename',
  manual_disposition: 'verified-current-page-file-pointer-stale',
  disposition: 'verified-current-page-file-pointer-stale',
  next_action: 'Retain the page-file chain and recheck if the publisher corrects the pointer mrf-url or replaces the CSV.'
};
manual.records = manual.records.filter((x) => x.ccn !== ccn);
manual.records.push(record);
manual.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: ccn, disposition: record.disposition }, null, 2));
