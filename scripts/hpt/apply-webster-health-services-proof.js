'use strict';

const fs = require('fs');
const path = require('path');
const { csvToObjects } = require('./lib/util');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-webster-health-services-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).find(row => row.ccn === '250020');
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
if (!base || base.finding !== 'not-assessed-domain-unknown' || proof.pointer_http_status !== 206
    || proof.pointer_mrf_http_status !== 404 || proof.pointer_mrf_url === proof.current_mrf_url
    || proof.version !== '3.0.0' || proof.declared_state !== 'MS' || proof.retained_bytes < 65536
    || !fs.existsSync(path.join(root, proof.retained_sample))) throw new Error('Incomplete Webster proof or changed base');
const evidence = {
  identity: 'corroborated',
  identity_basis: 'exact-pointer-legal-entity-plus-first-party-dba-and-file-exact-roster-address-state',
  pointerUrl: proof.pointer_url, pointerSha256: proof.pointer_sha256, url: proof.current_mrf_url,
  fileSha256: proof.current_mrf_sha256, http_status: proof.current_mrf_http_status,
  checked_at: proof.observed_at, date: proof.declared_date, version: proof.version,
  officialDomain: proof.official_domain, location_name: proof.declared_location_name,
  declared_hospital_name: proof.declared_hospital_name, declared_address: proof.declared_address,
  declared_license_state: proof.declared_state, file_kind: 'json',
  sourcePageUrl: proof.official_page_url, sourcePageSha256: proof.official_page_sha256,
  identityPageUrl: proof.identity_page_url, identityPageSha256: proof.identity_page_sha256,
  observedFinding: 'pointer-links-unavailable-mrf-source-page-current-file',
  pointerIssue: 'pointer-mrf-http-error-current-source-page-file',
  pointerMrfUrl: proof.pointer_mrf_url, pointerMrfHttpStatus: proof.pointer_mrf_http_status,
  pointerMrfSha256: proof.pointer_mrf_sha256,
};
const entry = {
  ccn: '250020', base, action: 'replace-observation', evidence,
  evidence_run: 'webster-health-services-pointer-file-2026-09-15', reviewed_at: proof.observed_at,
  note: 'The current NMHS facility page identifies Webster Health Services, Inc. DBA North Mississippi Medical Center-Eupora at the roster’s exact 70 Medical Plaza address. The official pricing page links a fresh byte-backed CMS 3.0.0 JSON dated 2026-04-01 whose identity, address and Mississippi license state agree. The root pointer names the right legal entity but its punctuation-different URL returns 404, so the current file is retained without calling it pointer-linked. The previously assigned Monroe Health Services file is rejected as a different facility.',
};
const old = ledger.find(row => row.ccn === entry.ccn);
if (old) {
  if (old.evidence_run !== entry.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(evidence)) throw new Error('Existing nonmatching Webster resolution');
  console.log('{"applied":false}'); process.exit(0);
}
ledger.push(entry); ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
console.log(JSON.stringify({ applied: entry.ccn, finding: evidence.observedFinding }, null, 2));
