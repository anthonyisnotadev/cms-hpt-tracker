'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofName = 'reconciliation-st-simons-114016-mrf-proof-2026-10-01.json';
const observedAt = '2026-10-01T23:06:02.570Z';
const pricingPage = 'https://ssbythesea.com/standard-services';
const mrfUrl = 'https://uhsfilecdn.eskycity.net/bh/203854107_st-simons_standardcharges.csv';

const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));

const record = {
  ccn: '114016',
  observed_at: observedAt,
  proof_file: proofName,
  official_domain: 'https://ssbythesea.com/',
  pointer_url: pricingPage,
  pointer_status: 200,
  pointer_sha256: '3bd35392d519be17b2ab8522ecbd08b39fe74bde73ef463a890b6583a3bff2eb',
  pointer_entry_count: null,
  pointer_entries_matching_facility: 1,
  pointer_location_name: 'Saint Simons By-The-Sea',
  pointer_declared_mrf_url: mrfUrl,
  facility_file_url: mrfUrl,
  file_status: 200,
  file_total_bytes: 45624,
  file_sample_sha256: '3bd35392d519be17b2ab8522ecbd08b39fe74bde73ef463a890b6583a3bff2eb',
  declared_hospital_name: 'Saint Simons By-The-Sea',
  declared_location_name: 'Saint Simons By-The-Sea',
  declared_address: '2927 DEMERE ROAD, ST SIMONS ISLAND, GA 31522',
  declared_type_2_npis: '1972557916',
  declared_license_state: 'GA',
  declared_last_updated: '2026-06-10',
  cms_template_version: '3.0.0',
  attestation: true,
  file_kind: 'csv',
  manual_identity: 'corroborated',
  manual_identity_gate: 'first-page-links-complete-bytes-cms-address-state-npi-license-date-version-attestation-agree',
  manual_disposition: 'verified-current-mrf',
  disposition: 'verified-current-mrf',
  next_action: 'Retain the first-party standard-services-page-to-UHS-CDN-file chain (pointer_sha256 here is the full-file hash; no cms-hpt.txt exists); recheck on next publisher change.'
};

manual.records = manual.records.filter((x) => x.ccn !== '114016');
manual.records.push(record);
manual.records.sort((a, b) => String(a.ccn).localeCompare(String(b.ccn)));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: '114016', disposition: record.disposition }, null, 2));
