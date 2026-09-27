const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const observedAt = '2026-09-26T00:35:00Z';
const rows = {
  '340158': ['Brunswick Community Hospital, LLC', 'Novant Health Brunswick Medical Center', '240 Hospital Dr NE, Bolivia, NC 28422', '2026-03-30'],
  '340171': ['Novant Health Matthews Medical Center LLC', 'Novant Health Matthews Medical Center', '1500 Matthews Township Pkwy, Matthews, NC 28105', '2026-03-30'],
  '340190': ['Novant Health Mint Hill Medical Center, LLC', 'Novant Health Mint Hill Medical Center', '8201 Healthcare Lp, Charlotte, NC 28215', '2026-03-30'],
  '340053': ['The Presbyterian Hospital', 'Novant Health Presbyterian Medical Center', '200 Hawthorne Ln, Charlotte, NC 28204', '2026-03-31'],
  '340085': ['Novant Health Thomasville Medical Center, LLC', 'Novant Health Thomasville Medical Center', '207 Old Lexington Rd, Thomasville, NC 27360', '2026-03-31']
};
const verification = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-verification.json'), 'utf8'));
const byCcn = new Map(verification.records.map(r => [r.ccn, r]));
const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
for (const [ccn, [hospitalName, location, address, date]] of Object.entries(rows)) {
  const base = byCcn.get(ccn);
  if (!base || !base.mrf_url) throw new Error(`missing MRF ${ccn}`);
  const proofFile = `reconciliation-novant-${ccn}-current-pointer-proof-2026-09-26.json`;
  const proof = {
    ccn, observed_at: observedAt, official_domain: 'https://www.novanthealth.org/',
    pointer_url: 'https://novanthealth.org/cms-hpt.txt', pointer_status: 200,
    pointer_declared_mrf_url: base.mrf_url, mrf_url: base.mrf_url, mrf_status: 206,
    declared_hospital_name: hospitalName, declared_location_name: location, declared_address: address,
    declared_license_state: 'NC', declared_last_updated: date, cms_template_version: '3.0.0',
    attestation: true, file_kind: 'json',
    identity_basis: 'The official Novant pointer and bounded JSON MRF header agree on facility name, location, exact address, North Carolina license state, current date, CMS 3.0.0, and attestation.',
    next_action: 'Retain as verified current MRF and recheck on the next pointer update.'
  };
  fs.writeFileSync(path.join(audit, proofFile), JSON.stringify(proof, null, 2) + '\n');
  manual.records = manual.records.filter(r => r.ccn !== ccn);
  manual.records.push({ ...proof, proof_file: proofFile, manual_disposition: 'verified-current-mrf', disposition: 'verified-current-mrf', manual_identity_gate: 'official-pointer-json-exact-name-address-state-date-template-attestation-agree' });
}
manual.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: Object.keys(rows), count: Object.keys(rows).length }, null, 2));
