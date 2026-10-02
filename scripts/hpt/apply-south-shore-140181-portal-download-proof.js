'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofName = 'reconciliation-south-shore-140181-portal-download-proof-2026-10-01.json';
const observedAt = '2026-10-01T23:00:03.777Z';
const portalUrl = 'https://apps.para-hcfs.com/PTT/FinalLinks/South_Shore_V2.aspx';
const downloadUrl = 'https://apps.para-hcfs.com/PTT/FinalLinks/Reports.aspx?dbName=dbSSHCHICAGOIL&type=CDMWithoutLabel';

const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));

const record = {
  ccn: '140181',
  observed_at: observedAt,
  proof_file: proofName,
  official_domain: 'https://www.southshorehospital.com/',
  pointer_url: portalUrl,
  pointer_status: 200,
  pointer_sha256: 'e95601e026ee6507ea8dbd8641d76b928951232be1f626dca0a5b2754f8dade0',
  pointer_entry_count: null,
  pointer_entries_matching_facility: 1,
  pointer_location_name: 'SOUTH SHORE HOSPITAL CORPORATION',
  pointer_declared_mrf_url: downloadUrl,
  facility_file_url: downloadUrl,
  file_status: 200,
  file_total_bytes: 16615006,
  file_sample_sha256: 'e95601e026ee6507ea8dbd8641d76b928951232be1f626dca0a5b2754f8dade0',
  declared_hospital_name: 'SOUTH SHORE HOSPITAL CORPORATION',
  declared_location_name: 'SOUTH SHORE HOSPITAL CORPORATION',
  declared_address: '8012 S Crandon Ave Chicago IL 60617',
  declared_type_2_npis: '1053391359',
  declared_license_state: 'IL',
  declared_last_updated: '2026-02-04',
  cms_template_version: '3.0.0',
  attestation: true,
  file_kind: 'csv',
  manual_identity: 'corroborated',
  manual_identity_gate: 'first-party-linked-portal-browser-download-complete-bytes-cms-address-state-npi-license-date-version-attestation-agree',
  manual_disposition: 'verified-current-mrf',
  disposition: 'verified-current-mrf',
  next_action: 'Retain the first-party-linked PARA portal download chain (POST Reports.aspx?dbName=dbSSHCHICAGOIL&type=CDMWithoutLabel); recheck on next publisher change. www.southshorehospital.com/cms-hpt.txt remains absent, so no CMS pointer linkage is claimed.'
};

manual.records = manual.records.filter((x) => x.ccn !== '140181');
manual.records.push(record);
manual.records.sort((a, b) => String(a.ccn).localeCompare(String(b.ccn)));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: '140181', disposition: record.disposition }, null, 2));
