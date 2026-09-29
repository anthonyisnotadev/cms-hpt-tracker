'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { csvToObjects } = require('./lib/util');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofName = 'reconciliation-osu-medical-center-current-mrf-proof-2026-09-24.json';
const p = JSON.parse(fs.readFileSync(path.join(audit, proofName), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).find(r => r.ccn === p.ccn) || {};
const evidence = {
  identity: 'corroborated',
  identity_basis: 'current-root-pointer-exact-file-full-bytes-header-name-address-state-date-version-npi-attestation',
  officialDomain: p.official_domain,
  sourcePageUrl: p.source_page_url,
  pointerUrl: p.pointer_url,
  pointerSha256: p.pointer_sha256,
  pointerLocationName: p.pointer_location_name,
  url: p.mrf_url,
  finalUrl: p.mrf_url,
  http_status: p.mrf_status,
  checked_at: p.observed_at,
  date: p.declared_last_updated,
  version: p.cms_template_version,
  declared_hospital_name: p.declared_hospital_name,
  location_name: p.declared_location_name,
  declared_address: p.declared_address,
  declared_license_number: p.declared_license_number,
  declared_license_state: p.declared_license_state,
  declared_npi: p.declared_npi,
  file_kind: p.file_kind,
  fileSha256: p.mrf_sha256,
  fullFileBytes: p.mrf_total_bytes,
  attestationPresent: p.declared_attestation,
  observedFinding: 'date-within-365-days-version-3'
};
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const entry = {
  ccn: p.ccn,
  base,
  action: 'replace',
  finding: 'verified-current-mrf',
  evidence,
  evidence_run: 'osu-medical-center-current-pointer-file-complete-review-2026-09-24',
  reviewed_at: p.observed_at,
  note: 'The current OSUMC root pointer names Oklahoma State University Medical Center and links the exact first-party CSV. The complete 30,989,731-byte CMS 3.0.0 file declares the Tulsa Oklahoma facility, address, OK license state, NPI, attestation and 2026-04-01 update date. This is observed evidence, not a legal compliance conclusion.'
};
const index = ledger.findIndex(r => r.ccn === p.ccn);
if (index >= 0) ledger[index] = entry; else ledger.push(entry);
ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
manual.records = manual.records.filter(r => r.ccn !== p.ccn);
manual.records.push({
  ...p,
  proof_file: proofName,
  facility_file_url: p.mrf_url,
  pointer_status: p.pointer_status,
  file_range_status: 'complete-200',
  file_sample_bytes: p.mrf_total_bytes,
  file_sample_sha256: p.mrf_sha256,
  declared_hospital_name: p.declared_hospital_name,
  declared_location_name: p.declared_location_name,
  declared_address: p.declared_address,
  declared_license_state: p.declared_license_state,
  declared_last_updated: p.declared_last_updated,
  cms_template_version: p.cms_template_version,
  attestation: p.declared_attestation,
  manual_identity_gate: 'recorded-file-name-street-state-agree'
});
manual.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: p.ccn, finding: entry.finding, bytes: p.mrf_total_bytes }, null, 2));
