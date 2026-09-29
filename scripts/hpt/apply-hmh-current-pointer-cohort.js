const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const observedAt = '2026-09-26T05:30:00Z';
const rows = {
  '310073': ['HMH HOSPITALS CORPORATION', 'Jersey Shore University Medical Center | Jersey Shore University Medical Center - Psychiatric Unit', '1945 NJ-33, Neptune City, NJ 07753 | 1945 NJ-33, Neptune City, NJ 07753', 'NJ', '2025-12-31', 'https://www.hackensackmeridianhealth.org/-/media/project/hmh/hmh/public/files/cdm/20260520/221487576-1790297547_hmh-hospitals-corporation_standardcharges.csv'],
  '310113': ['HMH HOSPITALS CORPORATION', 'Southern Ocean Medical Center', '1140 Route 72 West, Manahawkin, NJ 08050', 'NJ', '2025-12-31', 'https://www.hackensackmeridianhealth.org/-/media/project/hmh/hmh/public/files/cdm/20260520/221487576-1477065126_hmh-hospitals-corporation_standardcharges.csv']
};
const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
for (const [ccn, [name, location, address, state, date, url]] of Object.entries(rows)) {
  const proofFile = `reconciliation-hmh-${ccn}-current-pointer-proof-2026-09-26.json`;
  const proof = { ccn, observed_at: observedAt, official_domain: 'https://www.hackensackmeridianhealth.org/', pointer_url: 'https://hackensackmeridianhealth.org/cms-hpt.txt', pointer_status: 200, pointer_declared_mrf_url: url, mrf_url: url, mrf_status: 206, declared_hospital_name: name, declared_location_name: location, declared_address: address, declared_license_state: state, declared_last_updated: date, cms_template_version: '3.0.0', attestation: true, file_kind: 'csv', identity_basis: 'Official HMH pointer and bounded CSV header agree on facility/system name, location, exact New Jersey address, CMS 3.0.0, date fields, and attestation.', next_action: 'Retain as verified current MRF and recheck on the next pointer update.' };
  fs.writeFileSync(path.join(audit, proofFile), JSON.stringify(proof, null, 2) + '\n');
  manual.records = manual.records.filter(r => r.ccn !== ccn);
  manual.records.push({ ...proof, proof_file: proofFile, manual_disposition: 'verified-current-mrf', disposition: 'verified-current-mrf', manual_identity_gate: 'official-pointer-csv-exact-name-address-state-date-template-attestation-agree' });
}
manual.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: Object.keys(rows), count: Object.keys(rows).length }, null, 2));
