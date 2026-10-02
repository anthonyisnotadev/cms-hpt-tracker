const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const observedAt = '2026-10-01T20:50:19.280Z';
const rows = {
  '191304': {
    roster_name: 'NORTH CADDO MEDICAL CENTER',
    roster_address: '815 S. PINE ST, VIVIAN, LA 71082',
    pointer_location_name: 'North Caddo Medical Center',
    mrf_url: 'https://hospitalpricedisclosure.com/Download.aspx?pxi=S06VWBoQGGb99RkSb0P*_*8w*-*&f=iFd*_*cEPwhQHJy3lVvHy9uQ*-*',
    total_bytes: 10655540,
    file_sha256: 'f2d4b6399267924d999896b36827c9a5067647d828837c5feecee3d0d0548e6b',
    declared_hospital_name: 'North Caddo Hospital Service District',
    declared_location_name: 'North Caddo Hospital Service District',
    declared_address: '815 South Pine Street, Vivian, LA 71082',
    declared_license_number: '2203783599',
    declared_type2_npis: '1326016684',
    proof_file: 'reconciliation-191304-north-caddo-proof-2026-10-01.json'
  }
};

const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));

for (const [ccn, r] of Object.entries(rows)) {
  const record = {
    ccn,
    observed_at: observedAt,
    proof_file: r.proof_file,
    official_domain: 'https://ncmcla.com/',
    official_facility_name: r.roster_name,
    official_facility_address: r.roster_address,
    pointer_url: 'https://ncmcla.com/cms-hpt.txt',
    pointer_status: 200,
    pointer_sha256: '596f159fdcb1c64b3565d312e5b4ece47a1240b5bab765849e3f9053f55c73df',
    pointer_entry_count: 1,
    pointer_entries_matching_facility: 1,
    pointer_location_name: r.pointer_location_name,
    pointer_declared_mrf_url: r.mrf_url,
    facility_file_url: r.mrf_url,
    file_status: 200,
    file_bytes: r.total_bytes,
    file_sha256: r.file_sha256,
    declared_hospital_name: r.declared_hospital_name,
    declared_location_name: r.declared_location_name,
    declared_address: r.declared_address,
    declared_license_number: r.declared_license_number,
    declared_license_state: 'LA',
    declared_last_updated: '2026-04-01',
    cms_template_version: '3.0.0',
    attestation: true,
    file_kind: 'json',
    manual_identity: 'corroborated',
    manual_identity_gate: 'exact-pointer-name-address-state-v3-attestation-agree-district-operator-name-variant',
    manual_disposition: 'verified-current-mrf',
    disposition: 'verified-current-mrf',
    next_action: 'Retain the pointer/file chain and recheck on the next publisher pointer or file change; direct curl of ncmcla.com returns a 202 SiteGround robot challenge, so use an interactive browser route.'
  };
  manual.records = manual.records.filter(x => x.ccn !== ccn);
  manual.records.push(record);
}
manual.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: Object.keys(rows), count: Object.keys(rows).length }, null, 2));
