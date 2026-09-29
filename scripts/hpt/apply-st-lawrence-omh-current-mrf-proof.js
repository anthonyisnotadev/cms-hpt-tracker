const fs = require('node:fs');
const path = require('node:path');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofName = 'reconciliation-st-lawrence-omh-current-mrf-proof-2026-09-24.json';
const p = JSON.parse(fs.readFileSync(path.join(audit, proofName), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).find(r => r.ccn === p.ccn);
if (!base) throw new Error(`Missing compliance row for ${p.ccn}`);

const evidence = {
  identity: 'corroborated',
  identity_basis: 'exact-root-pointer-location-entry-consolidated-file-metadata-and-first-party-facility-page',
  officialDomain: 'omh.ny.gov',
  sourcePageUrl: p.official_pricing_evidence,
  identityPageUrl: p.official_identity_evidence,
  pointerUrl: p.pointer_url,
  pointerSha256: p.pointer_sha256,
  pointerLocationName: p.pointer_entry.location_name,
  url: p.pointer_entry.mrf_url,
  fileSha256: p.mrf_sha256,
  fullFileBytes: p.mrf_bytes,
  http_status: p.mrf_status,
  checked_at: p.observed_at,
  date: p.mrf_row_observation.last_updated_on,
  version: p.mrf_row_observation.version,
  location_name: p.mrf_row_observation.hospital_location,
  declared_hospital_name: p.mrf_row_observation.hospital_name,
  declared_address: p.mrf_row_observation.hospital_address,
  declared_license_state: p.mrf_row_observation.license_state,
  attestation_present: true,
  file_kind: 'csv',
  observedFinding: 'date-within-365-days-version-3'
};
const entry = {
  ccn: p.ccn,
  base,
  action: 'replace',
  finding: p.disposition,
  evidence,
  evidence_run: 'st-lawrence-omh-current-pointer-consolidated-file-review-2026-09-24',
  reviewed_at: p.observed_at,
  note: p.interpretation
};

const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8')).filter(r => r.ccn !== p.ccn);
ledger.push(entry);
ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);

const obsPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const obs = JSON.parse(fs.readFileSync(obsPath, 'utf8'));
const observation = {
  ccn: p.ccn,
  observed_at: p.observed_at,
  proof_file: proofName,
  official_site: p.official_site,
  official_identity_evidence: p.official_identity_evidence,
  official_pricing_evidence: p.official_pricing_evidence,
  pointer_url: p.pointer_url,
  pointer_status: p.pointer_status,
  pointer_bytes: p.pointer_bytes,
  pointer_sha256: p.pointer_sha256,
  pointer_entry_location_name: p.pointer_entry.location_name,
  pointer_entry_mrf_url: p.pointer_entry.mrf_url,
  mrf_status: p.mrf_status,
  mrf_bytes: p.mrf_bytes,
  mrf_sha256: p.mrf_sha256,
  facility_file_url: p.pointer_entry.mrf_url,
  file_range_status: p.mrf_status,
  file_sample_bytes: p.mrf_bytes,
  file_sample_sha256: p.mrf_sha256,
  declared_hospital_name: p.mrf_row_observation.hospital_name,
  declared_location_name: p.mrf_row_observation.hospital_location,
  declared_address: p.mrf_row_observation.hospital_address,
  declared_last_updated: p.mrf_row_observation.last_updated_on,
  cms_template_version: p.mrf_row_observation.version,
  declared_license_state: p.mrf_row_observation.license_state,
  attestation: true,
  manual_identity_gate: 'exact-root-pointer-location-entry-consolidated-file-metadata-and-first-party-facility-page',
  disposition: p.disposition,
  next_action: p.next_action
};
const oi = obs.records.findIndex(r => r.ccn === p.ccn);
if (oi >= 0) obs.records[oi] = observation; else obs.records.push(observation);
obs.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(obsPath, `${JSON.stringify(obs, null, 2)}\n`);
console.log(JSON.stringify({ applied: p.ccn, finding: p.disposition, fileSha256: p.mrf_sha256 }, null, 2));
