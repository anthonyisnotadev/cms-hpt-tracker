'use strict';
const fs = require('fs');
const path = require('path');
const { csvToObjects } = require('./lib/util');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const compliance = new Map(csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).map(row => [row.ccn, row]));
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-hopedale-proof.json'), 'utf8')).records[0];
if (proof.ccn !== '141330' || proof.status !== 'identity-corroborated' || proof.version !== '3.0.0'
    || !proof.pointer_sha256 || !proof.mrf_sha256 || proof.pointer_http_status !== 200 || proof.mrf_http_status !== 200)
  throw new Error('Incomplete Hopedale proof');
const evidence = {
  identity: 'corroborated', identity_basis: 'official-transparency-page-pointer-file-name-address-state',
  pointerUrl: proof.pointer_url, pointerSha256: proof.pointer_sha256,
  url: proof.mrf_url, fileSha256: proof.mrf_sha256, http_status: proof.mrf_http_status,
  checked_at: proof.observed_at, date: proof.declared_date, version: proof.version,
  officialDomain: 'hopedalemc.com', location_name: proof.declared_location_name,
  declared_hospital_name: proof.declared_hospital_name, declared_address: proof.declared_address,
  declared_license_state: proof.declared_state, file_kind: proof.file_kind,
  sourcePageUrl: proof.source_page_url
};
const note = 'Fresh first-party transparency page, pointer and complete file review establish the current Hopedale CSV and facility identity. The older outreach description of a TXT pricing file is retained only as historical context.';
const existing = ledger.find(row => row.ccn === proof.ccn);
if (existing) {
  if (!(existing.action === 'replace' && existing.evidence_run === 'hopedale-full-file-review-2026-09-15'
      && JSON.stringify(existing.evidence) === JSON.stringify(evidence))) throw new Error(`Existing nonmatching resolution ${proof.ccn}`);
} else {
  ledger.push({ ccn: proof.ccn, base: compliance.get(proof.ccn), action: 'replace', evidence,
    evidence_run: 'hopedale-full-file-review-2026-09-15', reviewed_at: proof.observed_at, note });
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
}
console.log(JSON.stringify({ applied: proof.ccn, mrf_url: proof.mrf_url }, null, 2));
