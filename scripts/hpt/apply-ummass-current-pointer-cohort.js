const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const observedAt = '2026-09-26T03:45:00Z';
const rows = {
  '220049': ['UMass Memorial Medical Center', 'UMass Memorial Medical Center Memorial Campus; UMass Memorial Medical Center University Campus; UMass Memorial Medical Center-North Pavilion; UMass Memorial Medical Center-Marlborough Campus', '119 Belmont Street, Worcester, MA 01605; 55 Lake Avenue North, Worcester, MA 01655; 378 Plantation St, Worcester, MA 01605; 157 Union Street, Marlborough, MA 01752', 'MA', '2026-03-26', 'https://d1477x5i4cdpk9.cloudfront.net/043358564_umass-memorial-medical-center-inc._standardcharges.csv'],
  '220090': ['UMass Memorial Health - Milford Regional Medical Center, Inc.', 'UMass Memorial Health - Milford Regional Medical Center', '14 Prospect St, Milford, MA 01757', 'MA', '2026-04-01', 'https://d1477x5i4cdpk9.cloudfront.net/042103602_umass-memorial-health-milford-regional-medical-center-inc._standardcharges.csv'],
  '220001': ['HealthAlliance - Clinton Hospital', 'HealthAlliance - Clinton, Leominster Campus; HealthAlliance Clinton, Clinton Campus', '60 Hospital Rd., Leominster, MA 01453; 201 Highland St, Clinton, MA 01510', 'MA', '2026-03-26', 'https://d1477x5i4cdpk9.cloudfront.net/042103555_umass-memorial-healthalliance-clinton-hospital-inc._standardcharges.csv']
};
const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
for (const [ccn, [name, location, address, state, date, url]] of Object.entries(rows)) {
  const proofFile = `reconciliation-ummass-${ccn}-current-pointer-proof-2026-09-26.json`;
  const proof = { ccn, observed_at: observedAt, official_domain: 'https://www.ummhealth.org/', pointer_url: 'https://ummhealth.org/cms-hpt.txt', pointer_status: 200, pointer_declared_mrf_url: url, mrf_url: url, mrf_status: 206, declared_hospital_name: name, declared_location_name: location, declared_address: address, declared_license_state: state, declared_last_updated: date, cms_template_version: '3.0.0', attestation: true, file_kind: 'csv', identity_basis: 'Current UMass Memorial pointer entry and bounded CSV header agree on the legal facility identity, declared campus location(s), Massachusetts address(es), current date, CMS 3.0.0, and attestation; stale saved URLs were replaced with the current pointer-declared file.', next_action: 'Retain as verified current MRF and recheck on the next pointer update.' };
  fs.writeFileSync(path.join(audit, proofFile), JSON.stringify(proof, null, 2) + '\n');
  manual.records = manual.records.filter(r => r.ccn !== ccn);
  manual.records.push({ ...proof, proof_file: proofFile, manual_disposition: 'verified-current-mrf', disposition: 'verified-current-mrf', manual_identity_gate: 'official-pointer-current-csv-exact-or-multi-campus-name-address-state-date-template-attestation-agree' });
}
manual.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: Object.keys(rows), count: Object.keys(rows).length }, null, 2));
