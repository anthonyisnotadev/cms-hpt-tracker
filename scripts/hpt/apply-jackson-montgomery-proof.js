'use strict';

const fs = require('fs');
const path = require('path');
const { csvToObjects } = require('./lib/util');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-jackson-montgomery-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).find((row) => row.ccn === '010024');
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
if (!base || base.finding !== 'not-assessed-domain-unknown' || proof.version !== '3.0.0' || proof.declared_state !== 'AL' || proof.retained_bytes < 65536 || !fs.existsSync(path.join(root, proof.retained_sample))) throw new Error('Incomplete Jackson proof or changed base');
const evidence = {
  identity: 'corroborated',
  identity_basis: 'official-hospital-page-and-current-publisher-file-exact-name-street-city-state',
  pointerUrl: proof.pointer_url,
  pointerSha256: proof.pointer_sha256,
  pointerMrfUrl: proof.pointer_mrf_url,
  url: proof.current_mrf_url,
  fileSha256: proof.current_mrf_sha256,
  http_status: proof.current_mrf_http_status,
  checked_at: proof.observed_at,
  date: proof.declared_date,
  version: proof.version,
  officialDomain: proof.official_domain,
  location_name: proof.declared_location_name,
  declared_hospital_name: proof.declared_hospital_name,
  declared_address: proof.declared_address,
  declared_license_state: proof.declared_state,
  file_kind: 'csv',
  sourcePageUrl: proof.publisher_page_url,
  sourcePageSha256: proof.publisher_page_sha256,
  officialPageUrl: proof.official_page_url,
  officialPageSha256: proof.official_page_sha256,
  observedFinding: 'pointer-links-older-mrf-than-source-page',
  pointerIssue: 'pointer-and-current-source-page-mrf-differ',
};
const entry = {
  ccn: '010024',
  base,
  action: 'replace-observation',
  evidence,
  evidence_run: 'jackson-montgomery-publisher-pointer-mismatch-2026-09-15',
  reviewed_at: proof.observed_at,
  note: 'Jackson Hospital’s official page links the current AccuReg publisher page, whose stable CDN CSV identifies Jackson Hospital at 1725 Pine Street, Montgomery, Alabama and declares 2026-06-23 and CMS 3.0.0. The root pointer still links a signed Azure URL that returns AuthorizationFailure, so the current file is retained without being called pointer-linked or compliant.',
};
const old = ledger.find((row) => row.ccn === '010024');
if (old) {
  if (old.evidence_run !== entry.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(evidence)) throw new Error('Existing nonmatching Jackson resolution');
  console.log('{"applied":false}');
  process.exit(0);
}
ledger.push(entry);
ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
console.log(JSON.stringify({ applied: '010024', finding: evidence.observedFinding }, null, 2));
