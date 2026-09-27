const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofFile = 'reconciliation-omh-greater-binghamton-current-pointer-proof-2026-09-26.json';
const proof = {
  ccn: '334012', observed_at: '2026-09-26T00:15:00Z', official_domain: 'https://omh.ny.gov/',
  pointer_url: 'https://omh.ny.gov/cms-hpt.txt', pointer_status: 200,
  pointer_declared_mrf_url: 'https://omh.ny.gov/omhweb/adults/141663311_nysomh_standardcharges.csv',
  mrf_url: 'https://omh.ny.gov/omhweb/adults/141663311_nysomh_standardcharges.csv', mrf_status: 206,
  declared_hospital_name: 'Greater Binghamton Mental Health Facility', declared_location_name: 'Greater Binghamton',
  declared_address: '425 Robinson St, Binghamton, NY 13904', declared_license_state: 'NY',
  declared_last_updated: '2026-05-28', cms_template_version: '3.0.0', attestation: true, file_kind: 'csv',
  identity_basis: 'The official OMH pointer and bounded CSV header agree on the Greater Binghamton facility name, location, exact address, New York state, 2026-05-28 update date, CMS 3.0.0, and attestation. The shared file is not applied to the other OMH facilities.',
  next_action: 'Retain as verified current MRF and recheck the shared pointer; keep other shared-file facilities unresolved until facility-specific evidence exists.'
};
fs.writeFileSync(path.join(audit, proofFile), JSON.stringify(proof, null, 2) + '\n');
const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
manual.records = manual.records.filter(r => r.ccn !== proof.ccn);
manual.records.push({ ...proof, proof_file: proofFile, manual_disposition: 'verified-current-mrf', disposition: 'verified-current-mrf', manual_identity_gate: 'official-pointer-shared-csv-exact-name-address-state-date-template-attestation-agree' });
manual.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: proof.ccn }, null, 2));
