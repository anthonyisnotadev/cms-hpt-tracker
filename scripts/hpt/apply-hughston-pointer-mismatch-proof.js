'use strict';

const fs = require('fs');
const path = require('path');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-hughston-pointer-mismatch-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).find((row) => row.ccn === '010168');
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
if (!base || base.finding !== 'mrf-url-unreachable' || proof.version !== '1.1.0' || proof.declared_state !== 'AL' || proof.retained_bytes < 65536 || !fs.existsSync(path.join(root, proof.retained_sample))) {
  throw new Error('Incomplete Hughston proof or changed base');
}
const evidence = {
  identity: 'corroborated',
  identity_basis: 'official-hospital-page-name-address-and-page-linked-file-name-state',
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
  declared_address: '',
  official_address: proof.official_address,
  declared_license_state: proof.declared_state,
  file_kind: 'json',
  sourcePageUrl: proof.source_page_url,
  sourcePageSha256: proof.source_page_sha256,
  observedFinding: 'pointer-links-older-mrf-than-source-page',
  pointerIssue: 'pointer-and-current-source-page-mrf-differ',
};
const entry = {
  ccn: '010168',
  base,
  action: 'replace-observation',
  evidence,
  evidence_run: 'hughston-page-pointer-mismatch-2026-09-15',
  reviewed_at: proof.observed_at,
  note: 'The official Jack Hughston pricing page links a November 2024 JSON rather than the February 2024 URL in the root pointer. The file names Jack Hughston Memorial Hospital and Alabama, but declares 2024-01-01 and CMS 1.1.0. It is retained without being promoted as current or pointer-linked.',
};
const old = ledger.find((row) => row.ccn === '010168');
if (old) {
  if (old.evidence_run !== entry.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(evidence)) throw new Error('Existing nonmatching Hughston resolution');
  console.log('{"applied":false}');
  process.exit(0);
}
ledger.push(entry);
ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
console.log(JSON.stringify({ applied: '010168', finding: evidence.observedFinding }, null, 2));
