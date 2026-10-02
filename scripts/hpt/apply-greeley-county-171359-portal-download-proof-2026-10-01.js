'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofName = 'reconciliation-greeley-county-171359-portal-download-proof-2026-10-01.json';
const observedAt = '2026-10-01T19:51:03.262Z';
const mrfUrl = 'https://minced-pricer-api.slicedhealth.com/api/v2/pricer/report';

const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));

const record = {
  ccn: '171359',
  observed_at: observedAt,
  proof_file: proofName,
  official_domain: 'https://greeley.health/',
  pointer_url: mrfUrl,
  pointer_status: 200,
  pointer_sha256: 'b99a3aef284c9e4f97f32fd7a5a5b1b9167e2de80c97d6c0c3d026e33b9f2e31',
  pointer_entry_count: null,
  pointer_entries_matching_facility: 1,
  pointer_location_name: 'Greeley County Health Services',
  pointer_declared_mrf_url: mrfUrl,
  facility_file_url: mrfUrl,
  file_status: 200,
  file_total_bytes: 11900445,
  file_sample_sha256: 'b99a3aef284c9e4f97f32fd7a5a5b1b9167e2de80c97d6c0c3d026e33b9f2e31',
  declared_hospital_name: 'Greeley County Health Services',
  declared_location_name: 'Greeley County Health Services',
  declared_address: '506 3rd St, Tribune, KS 67879',
  declared_type_2_npis: '1285742536',
  declared_license_state: 'KS',
  declared_last_updated: '2026-03-27',
  cms_template_version: '3.0.0',
  attestation: true,
  file_kind: 'csv',
  manual_identity: 'corroborated',
  manual_identity_gate: 'first-party-pricing-portal-download-complete-bytes-cms-address-state-npi-license-date-version-attestation-agree',
  manual_disposition: 'verified-current-mrf',
  disposition: 'verified-current-mrf',
  next_action: 'Retain the first-party SlicedHealth portal download chain; recheck on the next publisher file change. The generated download has no stable direct file URL (POST to minced-pricer-api.slicedhealth.com), and greeley.health cms-hpt.txt remains unpublished (404 re-probed 2026-10-01), so no CMS pointer linkage is claimed.'
};

manual.records = manual.records.filter((x) => x.ccn !== '171359');
manual.records.push(record);
manual.records.sort((a, b) => String(a.ccn).localeCompare(String(b.ccn)));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: '171359', disposition: record.disposition }, null, 2));
