const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const observedAt = '2026-10-01T23:32:37Z';
const ccn = '391309';

const record = {
  ccn,
  observed_at: observedAt,
  proof_file: 'reconciliation-barnes-kasson-391309-current-pointer-file-proof-2026-10-01.json',
  current_official_domain: 'http://www.barnes-kasson.org/',
  official_domain: 'http://www.barnes-kasson.org/',
  official_facility_name: 'BARNES-KASSON COUNTY HOSPITAL',
  official_facility_address: '2872 Turnpike Street, Susquehanna, PA 18847',
  pointer_url: 'http://www.barnes-kasson.org/cms-hpt.txt',
  pointer_status: 200,
  pointer_sha256: '0ea253e34585db290adeacf36c34b7ffb8a0d811a85b0c0f00a13bdf25b0dc93',
  pointer_entry_count: 1,
  pointer_entries_matching_facility: 1,
  pointer_location_name: 'Barnes-Kasson County Hospital',
  pointer_declared_mrf_url: 'http://www.barnes-kasson.org/images/docs/240798681_barnes-kasson-county-hospital_standardcharges.csv',
  facility_file_url: 'http://www.barnes-kasson.org/images/docs/240798681_barnes-kasson-county-hospital_standardcharges.csv',
  file_status: 200,
  file_bytes: 16177999,
  file_sha256: 'fbabf14fdb7a23502cd866d052204b68b491627666bf7676e75ed0a222023c72',
  declared_hospital_name: 'Barnes-Kasson County Hospital',
  declared_location_name: 'Barnes-Kasson County Hospital',
  declared_address: '2872 Turnpike St, Susquehanna, PA, 18847',
  declared_license_number: '02050101',
  declared_license_state: 'PA',
  declared_type_2_npis: '1932138161|1639355456|1497996037|1962680256|1366683831|1821239385|1720573918',
  declared_last_updated: '2026-04-23',
  cms_template_version: '3.0.0',
  attestation: true,
  file_kind: 'csv',
  manual_identity: 'corroborated',
  manual_identity_gate: 'exact-pointer-ccn-file-name-address-state-v3-attestation-agree',
  manual_disposition: 'verified-current-mrf',
  disposition: 'verified-current-mrf',
  next_action: 'Retain the exact pointer/file chain and recheck on the next publisher pointer or file change; note the HTTPS route failed TLS from automation while HTTP returned 200.'
};

const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));

manual.records = manual.records.filter(x => x.ccn !== ccn);
manual.records.push(record);
manual.records.sort((a, b) => String(a.ccn).localeCompare(String(b.ccn)));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: [ccn], count: 1 }));
