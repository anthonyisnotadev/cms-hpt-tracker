'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-bridgeport-pointer-mismatch-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
  .find(row => row.ccn === '070010');
const sample = fs.readFileSync(path.join(root, proof.retained_sample));
if (proof.ccn !== '070010' || !base || base.finding !== 'mrf-url-unreachable'
    || base.domain !== proof.official_domain || base.mrf_url !== proof.pointer_mrf_url
    || proof.pointer_mrf_http_status !== 404 || proof.current_mrf_http_status !== 206
    || proof.pointer_mrf_url === proof.current_mrf_url || proof.retained_bytes !== 262144
    || sample.length !== proof.retained_bytes
    || crypto.createHash('sha256').update(sample).digest('hex') !== proof.current_mrf_sha256
    || proof.declared_hospital_name !== 'Bridgeport Hospital'
    || !proof.declared_address.includes('267 Grant Street, Bridgeport CT, 06610')
    || proof.declared_state !== 'CT' || proof.declared_date !== '2026-01-01'
    || proof.version !== '3.0.0') throw new Error('Incomplete Bridgeport proof or changed base');
const evidence = {
  identity: 'corroborated',
  identity_basis: 'current-first-party-pricing-page-and-retained-file-header-name-address-state',
  pointerUrl: proof.pointer_url, pointerSha256: proof.pointer_sha256,
  pointerHttpStatus: proof.pointer_http_status, pointerMrfUrl: proof.pointer_mrf_url,
  pointerMrfHttpStatus: proof.pointer_mrf_http_status,
  url: proof.current_mrf_url, fileSha256: proof.current_mrf_sha256,
  http_status: proof.current_mrf_http_status, checked_at: proof.observed_at,
  date: proof.declared_date, version: proof.version, officialDomain: proof.official_domain,
  location_name: proof.declared_location_name, declared_hospital_name: proof.declared_hospital_name,
  declared_address: proof.declared_address, declared_license_state: proof.declared_state,
  file_kind: 'csv', sourcePageUrl: proof.source_page_url, sourcePageSha256: proof.source_page_sha256,
  observedFinding: 'pointer-links-unavailable-mrf-source-page-current-file',
  pointerIssue: 'pointer-mrf-http-error-current-source-page-file', next_action: proof.next_action,
};
const entry = { ccn: proof.ccn, base, action: 'replace-observation', evidence,
  evidence_run: 'bridgeport-pointer-page-mismatch-2026-09-16', reviewed_at: proof.observed_at,
  note: 'The current Bridgeport root pointer names a file URL returning HTTP 404. The first-party pricing page instead links a different CSV; its retained 262,144-byte header identifies Bridgeport Hospital at 267 Grant Street, Bridgeport CT 06610, Connecticut license state, 2026-01-01 and CMS v3.0.0. This is a page-linked file, not a working pointer target or a full-file validation.' };
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const old = ledger.find(row => row.ccn === entry.ccn);
if (old && (old.evidence_run !== entry.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(entry.evidence)))
  throw new Error('Existing nonmatching Bridgeport resolution');
if (!old) {
  ledger.push(entry);
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
}
console.log(JSON.stringify({ applied: !old, ccn: entry.ccn, finding: evidence.observedFinding }));
