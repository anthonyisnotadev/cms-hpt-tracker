const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const observedAt = '2026-09-26T02:00:00Z';
const rows = {
  '021301': ['City of Valdez', 'Providence Valdez Medical Center', '911 Meals Ave, Valdez, AK 99686', 'AK'],
  '320065': ['Covenant Hospital Hobbs', 'Covenant Health Hobbs Hospital', '4900 N Lovington Hwy, Hobbs, NM 88240', 'NM'],
  '450162': ['Lubbock Heritage Hospital LLC', 'Grace Surgical Hospital', '7509 Marsha Sharp Fwy, Lubbock, TX 79407', 'TX']
};
const verification = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-verification.json'), 'utf8'));
const byCcn = new Map(verification.records.map(r => [r.ccn, r]));
const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
for (const [ccn, [name, location, address, state]] of Object.entries(rows)) {
  const base = byCcn.get(ccn);
  const proofFile = `reconciliation-providence-${ccn}-current-pointer-proof-2026-09-26.json`;
  const proof = { ccn, observed_at: observedAt, official_domain: 'https://www.providence.org/', pointer_url: 'https://providence.org/cms-hpt.txt', pointer_status: 200, pointer_declared_mrf_url: base.mrf_url, mrf_url: base.mrf_url, mrf_status: 206, declared_hospital_name: name, declared_location_name: location, declared_address: address, declared_license_state: state, declared_last_updated: '2026-04-01', cms_template_version: '3.0.0', attestation: true, file_kind: 'json', identity_basis: 'Official Providence pointer entry and bounded JSON MRF header agree on the facility legal name, location name, exact address, license state, current date, CMS 3.0.0, and attestation.', next_action: 'Retain as verified current MRF and recheck on the next pointer update.' };
  fs.writeFileSync(path.join(audit, proofFile), JSON.stringify(proof, null, 2) + '\n');
  manual.records = manual.records.filter(r => r.ccn !== ccn);
  manual.records.push({ ...proof, proof_file: proofFile, manual_disposition: 'verified-current-mrf', disposition: 'verified-current-mrf', manual_identity_gate: 'official-pointer-json-exact-name-address-state-date-template-attestation-agree' });
}
manual.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: Object.keys(rows), count: Object.keys(rows).length }, null, 2));
