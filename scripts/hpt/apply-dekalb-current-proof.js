'use strict';

const fs = require('fs');
const path = require('path');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-dekalb-current-proof.json'), 'utf8'));
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).find(row => row.ccn === proof.ccn);
if (!base || !['not-assessed-not-named-in-file', 'pointer-facility-match-unresolved'].includes(base.finding)) throw new Error('DeKalb base changed');
if (![200, 206].includes(proof.pointer_http_status) || proof.file_http_status !== 206 || proof.retained_bytes < 65536
    || proof.declared_state !== 'AL' || proof.version !== '3.0.0' || proof.declared_date !== '2026-08-20'
    || proof.declared_location_name !== 'HH HEALTH SYSTEM DEKALB REGIONAL MEDICAL CENTER') throw new Error('DeKalb proof incomplete');
const evidence = {
  identity: 'corroborated',
  identity_basis: 'official-price-page-root-pointer-and-alias-file-header-exact-facility-address-state',
  pointerUrl: proof.pointer_url,
  pointerSha256: proof.pointer_sha256,
  pointerHttpStatus: proof.pointer_http_status,
  pointerIssue: 'pointer-file-dns-client-failure',
  pointerSourcePageUrl: proof.source_page_url,
  pointerMrfUrl: 'https://dekalbregional.org/wp-content/uploads/934333907_Dekalb-Regional-Medical-Center_standardcharges.csv',
  pointerMrfHttpStatus: 0,
  pointerMrfTransportError: 'No such host is known while resolving dekalbregional.org',
  pointerMrfCheckedAt: proof.observed_at,
  browserTargetErrorCode: 'ERR_NAME_NOT_RESOLVED',
  browserObservedOn: proof.observed_at.slice(0, 10),
  browserObservationMethod: 'Codex in-app browser direct navigation reported a host-name-resolution error',
  url: proof.file_url,
  fileSha256: proof.file_sha256,
  bytesRetained: proof.retained_bytes,
  http_status: proof.file_http_status,
  checked_at: proof.observed_at,
  date: proof.declared_date,
  version: proof.version,
  file_kind: 'csv',
  location_name: proof.declared_location_name,
  declared_hospital_name: proof.declared_hospital_name,
  declared_address: proof.declared_address,
  declared_license_state: proof.declared_state,
  sourcePageUrl: proof.source_page_url,
  sourcePageSha256: '5217e63e4e8c26ef1d5ab63e8b5f45d8aceb0a876eccfe2395559953b7789b7d',
  observedFinding: 'pointer-target-dns-unresolved-page-file-found',
  next_action: 'Retain the current first-party page-linked CSV and metadata. Recheck the pointer-declared .org host only after DNS or publisher changes; do not treat the client DNS failure as file absence.'
};
const entry = {
  ccn: proof.ccn,
  base,
  action: 'replace-observation',
  evidence,
  evidence_run: 'dekalb-pointer-dns-current-page-file-2026-09-25',
  reviewed_at: proof.observed_at,
  note: 'The official DeKalb Regional pricing page and current pointer identify the August 20, 2026 CSV. The pointer-declared .org file hostname was independently observed as DNS-unresolved in the client, while the publisher\'s working .com alias exposed the same file with an exact DeKalb Regional header, Alabama address/state, CMS 3.0.0 and current date. The DNS result is retained as a transport observation, not as evidence of file absence or noncompliance.'
};
const old = ledger.find(row => row.ccn === entry.ccn);
if (old) {
  if (old.evidence_run !== entry.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(evidence)) throw new Error('Existing nonmatching DeKalb resolution');
  console.log(JSON.stringify({ applied: false }));
  process.exit(0);
}
ledger.push(entry);
ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
console.log(JSON.stringify({ applied: entry.ccn, finding: evidence.observedFinding }, null, 2));
