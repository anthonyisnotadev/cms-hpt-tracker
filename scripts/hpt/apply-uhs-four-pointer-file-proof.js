const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const observedAt = '2026-10-01T17:35:24.820Z';
const proofFile = 'reconciliation-uhs-four-pointer-mrf-webreader-proof-2026-10-01.json';

const rows = {
  '224013': {
    official_domain: 'https://arbourhospital.com/',
    pointer_url: 'https://arbourhospital.com/cms-hpt.txt',
    pointer_sha256: 'fb5fdf4f180680f7e5bf3c54a12768159b3d7ea3477d89fbdbe83b3fb047b90e',
    pointer_location_name: 'Arbour Hospital',
    mrf_url: 'https://uhsfilecdn.eskycity.net/bh/232238962_arbour_standardcharges.csv',
    file_sha256: '5b9ed02b016db67b82e668643dd09b6ea6193c491958ac26e5ac33e1ec8e794a',
    file_bytes: 39834,
    declared_name: 'Arbour Hospital',
    declared_address: '49 Robinwood Ave, Boston, MA 02130',
    declared_type_2_npis: '1821068818',
    license_state: 'MA',
    last_updated: '2026-05-12'
  },
  '454121': {
    official_domain: 'https://austinoakshospital.com/',
    pointer_url: 'https://austinoakshospital.com/cms-hpt.txt',
    pointer_sha256: '151badeeeaf6b26b814752260f39b69a758d70472009d387f5abdc7b10590174',
    pointer_location_name: 'Austin Oaks Hospital',
    mrf_url: 'https://uhsfilecdn.eskycity.net/bh/841618661_austin-oaks_standardcharges.csv',
    file_sha256: 'e91aeb44fc75e22eaab8a80e92151cf3d86539b5a53d57a5d7cb7b2e41d9fb5b',
    file_bytes: 128852,
    declared_name: 'Austin Oaks',
    declared_address: '1407 West Stassney Ln, Austin, TX 78745',
    declared_type_2_npis: '1578809505',
    license_state: 'TX',
    last_updated: '2026-05-12'
  },
  '224018': {
    official_domain: 'https://hrihospital.com/',
    pointer_url: 'https://hrihospital.com/cms-hpt.txt',
    pointer_sha256: '5fde46a60f199a73d30c9eda6e4f02763033b325634127739c8bbe0dff3ce968',
    pointer_location_name: 'HRI Hospital',
    mrf_url: 'https://uhsfilecdn.eskycity.net/bh/232238958_hri_standardcharges.csv',
    file_sha256: '7e9941fca975cdc7996ccf82f6d864ea218ac44f82b62394e9c84e21f67b636a',
    file_bytes: 23400,
    declared_name: 'HRI Hospital',
    declared_address: '227 Babcock Street, Brookline, MA 02446',
    declared_type_2_npis: '1518938174',
    license_state: 'MA',
    last_updated: '2026-09-01',
    domain_correction: true
  },
  '464014': {
    official_domain: 'https://aspengrovehospital.com/',
    pointer_url: 'https://aspengrovehospital.com/cms-hpt.txt',
    pointer_sha256: 'ec4b462331f360ec665631c8a473582c52f1e086f688f73f9ea9620a262c9031',
    pointer_location_name: 'Aspen Grove Behavioral Hospital',
    mrf_url: 'https://uhsfilecdn.eskycity.net/bh/233044423_aspen-grove_standardcharges.csv',
    file_sha256: '7ad96f33f0a97f8e24336e9048506e0597f29ea9666df21911d9c9e0b5c705c5',
    file_bytes: 92665,
    declared_name: 'Aspen Grove Behavioral Hospital',
    declared_address: '1350 E 750 North, Orem, UT 84097',
    declared_type_2_npis: '1598056053',
    license_state: 'UT',
    last_updated: '2026-08-27'
  }
};

const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));

for (const [ccn, r] of Object.entries(rows)) {
  const record = {
    ccn,
    observed_at: observedAt,
    proof_file: proofFile,
    official_domain: r.official_domain,
    pointer_url: r.pointer_url,
    pointer_status: 200,
    pointer_sha256: r.pointer_sha256,
    pointer_entry_count: 1,
    pointer_entries_matching_facility: 1,
    pointer_location_name: r.pointer_location_name,
    pointer_declared_mrf_url: r.mrf_url,
    facility_file_url: r.mrf_url,
    file_status: 200,
    file_sample_bytes: r.file_bytes,
    file_sample_sha256: r.file_sha256,
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
    next_action: 'Retain the pointer-to-file chain; recheck on next publisher pointer or file change. Pointer hashes are of reader-extracted text; exact pointer wire bytes remain unestablished.'
  };
  if (r.domain_correction) {
    record.current_official_domain = r.official_domain;
    record.observation = 'Domain correction: recorded www.arbourhealth.com is the Arbour Counseling Services outpatient site; its /cms-hpt.txt returned 404 via web-reader. The official HRI Hospital site is hrihospital.com (227 Babcock Street, Brookline, MA 02446) and carries the live CMS pointer for CCN 224018.';
  }
  manual.records = manual.records.filter(x => x.ccn !== ccn);
  manual.records.push(record);
}
manual.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: Object.keys(rows) }, null, 2));
