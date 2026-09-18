'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-yale-new-haven-pointer-mismatch-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
  .find(row => row.ccn === '070022');
const roster = JSON.parse(fs.readFileSync(path.join(root, 'cms_data/hpt/roster.json'), 'utf8'))
  .find(row => row.ccn === '070022');
const addressReview = JSON.parse(fs.readFileSync(path.join(audit, 'reviewed-address-equivalences.json'), 'utf8'))
  .records.find(row => row.ccn === '070022');
const sample = fs.readFileSync(path.join(root, proof.retained_sample));
if (proof.ccn !== '070022' || !base || base.finding !== 'mrf-url-unreachable'
    || base.domain !== proof.official_domain || base.mrf_url !== proof.pointer_mrf_url
    || proof.pointer_mrf_http_status !== 404 || proof.current_mrf_http_status !== 206
    || proof.pointer_mrf_url === proof.current_mrf_url || proof.retained_bytes !== 262144
    || sample.length !== proof.retained_bytes
    || crypto.createHash('sha256').update(sample).digest('hex') !== proof.current_mrf_sha256
    || proof.declared_hospital_name !== 'Yale New Haven Hospital'
    || !proof.declared_address.includes('20 York St, New Haven CT, 06510')
    || proof.declared_state !== 'CT' || proof.declared_date !== '2026-01-01'
    || proof.version !== '3.0.0' || roster?.address !== '20 YORK ST'
    || roster.zip !== '06504' || addressReview?.file_address !== '20 York St, New Haven CT, 06510'
    || addressReview.mrf_url !== proof.current_mrf_url) throw new Error('Incomplete Yale New Haven proof or changed base');
const evidence = {
  identity: 'corroborated',
  identity_basis: 'current-first-party-pricing-page-and-retained-file-header-name-street-city-state-with-reviewed-roster-zip-exception',
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
  evidence_run: 'yale-new-haven-pointer-page-mismatch-2026-09-16', reviewed_at: proof.observed_at,
  note: 'The current Yale New Haven root pointer names a file URL returning HTTP 404. The first-party pricing page instead links a different CSV; its retained 262,144-byte header identifies Yale New Haven Hospital at 20 York Street, New Haven CT 06510, Connecticut license state, 2026-01-01 and CMS v3.0.0. The CMS roster lists the same street/city/state but ZIP 06504, explicitly reviewed against the official page. The page-linked CSV is not a working pointer target or a full-file validation.' };
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const old = ledger.find(row => row.ccn === entry.ccn);
if (old && (old.evidence_run !== entry.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(entry.evidence)))
  throw new Error('Existing nonmatching Yale New Haven resolution');
if (!old) {
  ledger.push(entry);
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
}
console.log(JSON.stringify({ applied: !old, ccn: entry.ccn, finding: evidence.observedFinding }));
