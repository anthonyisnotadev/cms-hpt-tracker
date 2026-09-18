'use strict';

const fs = require('fs');
const path = require('path');
const { csvToObjects } = require('./lib/util');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-san-carlos-borromeo-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).find(row => row.ccn === '400111');
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
if (!base || base.finding !== 'not-assessed-domain-unknown' || proof.pointer_http_status !== 206
    || proof.portal_http_status !== 206 || proof.version !== '2.0.0' || proof.declared_state !== 'PR'
    || proof.retained_bytes < 65536 || !fs.existsSync(path.join(root, proof.retained_sample))) {
  throw new Error('Incomplete San Carlos proof or changed base');
}
const evidence = {
  identity: 'corroborated',
  identity_basis: 'official-facility-page-pointer-location-portal-and-file-exact-street-city-state',
  pointerUrl: proof.pointer_url, pointerSha256: proof.pointer_sha256, url: proof.current_mrf_url,
  fileSha256: proof.current_mrf_sha256, http_status: proof.current_mrf_http_status,
  checked_at: proof.observed_at, date: proof.declared_date, version: proof.version,
  officialDomain: proof.official_domain, location_name: proof.declared_location_name,
  declared_hospital_name: proof.declared_hospital_name, declared_address: proof.declared_address,
  declared_license_state: proof.declared_state, file_kind: 'json',
  sourcePageUrl: proof.pointer_mrf_url, sourcePageSha256: proof.portal_sha256,
  identityPageUrl: proof.identity_page_url, identityPageSha256: proof.identity_page_sha256,
  observedFinding: 'pointer-links-html-download-page-with-file',
  pointerIssue: 'mrf-url-resolves-html-page-linking-file', pointerMrfUrl: proof.pointer_mrf_url,
  pointerMrfHttpStatus: proof.portal_http_status,
};
const entry = {
  ccn: '400111', base, action: 'replace-observation', evidence,
  evidence_run: 'san-carlos-borromeo-portal-file-2026-09-15', reviewed_at: proof.observed_at,
  note: 'The current root pointer names Hospital San Carlos, Inc. but its mrf-url resolves to an HTML service-search/download portal rather than the MRF. That portal exposes a direct JSON whose retained bytes declare Hospital San Carlos, Inc. at the exact 550 Concepcion Vera Ayala, Moca address, Puerto Rico state, 2025-02-19 and CMS 2.0.0. The current hospital homepage independently confirms the Hospital San Carlos Borromeo identity and address. Retain the file, stale date and older version without calling the pointer target a direct MRF or promoting compliance.',
};
const old = ledger.find(row => row.ccn === entry.ccn);
if (old) {
  if (old.evidence_run !== entry.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(evidence)) throw new Error('Existing nonmatching San Carlos resolution');
  console.log('{"applied":false}'); process.exit(0);
}
ledger.push(entry); ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
console.log(JSON.stringify({ applied: entry.ccn, finding: evidence.observedFinding }, null, 2));
