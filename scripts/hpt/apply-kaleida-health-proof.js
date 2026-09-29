'use strict';

const fs = require('fs');
const path = require('path');
const { csvToObjects } = require('./lib/util');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-kaleida-health-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).find(row => row.ccn === '330005');
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
if (!base || base.finding !== 'not-assessed-domain-unknown' || proof.pointer_http_status !== 200
    || ![200, 206].includes(proof.mrf_http_status) || proof.retained_bytes < 65536
    || proof.version !== '3.0.0' || proof.declared_state !== 'NY'
    || !fs.existsSync(path.join(root, proof.retained_sample))) throw new Error('Incomplete Kaleida proof or changed base');
const evidence = {
  identity: 'corroborated',
  identity_basis: 'root-pointer-exact-location-system-file-name-and-exact-street-city-state-with-zip-caveat',
  pointerUrl: proof.pointer_url, pointerSha256: proof.pointer_sha256, url: proof.mrf_url,
  finalUrl: proof.mrf_final_url, fileSha256: proof.mrf_sample_sha256,
  http_status: proof.mrf_http_status, checked_at: proof.observed_at,
  date: proof.declared_date, version: proof.version, officialDomain: proof.official_domain,
  location_name: proof.declared_location_name, declared_hospital_name: proof.declared_hospital_name,
  declared_address: proof.declared_address, declared_license_state: proof.declared_state,
  file_kind: 'json', identityPageUrl: proof.identity_page_url,
  identityPageSha256: proof.identity_page_sha256, addressCaveat: proof.caveat
};
const entry = {
  ccn: '330005', base, action: 'replace', evidence,
  evidence_run: 'kaleida-health-buffalo-general-2026-09-15', reviewed_at: proof.observed_at,
  note: 'The current Kaleida root pointer names Buffalo General Medical Center and links the reviewed system MRF. The MRF names Kaleida Health, includes Buffalo General Medical Center, and declares 100 High Street in Buffalo, matching the CCN street, city and state. Kaleida current official pages independently identify Buffalo General at 100 High Street. ZIP values conflict (CMS 14210, MRF 14214, official site 14203), so this resolution relies on the exact street and named pointer/file chain and preserves the ZIP discrepancy as a caveat.'
};
const old = ledger.find(row => row.ccn === entry.ccn);
if (old) {
  if (old.evidence_run !== entry.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(evidence))
    throw new Error('Existing nonmatching Kaleida resolution');
  console.log('{"applied":false}'); process.exit(0);
}
ledger.push(entry); ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
console.log(JSON.stringify({ applied: entry.ccn, finding: 'compliant-observed' }, null, 2));
