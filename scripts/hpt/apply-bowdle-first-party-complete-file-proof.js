'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofName = 'reconciliation-bowdle-first-party-complete-file-proof-2026-10-01.json';
const p = JSON.parse(fs.readFileSync(path.join(audit, proofName), 'utf8'));
const ccn = p.ccn;
const observedAt = p.observed_at;
const mrfUrl = p.file_observation.mrf_url;

const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));

const record = {
  ccn,
  observed_at: observedAt,
  proof_file: proofName,
  official_domain: 'https://bowdlehc.com/',
  pointer_url: mrfUrl,
  pointer_status: 200,
  pointer_sha256: p.file_observation.sha256_complete_file,
  pointer_entry_count: p.file_observation.rows_including_header - 1,
  pointer_entries_matching_facility: 1,
  pointer_location_name: p.file_observation.declared_location_name,
  pointer_declared_mrf_url: mrfUrl,
  facility_file_url: mrfUrl,
  file_status: 200,
  file_total_bytes: p.file_observation.total_bytes,
  file_sha256: p.file_observation.sha256_complete_file,
  declared_hospital_name: p.file_observation.declared_hospital_name,
  declared_location_name: p.file_observation.declared_location_name,
  declared_address: p.file_observation.declared_address,
  declared_type_2_npis: p.file_observation.declared_type_2_npis,
  declared_license_state: 'SD',
  declared_last_updated: '2026-04-01',
  cms_template_version: p.file_observation.cms_template_version,
  attestation: true,
  file_kind: 'csv',
  manual_identity: 'corroborated',
  manual_identity_gate: 'first-party-footer-file-complete-bytes-cms-address-state-nppes-npi-date-version-attestation-agree',
  manual_disposition: 'verified-current-mrf',
  disposition: 'verified-current-mrf',
  next_action: 'Retain the first-party footer-linked complete file chain; recheck on the next publisher file change. No bowdlehc.com cms-hpt.txt pointer was found; the avera.org pointer CSV remains access-denied and unclaimed.'
};

manual.records = manual.records.filter((x) => x.ccn !== ccn);
manual.records.push(record);
manual.records.sort((a, b) => String(a.ccn).localeCompare(String(b.ccn)));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: ccn, disposition: record.disposition, bytes: p.file_observation.total_bytes }, null, 2));
