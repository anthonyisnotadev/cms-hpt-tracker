const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const observedAt = '2026-10-01T17:29:06.731Z';

const rows = {
  '250151': {
    official_domain: 'https://alliancehealthcenter.com/',
    pointer_url: 'https://alliancehealthcenter.com/cms-hpt.txt',
    pointer_sha256: '4b953f5de2b467c685f9d8a34f8a3cfe701aed03d0f411d2b8d575cb625af663',
    pointer_location_name: 'Alliance Health Center',
    mrf_url: 'https://uhsfilecdn.eskycity.net/bh/640777521_alliance_standardcharges.csv',
    file_sha256: '77f626e66a339707bc24efc300602b02bd055a31e7829af809978f3eed083f60',
    file_bytes: 40002,
    declared_name: 'Alliance Health Center',
    declared_address: '5000 Highway 39 N, Meridian, MS 39301',
    declared_type_2_npis: '1811156326',
    license_state: 'MS',
    last_updated: '2026-06-16',
    proof_file: 'reconciliation-alliance-250151-pointer-mrf-webreader-proof-2026-10-01.json'
  },
  '114032': {
    official_domain: 'https://anchorhospital.com/',
    pointer_url: 'https://anchorhospital.com/cms-hpt.txt',
    pointer_sha256: 'cb9d7bcd2ec35532daf243f8756109d3a93da12ff6e9aed7eb90e674d3f2c83f',
    pointer_location_name: 'Anchor Hospital',
    mrf_url: 'https://uhsfilecdn.eskycity.net/bh/233044975_anchor_standardcharges.csv',
    file_sha256: '1f1b87e5f9d12c35f35bacb23c750c005df2a97827dc0bd1320ef997627263d6',
    file_bytes: 38019,
    declared_name: 'Anchor Hospital',
    declared_address: '5454 Yorktowne Drive, Atlanta (postal) / College Park (municipal), GA 30349',
    declared_type_2_npis: '1023095429',
    license_state: 'GA',
    last_updated: '2026-08-26',
    proof_file: 'reconciliation-anchor-114032-pointer-mrf-webreader-proof-2026-10-01.json'
  }
};

const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));

for (const [ccn, r] of Object.entries(rows)) {
  const record = {
    ccn,
    observed_at: observedAt,
    proof_file: r.proof_file,
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
    next_action: 'Retain the pointer-to-file chain; recheck on next publisher pointer or file change. Pointer hash is of reader-extracted text; exact pointer wire bytes remain unestablished. For 114032 the declared city is postal (Atlanta) versus roster municipal (College Park) at the identical street address and ZIP.'
  };
  manual.records = manual.records.filter(x => x.ccn !== ccn);
  manual.records.push(record);
}
manual.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: Object.keys(rows) }, null, 2));
