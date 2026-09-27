const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const observedAt = '2026-09-26T01:20:00Z';
const rows = {
  '231319': ['Aspirus Keweenaw Hospital', 'Aspirus Keweenaw Hospital', '205 Osceola, Laurium, MI 49913', 'MI', 'https://www.aspirus.org/Uploads/Public/Documents/PriceEstimate/TransparencyFY27/381443361_1326115569_aspirus-keweenaw-hospital_standardcharges.json'],
  '521324': ['Aspirus Medford Hospital', 'Aspirus Medford Hospital', '135 S Gibson St, Medford, WI 54451', 'WI', 'https://www.aspirus.org/Uploads/Public/Documents/PriceEstimate/TransparencyFY27/390964813_1619079597_aspirus-medford-hospital_standardcharges.json'],
  '520033': ['Aspirus Wisconsin Rapids Hospital', 'Aspirus Wisconsin Rapids Hospital', '410 Dewey St, Wisconsin Rapids, WI 54495', 'WI', 'https://www.aspirus.org/Uploads/Public/Documents/PriceEstimate/TransparencyFY27/390868982_1295754844_aspirus-wisconsin-rapids-hospital_standardcharges.json'],
  '521350': ['Aspirus Langlade Hospital', 'Aspirus Langlade Hospital', '112 E Fifth Ave, Antigo, WI 54409', 'WI', 'https://www.aspirus.org/Uploads/Public/Documents/PriceEstimate/TransparencyFY27/390806429_1639187412_aspirus-langlade-hospital_standardcharges.json']
};
const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
for (const [ccn, [name, location, address, state, url]] of Object.entries(rows)) {
  const proofFile = `reconciliation-aspirus-${ccn}-current-pointer-proof-2026-09-26.json`;
  const proof = { ccn, observed_at: observedAt, official_domain: 'https://www.aspirus.org/', pointer_url: 'https://www.aspirus.org/cms-hpt.txt', pointer_status: 200, pointer_declared_mrf_url: url, mrf_url: url, mrf_status: 206, declared_hospital_name: name, declared_location_name: location, declared_address: address, declared_license_state: state, declared_last_updated: '2026-04-01', cms_template_version: '3.0.0', attestation: true, file_kind: 'json', identity_basis: 'Current Aspirus FY27 pointer entry and bounded JSON header agree on facility name, location, exact address, license state, 2026-04-01 date, CMS 3.0.0, and attestation; stale FY26 evidence is retained as superseded.', next_action: 'Retain as verified current MRF and recheck on the next pointer update.' };
  fs.writeFileSync(path.join(audit, proofFile), JSON.stringify(proof, null, 2) + '\n');
  manual.records = manual.records.filter(r => r.ccn !== ccn);
  manual.records.push({ ...proof, proof_file: proofFile, manual_disposition: 'verified-current-mrf', disposition: 'verified-current-mrf', manual_identity_gate: 'official-pointer-current-fy27-json-exact-name-address-state-date-template-attestation-agree' });
}
manual.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: Object.keys(rows), count: Object.keys(rows).length }, null, 2));
