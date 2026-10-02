'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofName = 'reconciliation-st-marys-enid-370026-mrf-proof-2026-10-01.json';
const observedAt = '2026-10-01T23:10:13.839Z';
const pricingPage = 'https://stmarysregional.com/patients-visitors/pricing-guide';
const mrfUrl = 'https://uhsfilecdn.eskycity.net/ac/233041933_st-marys-regional-medical-center_standardcharges.csv';

const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));

const record = {
  ccn: '370026',
  observed_at: observedAt,
  proof_file: proofName,
  official_domain: 'https://stmarysregional.com/',
  pointer_url: pricingPage,
  pointer_status: 200,
  pointer_sha256: '2d1481e9fdad13dea3b63ea48edf0760a5133b474407671d421c1dc8fb5b8628',
  pointer_entry_count: null,
  pointer_entries_matching_facility: 1,
  pointer_location_name: 'St. Marys Regional Medical Center',
  pointer_declared_mrf_url: mrfUrl,
  facility_file_url: mrfUrl,
  file_status: 200,
  file_total_bytes: 23502506,
  file_sample_sha256: '2d1481e9fdad13dea3b63ea48edf0760a5133b474407671d421c1dc8fb5b8628',
  declared_hospital_name: 'UHS of Oklahoma LLC',
  declared_location_name: 'St. Marys Regional Medical Center',
  declared_address: '305 South 5th Street, Enid, OK 73701',
  declared_type_2_npis: '1417947466|1518510296|1659361475',
  declared_license_state: 'OK',
  declared_last_updated: '2026-09-01',
  cms_template_version: '3.0.0',
  attestation: true,
  file_kind: 'csv',
  manual_identity: 'corroborated',
  manual_identity_gate: 'first-party-pricing-page-links-complete-bytes-cms-address-state-npi-license-date-version-attestation-agree',
  manual_disposition: 'verified-current-mrf',
  disposition: 'verified-current-mrf',
  next_action: 'Retain the first-party pricing-page-to-UHS-CDN-file chain (pointer_sha256 here is the full-file hash; no cms-hpt.txt exists); recheck on next publisher change.'
};

manual.records = manual.records.filter((x) => x.ccn !== '370026');
manual.records.push(record);
manual.records.sort((a, b) => String(a.ccn).localeCompare(String(b.ccn)));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: '370026', disposition: record.disposition }, null, 2));
