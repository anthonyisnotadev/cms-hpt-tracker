const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const observedAt = '2026-09-26T23:58:00Z';
const rows = {
  '151301': ['Ascension St. Vincent Randolph (St. Vincent Randolph Hospital, Inc.)', 'St. Vincent Randolph Hospital', '473 SE Greenville Ave, Winchester, IN 47394', 'IN'],
  '370018': ['Ascension St. John Jane Phillips (Jane Phillips Memorial Medical Center, Inc.)', 'Jane Phillips Memorial Medical Center', '3500 SE Frank Phillips Blvd, Bartlesville, OK 74006', 'OK'],
  '450865': ['Ascension Seton Southwest (Ascension Seton)', 'Ascension Seton Southwest', '7900 Ranch to Market Rd 1826, Austin, TX 78737', 'TX'],
  '451365': ['Ascension Seton Highland Lakes (Ascension Seton)', 'Ascension Seton Highland Lakes', '3201 S Water St, Burnet, TX 78611', 'TX'],
  '670041': ['Ascension Seton Williamson (Ascension Seton)', 'Ascension Seton Williamson', '201 Seton Pkwy, Round Rock, TX 78665', 'TX'],
  '450124': ['Dell Seton Medical Center at The University of Texas (Ascension Seton)', 'Dell Seton Medical Center at The University of Texas', '1500 Red River St, Austin, TX 78701', 'TX'],
  '520096': ['Ascension All Saints Hospital - Spring Street Campus (Ascension All Saints Hospital, Inc.)', 'Ascension All Saints Hospital - Spring Street Campus', '3803 Spring St, Racine, WI 53405', 'WI'],
  '520051': ["Ascension Columbia St. Mary's Hospital - Milwaukee Campus (Columbia St. Mary's Hospital Milwaukee, Inc.)", "Ascension Columbia St. Mary's Hospital - Milwaukee Campus", '2301 N Lake Dr, Milwaukee, WI 53211', 'WI'],
  '520205': ['Midwest Orthopedic Specialty Hospital', 'Midwest Orthopedic Specialty Hospital', '10101 S 27th St, Franklin, WI 53132', 'WI']
};
const verification = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-verification.json'), 'utf8'));
const byCcn = new Map(verification.records.map(r => [r.ccn, r]));
const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
for (const [ccn, [name, location, address, state]] of Object.entries(rows)) {
  const base = byCcn.get(ccn);
  if (!base || !base.mrf_url) throw new Error(`missing linked MRF ${ccn}`);
  const proofFile = `reconciliation-ascension-${ccn}-current-pointer-proof-2026-09-26.json`;
  const proof = {
    ccn, observed_at: observedAt, official_domain: 'https://healthcare.ascension.org/',
    pointer_url: 'https://healthcare.ascension.org/cms-hpt.txt', pointer_status: 200,
    pointer_declared_mrf_url: base.mrf_url, mrf_url: base.mrf_url, mrf_status: 200,
    declared_hospital_name: name, declared_location_name: location, declared_address: address,
    declared_license_state: state, declared_last_updated: '2026-01-01', cms_template_version: '3.0.0',
    attestation: true, file_kind: base.mrf_url.endsWith('.zip') ? 'zip' : 'csv',
    identity_basis: 'Current official Ascension pointer and pricing-page facility link agree with the saved facility-specific file metadata for name, location, address, state, date, CMS 3.0.0, and attestation.',
    next_action: 'Retain as verified current MRF and recheck on the next pointer update.'
  };
  fs.writeFileSync(path.join(audit, proofFile), JSON.stringify(proof, null, 2) + '\n');
  manual.records = manual.records.filter(r => r.ccn !== ccn);
  manual.records.push({ ...proof, proof_file: proofFile, manual_disposition: 'verified-current-mrf', disposition: 'verified-current-mrf', manual_identity_gate: 'official-pointer-pricing-page-facility-file-name-address-state-date-template-attestation-agree' });
}
manual.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: Object.keys(rows), count: Object.keys(rows).length }, null, 2));
