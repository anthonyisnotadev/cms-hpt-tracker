'use strict';

const fs = require('fs');
const path = require('path');
const { csvToObjects } = require('./lib/util');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-russell-official-page-file-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).find(row => row.ccn === '010065');
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
if (!base || base.finding !== 'no-cms-hpt-txt-published' || proof.pointer_http_status !== 404
    || proof.version !== '2.0.0' || proof.declared_state !== 'AL' || proof.retained_bytes < 65536
    || !fs.existsSync(path.join(root, proof.retained_sample))) throw new Error('Incomplete Russell proof or changed base');
const evidence = {
  identity: 'corroborated', identity_basis: 'official-pricing-page-and-file-header-exact-name-street-city-state',
  pointerUrl: proof.pointer_url, pointerSha256: proof.pointer_sha256, pointerHttpStatus: proof.pointer_http_status,
  url: proof.current_mrf_url, fileSha256: proof.current_mrf_sha256, http_status: proof.current_mrf_http_status,
  checked_at: proof.observed_at, date: proof.declared_date, version: proof.version,
  officialDomain: proof.official_domain, location_name: proof.declared_location_name,
  declared_hospital_name: proof.declared_hospital_name, declared_address: proof.declared_address,
  declared_license_state: proof.declared_state, file_kind: 'csv', sourcePageUrl: proof.official_page_url,
  sourcePageSha256: proof.official_page_sha256, observedFinding: 'official-page-mrf-root-pointer-unavailable',
  pointerIssue: 'root-pointer-http-error',
};
const entry = {
  ccn: '010065', base, action: 'replace-observation', evidence,
  evidence_run: 'russell-official-page-file-root-pointer-2026-09-15', reviewed_at: proof.observed_at,
  note: 'Russell Medical’s official price-transparency page links an identity-matched CSV declaring 2025-06-15 and CMS 2.0.0. The exact root pointer returns HTTP 404, so the page-linked file, stale date and older version are retained without calling it pointer-linked or compliant.',
};
const old = ledger.find(row => row.ccn === entry.ccn);
if (old) {
  if (old.evidence_run !== entry.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(evidence)) throw new Error('Existing nonmatching Russell resolution');
  console.log('{"applied":false}'); process.exit(0);
}
ledger.push(entry); ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
console.log(JSON.stringify({ applied: entry.ccn, finding: evidence.observedFinding }, null, 2));
