'use strict';

const fs = require('fs');
const path = require('path');
const { csvToObjects } = require('./lib/util');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-baldwin-health-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).find(row => row.ccn === '010083');
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
if (!base || base.finding !== 'no-cms-hpt-txt-published' || proof.pointer_http_status !== 200
    || proof.version !== '3.0.0' || proof.declared_state !== 'AL' || proof.retained_bytes < 65536
    || !fs.existsSync(path.join(root, proof.retained_sample))) throw new Error('Incomplete Baldwin proof or changed base');
const evidence = {
  identity: 'corroborated',
  identity_basis: 'official-page-pointer-location-and-file-location-name-exact-roster-address-state',
  pointerUrl: proof.pointer_url, pointerSha256: proof.pointer_sha256, url: proof.current_mrf_url,
  fileSha256: proof.current_mrf_sha256, http_status: proof.current_mrf_http_status,
  checked_at: proof.observed_at, date: proof.declared_date, version: proof.version,
  officialDomain: proof.official_domain, location_name: proof.declared_location_name,
  declared_hospital_name: proof.declared_hospital_name, declared_address: proof.declared_address,
  declared_license_state: proof.declared_state, file_kind: 'csv', sourcePageUrl: proof.official_page_url,
  sourcePageSha256: proof.official_page_sha256,
};
const entry = {
  ccn: '010083', base, action: 'replace', evidence,
  evidence_run: 'baldwin-health-pointer-file-2026-09-15', reviewed_at: proof.observed_at,
  note: 'The canonical www root pointer names Baldwin Health, links the official pricing page and exact MRF. Fresh retained file bytes declare Baldwin Health at 1613 N. McKenzie Street, Foley, Alabama, dated 2026-04-01 on CMS 3.0.0; the corporate hospital_name remains preserved separately.',
};
const old = ledger.find(row => row.ccn === entry.ccn);
if (old) {
  if (old.evidence_run !== entry.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(evidence)) throw new Error('Existing nonmatching Baldwin resolution');
  console.log('{"applied":false}'); process.exit(0);
}
ledger.push(entry); ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
console.log(JSON.stringify({ applied: entry.ccn, finding: 'compliant-observed' }, null, 2));
