'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofName = 'reconciliation-streamwood-144034-mrf-proof-2026-10-01.json';
const observedAt = '2026-10-01T23:15:20.380Z';
const pricingPage = 'https://streamwoodhospital.com/standard-services';
const mrfUrl = 'https://uhsfilecdn.eskycity.net/bh/621658515_streamwood_standardcharges.csv';

const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));

const record = {
  ccn: '144034',
  observed_at: observedAt,
  proof_file: proofName,
  official_domain: 'https://streamwoodhospital.com/',
  pointer_url: pricingPage,
  pointer_status: 200,
  pointer_sha256: '17b313eb05c6e91c8fbd212d07b95cdcc18fe5e589bdd1d1fcbd2667876561bf',
  pointer_entry_count: null,
  pointer_entries_matching_facility: 1,
  pointer_location_name: 'Streamwood Behavioral Healthcare System',
  pointer_declared_mrf_url: mrfUrl,
  facility_file_url: mrfUrl,
  file_status: 200,
  file_total_bytes: 57603,
  file_sample_sha256: '17b313eb05c6e91c8fbd212d07b95cdcc18fe5e589bdd1d1fcbd2667876561bf',
  declared_hospital_name: 'Streamwood Behavioral Healthcare System',
  declared_location_name: 'Streamwood Behavioral Healthcare System',
  declared_address: '1400 EAST IRVING PARK ROAD, STREAMWOOD, IL 60107',
  declared_type_2_npis: '1619916822',
  declared_license_state: 'IL',
  declared_last_updated: '2026-06-03',
  cms_template_version: '3.0.0',
  attestation: true,
  file_kind: 'csv',
  manual_identity: 'corroborated',
  manual_identity_gate: 'first-party-page-links-complete-bytes-cms-address-state-npi-license-date-version-attestation-agree',
  manual_disposition: 'verified-current-mrf',
  disposition: 'verified-current-mrf',
  next_action: 'Retain the first-party standard-services-page-to-UHS-CDN-file chain (pointer_sha256 here is the full-file hash; no cms-hpt.txt exists); recheck on next publisher change. The Report Card closed-flag adjudication remains a separate open question.'
};

manual.records = manual.records.filter((x) => x.ccn !== '144034');
manual.records.push(record);
manual.records.sort((a, b) => String(a.ccn).localeCompare(String(b.ccn)));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: '144034', disposition: record.disposition }, null, 2));
