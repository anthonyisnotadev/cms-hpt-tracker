'use strict';

const fs = require('fs');
const path = require('path');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-three-crosses-html-file-proof.json'), 'utf8'));
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).find(row => row.ccn === proof.ccn);
if (!base || base.finding !== 'not-assessed-domain-unknown') throw new Error('Three Crosses base changed');
if (proof.pointer_http_status < 200 || proof.pointer_http_status >= 300 || proof.pointer_mrf_http_status < 200
    || proof.file_http_status < 200 || proof.retained_bytes < 65536 || proof.declared_state !== 'CA'
    || proof.version !== '2.0.0' || proof.declared_date !== '2024-11-07') throw new Error('Three Crosses proof incomplete');
const evidence = {
  identity: 'corroborated',
  identity_basis: 'root-pointer-html-pricing-page-and-linked-csv-exact-facility-address-state',
  pointerUrl: proof.pointer_url,
  pointerSha256: proof.pointer_sha256,
  pointerMrfUrl: proof.pointer_mrf_url,
  pointerMrfHttpStatus: proof.pointer_mrf_http_status,
  pointerMrfSha256: proof.pointer_mrf_sha256,
  pointerIssue: 'mrf-url-resolves-html-page-linking-file',
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
  officialDomain: proof.official_domain,
  observedFinding: 'pointer-links-html-download-page-with-file',
  next_action: proof.next_action
};
const entry = {
  ccn: proof.ccn,
  base,
  action: 'replace-observation',
  evidence,
  evidence_run: 'three-crosses-html-page-file-2026-09-25',
  reviewed_at: proof.observed_at,
  note: 'The official root pointer labels the HTML price-transparency page as its mrf-url. That page links the retained CSV, whose header identifies Three Crosses Regional Hospital LLC at 2560 Samaritan Drive, Las Cruces NM, dated 2024-11-07 with CMS 2.0.0. The file is retained as dated provenance; the older metadata and literal license-column label conflict remain explicit, and no current compliance conclusion is inferred.'
};
const old = ledger.find(row => row.ccn === entry.ccn);
if (old) {
  if (old.evidence_run !== entry.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(evidence)) throw new Error('Existing nonmatching Three Crosses resolution');
  console.log(JSON.stringify({ applied: false }));
  process.exit(0);
}
ledger.push(entry);
ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
console.log(JSON.stringify({ applied: entry.ccn, finding: evidence.observedFinding }, null, 2));
