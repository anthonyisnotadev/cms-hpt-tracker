'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofName = 'reconciliation-sths-mcallen-450119-mrf-proof-2026-10-01.json';
const observedAt = '2026-10-01T23:03:40.428Z';
const pricingPage = 'https://southtexashealthsystem.com/patients-visitors/pricing-guide';
const mrfUrl = 'https://uhsfilecdn.eskycity.net/ac/233069260_south-texas-health-system-mcallen_standardcharges.csv';

const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));

const record = {
  ccn: '450119',
  observed_at: observedAt,
  proof_file: proofName,
  official_domain: 'https://southtexashealthsystem.com/',
  pointer_url: pricingPage,
  pointer_status: 200,
  pointer_sha256: '893cb69bda559ec4e3db85dc34aa282e3f3c5b1f68e061ce743bc1ed0b003080',
  pointer_entry_count: null,
  pointer_entries_matching_facility: 1,
  pointer_location_name: 'South Texas Health System McAllen',
  pointer_declared_mrf_url: mrfUrl,
  facility_file_url: mrfUrl,
  file_status: 200,
  file_total_bytes: 159214570,
  file_sample_sha256: '45e5dffc3dbfc2e1f1162127e00fd36d6c1305c5f0aa5de0db44ede27449c553',
  declared_hospital_name: 'McAllen Hospitals, LP',
  declared_location_name: 'South Texas Health System McAllen',
  declared_address: '301 West Expressway 83, McAllen, TX, 78503-3045',
  declared_type_2_npis: '1770573586',
  declared_license_state: 'TX',
  declared_last_updated: '2026-09-01',
  cms_template_version: '3.0.0',
  attestation: true,
  file_kind: 'csv',
  manual_identity: 'corroborated',
  manual_identity_gate: 'first-party-pricing-page-links-complete-bytes-cms-address-state-npi-license-date-version-attestation-agree',
  manual_disposition: 'verified-current-mrf',
  disposition: 'verified-current-mrf',
  next_action: 'Retain the first-party pricing-page-to-UHS-CDN-file chain (pointer_sha256 here is the full-file hash; the page has no cms-hpt.txt); recheck on next publisher change.'
};

manual.records = manual.records.filter((x) => x.ccn !== '450119');
manual.records.push(record);
manual.records.sort((a, b) => String(a.ccn).localeCompare(String(b.ccn)));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: '450119', disposition: record.disposition }, null, 2));
