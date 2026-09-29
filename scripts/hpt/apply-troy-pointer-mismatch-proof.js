'use strict';
const fs = require('fs');
const path = require('path');
const { csvToObjects } = require('./lib/util');
const root = path.resolve(__dirname, '../..'), audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-troy-pointer-mismatch-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).find(row => row.ccn === '010126');
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
if (!base || base.finding !== 'mrf-stale-over-365-days' || proof.version !== '3.0.0'
    || proof.declared_state !== 'AL' || proof.retained_bytes < 65536
    || !fs.existsSync(path.join(root, proof.retained_sample))) throw new Error('Incomplete Troy mismatch proof or changed base');
const evidence = {
  identity: 'corroborated', identity_basis: 'official-page-link-and-file-name-street-state',
  pointerUrl: proof.pointer_url, pointerSha256: proof.pointer_sha256,
  pointerMrfUrl: proof.pointer_mrf_url, url: proof.current_mrf_url,
  fileSha256: proof.current_mrf_sha256, http_status: proof.current_mrf_http_status,
  checked_at: proof.observed_at, date: proof.declared_date, version: proof.version,
  officialDomain: proof.official_domain, location_name: proof.pointer_location_name,
  declared_hospital_name: proof.declared_hospital_name, declared_address: proof.declared_address,
  declared_license_state: proof.declared_state, file_kind: 'csv', sourcePageUrl: proof.source_page_url,
  observedFinding: 'pointer-links-older-mrf-than-source-page',
  pointerIssue: 'pointer-and-current-source-page-mrf-differ'
};
const entry = { ccn: '010126', base, action: 'replace-observation', evidence,
  evidence_run: 'troy-current-page-pointer-mismatch-2026-09-15', reviewed_at: proof.observed_at,
  note: 'The current official pricing page links a 2025-12-31 CMS 3.0.0 CSV matching Troy Regional Medical Center at 1330 U.S. Highway 231 South, while the current root pointer still links its older 2024 CSV and shoppable-services workbook. The newer file is retained as current official-page evidence but is not described as pointer-linked.' };
const existing = ledger.find(row => row.ccn === '010126');
if (existing) {
  if (!(existing.evidence_run === entry.evidence_run && JSON.stringify(existing.evidence) === JSON.stringify(evidence))) throw new Error('Existing nonmatching Troy resolution');
  console.log(JSON.stringify({ applied: false, already_present: '010126' }, null, 2)); process.exit(0);
}
ledger.push(entry); ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
console.log(JSON.stringify({ applied: '010126', finding: evidence.observedFinding }, null, 2));
