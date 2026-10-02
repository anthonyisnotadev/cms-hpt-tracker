'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofName = 'reconciliation-anson-670781-portal-download-proof-2026-10-01.json';
const observedAt = '2026-10-01T17:39:13.026Z';
const mrfUrl = 'https://us.flow-prod.boomi.com/f2a4d421-8a52-4b09-8a4c-8476aae2d651/play/ptt?flow-id=55c677ad-57f7-4e47-b22f-19d1bb1871bd&flow-version-id=b8a8e92e-d9f0-4528-8ac1-ea41bc658ef9&hospital-id=38';

const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));

const record = {
  ccn: '670781',
  observed_at: observedAt,
  proof_file: proofName,
  official_domain: 'https://ansongeneralhospital.com/',
  pointer_url: mrfUrl,
  pointer_status: 200,
  pointer_sha256: '299e31799e2218fdfcfaec5c8fa193d3294ba6a220d652633fcd76d1263d9e48',
  pointer_entry_count: null,
  pointer_entries_matching_facility: 1,
  pointer_location_name: 'Anson General Hospital',
  pointer_declared_mrf_url: mrfUrl,
  facility_file_url: mrfUrl,
  file_status: 200,
  file_total_bytes: 1551675,
  file_sample_sha256: '299e31799e2218fdfcfaec5c8fa193d3294ba6a220d652633fcd76d1263d9e48',
  declared_hospital_name: 'Anson General Hospital',
  declared_location_name: 'Anson Hospital Disctrict',
  declared_address: '101 Avenue J, Anson, TX 79501',
  declared_type_2_npis: '1457393571|1962506568',
  declared_license_state: 'TX',
  declared_last_updated: '2026-04-01',
  cms_template_version: '3.0.0',
  attestation: true,
  file_kind: 'csv',
  manual_identity: 'corroborated',
  manual_identity_gate: 'first-party-pricing-portal-download-complete-bytes-cms-address-state-npi-license-date-version-attestation-agree',
  manual_disposition: 'verified-current-mrf',
  disposition: 'verified-current-mrf',
  next_action: 'Retain the first-party Boomi portal download chain; recheck on the next publisher file change. The generated download has no stable direct file URL, and ansongeneralhospital.com cms-hpt.txt remains challenge-blocked, so no CMS pointer linkage is claimed.'
};

manual.records = manual.records.filter((x) => x.ccn !== '670781');
manual.records.push(record);
manual.records.sort((a, b) => String(a.ccn).localeCompare(String(b.ccn)));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: '670781', disposition: record.disposition }, null, 2));
