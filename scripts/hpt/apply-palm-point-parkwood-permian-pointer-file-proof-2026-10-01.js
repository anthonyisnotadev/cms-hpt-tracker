const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const observedAt = '2026-10-01T21:00:01.707Z';

const pointerText = {
  '104082': 'location-name: Palm Point Behavioral Health\nsource-page-url: https://palmpointbehavioral.com/standard-services/\nmrf-url: https://uhsfilecdn.eskycity.net/bh/471584533_palm-point_standardcharges.csv\ncontact-name: UHS Corp Price Transparency Team\ncontact-email: UHSCORPPriceTransparencyTeam@uhsinc.com\n',
  '254005': 'location-name: Parkwood Behavioral Health\nsource-page-url: https://parkwoodbhs.com/standard-services/\nmrf-url: https://uhsfilecdn.eskycity.net/bh/233044435_parkwood_standardcharges.csv\ncontact-name: UHS Corp Price Transparency Team\ncontact-email: UHSCORPPriceTransparencyTeam@uhsinc.com\n',
  '450144': 'location-name: Permian Regional Medical Center\nsource-page-url: https://search.hospitalpriceindex.com/hpi2/machineReadable/PermianRegionalMedicalCenter/7829\nmrf-url: https://sthpiprd.blob.core.windows.net/machine-readable-files/7829/751997880_andrews-county-hospital-district_standardcharges.csv\ncontact-name: April Guynes\ncontact-email: aguynes@permianregional.com\n'
};
const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

const rows = {
  '104082': {
    proofFile: 'reconciliation-palm-point-pointer-mrf-webreader-proof-2026-10-01.json',
    official_domain: 'https://palmpointbehavioral.com/',
    pointer_url: 'https://palmpointbehavioral.com/cms-hpt.txt',
    pointer_location_name: 'Palm Point Behavioral Health',
    mrf_url: 'https://uhsfilecdn.eskycity.net/bh/471584533_palm-point_standardcharges.csv',
    file_sample_bytes: 214247,
    file_sample_sha256: '7be440bc6b4e6e9a9974311f9e787fb4b9469e4f561c34c1902425d214d26cd1',
    file_complete: true,
    declared_name: 'Palm Point Behavioral Health',
    declared_address: '2355 TRUMAN SCARBOROUGH WAY, TITUSVILLE, FL 32796',
    declared_type_2_npis: '1235635533',
    license_state: 'FL',
    last_updated: '2026-06-03'
  },
  '254005': {
    proofFile: 'reconciliation-parkwood-pointer-mrf-webreader-proof-2026-10-01.json',
    official_domain: 'https://parkwoodbhs.com/',
    pointer_url: 'https://parkwoodbhs.com/cms-hpt.txt',
    pointer_location_name: 'Parkwood Behavioral Health',
    mrf_url: 'https://uhsfilecdn.eskycity.net/bh/233044435_parkwood_standardcharges.csv',
    file_sample_bytes: 262144,
    file_sample_sha256: '4107a9aa1ac041123461e8d6193ebebe37e17659e56485e82be799b62986302de',
    file_complete: false,
    declared_name: 'Parkwood Behavioral Health System',
    declared_address: '8135 GOODMAN ROAD, OLIVE BRANCH, MS 38654',
    declared_type_2_npis: '1093785859',
    license_state: 'MS',
    last_updated: '2026-05-12'
  },
  '450144': {
    proofFile: 'reconciliation-permian-pointer-mrf-webreader-proof-2026-10-01.json',
    official_domain: 'https://www.permianregional.com/',
    pointer_url: 'https://www.permianregional.com/cms-hpt.txt',
    pointer_location_name: 'Permian Regional Medical Center',
    mrf_url: 'https://sthpiprd.blob.core.windows.net/machine-readable-files/7829/751997880_andrews-county-hospital-district_standardcharges.csv',
    file_sample_bytes: 262144,
    file_sample_sha256: '3c8dcd87b3877b5450c004187aacb4952e57c3d766e9f7793a49a62fc2be4000',
    file_complete: false,
    declared_name: 'Permian Regional Medical Center',
    declared_address: '720 Hospital Drive, Andrews, TX 79714',
    declared_type_2_npis: '1174563779',
    license_state: 'TX',
    last_updated: '2025-12-03'
  }
};

const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));

for (const [ccn, r] of Object.entries(rows)) {
  const record = {
    ccn,
    observed_at: observedAt,
    proof_file: r.proofFile,
    official_domain: r.official_domain,
    pointer_url: r.pointer_url,
    pointer_status: 200,
    pointer_sha256: sha(pointerText[ccn]),
    pointer_entry_count: 1,
    pointer_entries_matching_facility: 1,
    pointer_location_name: r.pointer_location_name,
    pointer_declared_mrf_url: r.mrf_url,
    facility_file_url: r.mrf_url,
    file_status: 200,
    file_sample_bytes: r.file_sample_bytes,
    file_sample_sha256: r.file_sample_sha256,
    file_complete: r.file_complete,
    declared_hospital_name: r.declared_name,
    declared_location_name: r.declared_name,
    declared_address: r.declared_address,
    declared_type_2_npis: r.declared_type_2_npis,
    declared_license_state: r.license_state,
    declared_last_updated: r.last_updated,
    cms_template_version: '3.0.0',
    attestation: true,
    file_kind: 'csv',
    manual_identity: 'corroborated',
    manual_identity_gate: 'unique-pointer-entry-name-address-state-v3-attestation-agree',
    manual_disposition: 'verified-current-mrf',
    disposition: 'verified-current-mrf',
    next_action: 'Retain the pointer-to-file chain; recheck on next publisher pointer or file change. Pointer hashes are of reader-extracted text; exact pointer wire bytes remain unestablished. Samples other than 104082 are bounded 262,144-byte prefixes.'
  };
  manual.records = manual.records.filter(x => x.ccn !== ccn);
  manual.records.push(record);
}
manual.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: Object.keys(rows) }, null, 2));
