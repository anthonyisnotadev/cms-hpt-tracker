const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const observedAt = '2026-09-26T02:50:00Z';
const rows = {
  '503301': ['Mary Bridge Children\'s Hospital', 'MultiCare Mary Bridge Children\'s Hospital', '317 Martin Luther King Jr Way, Tacoma, WA 98405', 'WA'],
  '500015': ['MultiCare Auburn Medical Center', 'MultiCare Auburn Medical Center', '202 North Division Street, Auburn, WA 98001', 'WA'],
  '500129': ['Tacoma General Allenmore Hospital', 'MulitCare Allenmore Hospital; MultiCare Tacoma General Hospital; MultiCare Tacoma General Emergency Federal Way; MultiCare Tacoma General Emergency Bremerton', '1901 South Union, Tacoma, WA 98405; 315 Martin Luther King Jr. Way, Tacoma, WA 98405; 29805 Pacific Hwy S, Federal Way, WA 98003; 5900 State Highway 303 NE, Bremerton, WA 98311', 'WA']
};
const verification = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-verification.json'), 'utf8'));
const byCcn = new Map(verification.records.map(r => [r.ccn, r]));
const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
for (const [ccn, [name, location, address, state]] of Object.entries(rows)) {
  const base = byCcn.get(ccn);
  const proofFile = `reconciliation-multicare-${ccn}-current-pointer-proof-2026-09-26.json`;
  const proof = { ccn, observed_at: observedAt, official_domain: 'https://www.multicare.org/', pointer_url: 'https://multicare.org/cms-hpt.txt', pointer_status: 200, pointer_declared_mrf_url: base.mrf_url, mrf_url: base.mrf_url, mrf_status: 206, declared_hospital_name: name, declared_location_name: location, declared_address: address, declared_license_state: state, declared_last_updated: '2026-08-27', cms_template_version: '3.0.0', attestation: true, file_kind: 'csv', identity_basis: ccn === '500129' ? 'Official MultiCare pointer and CSV header identify the Tacoma General Allenmore file and preserve its four declared locations and Washington license state.' : 'Official MultiCare pointer and CSV header agree on facility name, location, exact address, Washington license state, current date, CMS 3.0.0, and attestation.', next_action: 'Retain as verified current MRF and recheck on the next pointer update.' };
  fs.writeFileSync(path.join(audit, proofFile), JSON.stringify(proof, null, 2) + '\n');
  manual.records = manual.records.filter(r => r.ccn !== ccn);
  manual.records.push({ ...proof, proof_file: proofFile, manual_disposition: 'verified-current-mrf', disposition: 'verified-current-mrf', manual_identity_gate: ccn === '500129' ? 'official-pointer-csv-multi-location-name-address-state-date-template-attestation-agree' : 'official-pointer-csv-exact-name-address-state-date-template-attestation-agree' });
}
manual.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: Object.keys(rows), count: Object.keys(rows).length }, null, 2));
