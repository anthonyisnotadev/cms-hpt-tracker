const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const observedAt = '2026-09-26T02:25:00Z';
const rows = {
  '490112': ['CHIPPENHAM HOSPITAL', 'CJW Medical Center-Chippenham Hospital Campus', '7102 Jahnke Road, Richmond, VA 23225; 14720 Hancock Village St, Chesterfield, VA 23832; 9630 Iron Bridge Rd, Chesterfield, VA 23832', 'VA', '2026-09-01'],
  '494023': ['DOMINION HOSPITAL', 'DOMINION HOSPITAL', '2960 SLEEPY HOLLOW ROAD, FALLS CHURCH, VA 22044', 'VA', '2026-03-01'],
  '490126': ['LEWISGALE HOSPITAL ALLEGHANY', 'LEWISGALE HOSPITAL ALLEGHANY', '1 Alleghany Reg Hospital LN, LOW MOOR, VA 24457', 'VA', '2026-09-01']
};
const verification = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-verification.json'), 'utf8'));
const byCcn = new Map(verification.records.map(r => [r.ccn, r]));
const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
for (const [ccn, [name, location, address, state, date]] of Object.entries(rows)) {
  const base = byCcn.get(ccn);
  const proofFile = `reconciliation-hca-virginia-${ccn}-current-pointer-proof-2026-09-26.json`;
  const proof = { ccn, observed_at: observedAt, official_domain: 'https://www.hcavirginia.com/', pointer_url: 'https://hcavirginia.com/cms-hpt.txt', pointer_status: 200, pointer_declared_mrf_url: base.mrf_url, mrf_url: base.mrf_url, mrf_status: 206, declared_hospital_name: name, declared_location_name: location, declared_address: address, declared_license_state: state, declared_last_updated: date, cms_template_version: '3.0.0', attestation: true, file_kind: 'json', identity_basis: ccn === '490112' ? 'Official HCA Virginia pointer and JSON header identify Chippenham Hospital within the CJW Medical Center campus file; all three declared locations and Virginia license state are retained.' : 'Official HCA Virginia pointer and bounded JSON header agree on the facility name, location, exact address, Virginia license state, current date, CMS 3.0.0, and attestation.', next_action: 'Retain as verified current MRF and recheck on the next pointer update.' };
  fs.writeFileSync(path.join(audit, proofFile), JSON.stringify(proof, null, 2) + '\n');
  manual.records = manual.records.filter(r => r.ccn !== ccn);
  manual.records.push({ ...proof, proof_file: proofFile, manual_disposition: 'verified-current-mrf', disposition: 'verified-current-mrf', manual_identity_gate: ccn === '490112' ? 'official-pointer-json-multi-campus-name-address-state-date-template-attestation-agree' : 'official-pointer-json-exact-name-address-state-date-template-attestation-agree' });
}
manual.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: Object.keys(rows), count: Object.keys(rows).length }, null, 2));
