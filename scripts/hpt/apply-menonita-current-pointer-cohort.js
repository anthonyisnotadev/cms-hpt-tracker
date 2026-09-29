const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const observedAt = '2026-09-26T00:55:00Z';
const rows = {
  '400104': ['HOSPITAL MENONITA CAGUAS INC', 'HOSPITAL MENONITA CAGUAS INC', 'STATE ROAD 172 EXIT 21 TURABO GARDENS STATE ROAD CAGUAS TO CIDRA, CAGUAS, PR 00725-3934'],
  '400048': ['HOSPITAL MENONITA GUAYAMA INC', 'HOSPITAL MENONITA GUAYAMA INC', 'AVE. PEDRO ALBIZU CAMPOS URB. LA HACIENDA, GUAYAMA, PR 00785-0001'],
  '400113': ['HOSPITAL MENONITA PONCE', 'HOSPITAL MENONITA PONCE', 'CARR PR 506, KM 1.0 BO. COTO LAUREL, PONCE, PR 00780-2250']
};
const verification = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-verification.json'), 'utf8'));
const byCcn = new Map(verification.records.map(r => [r.ccn, r]));
const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
for (const [ccn, [name, location, address]] of Object.entries(rows)) {
  const base = byCcn.get(ccn);
  const proofFile = `reconciliation-menonita-${ccn}-current-pointer-proof-2026-09-26.json`;
  const proof = {
    ccn, observed_at: observedAt, official_domain: 'https://sistemamenonita.com/',
    pointer_url: 'https://sistemamenonita.com/cms-hpt.txt', pointer_status: 200,
    pointer_declared_mrf_url: base.mrf_url, mrf_url: base.mrf_url, mrf_status: 200,
    declared_hospital_name: name, declared_location_name: location, declared_address: address,
    declared_license_state: 'PR', declared_last_updated: '2026-03-31', cms_template_version: '3.0.0',
    attestation: true, file_kind: 'json',
    identity_basis: 'Official Sistema Menonita pointer entry and bounded JSON MRF header agree on facility name, location, Puerto Rico address/license state, current date, CMS 3.0.0, and attestation.',
    next_action: 'Retain as verified current MRF and recheck on the next pointer update.'
  };
  fs.writeFileSync(path.join(audit, proofFile), JSON.stringify(proof, null, 2) + '\n');
  manual.records = manual.records.filter(r => r.ccn !== ccn);
  manual.records.push({ ...proof, proof_file: proofFile, manual_disposition: 'verified-current-mrf', disposition: 'verified-current-mrf', manual_identity_gate: 'official-pointer-json-exact-name-address-state-date-template-attestation-agree' });
}
manual.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: Object.keys(rows), count: Object.keys(rows).length }, null, 2));
