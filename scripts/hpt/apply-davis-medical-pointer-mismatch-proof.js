'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const { record: row } = JSON.parse(fs.readFileSync(path.join(audit,
  'reconciliation-davis-medical-pointer-mismatch-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
  .find(item => item.ccn === row.ccn);
const prior = csvToObjects(fs.readFileSync(path.join(audit,
  'rechecks/2026-09-09/recovery-856/file-evidence.csv'), 'utf8'))
  .find(item => item.ccn === row.ccn && item.url === row.current_mrf_url
    && item.identity === 'corroborated');
const sample = fs.readFileSync(path.join(root, row.retained_sample));
if (row.ccn !== '510030' || !base || base.finding !== 'mrf-url-unreachable'
    || base.domain !== 'davishealthsystem.org' || base.mrf_url !== row.pointer_mrf_url
    || !prior || prior.fileSha256 !== row.current_mrf_sha256
    || row.pointer_http_status !== 206 || row.pointer_mrf_http_status !== 404
    || row.pointer_mrf_url === row.current_mrf_url
    || row.current_mrf_http_status !== 206 || row.retained_bytes !== 262144
    || sample.length !== row.retained_bytes
    || crypto.createHash('sha256').update(sample).digest('hex') !== row.current_mrf_sha256
    || row.declared_hospital_name !== 'Davis Medical Center'
    || row.declared_location_name !== 'Davis Medical Center|Davis Medical Center|Davis Medical Center|Davis Medical Center'
    || !row.declared_address.startsWith('812 Gorman Ave, Elkins, WV 26241|')
    || row.declared_state !== 'WV' || row.declared_date !== '2026-07-30'
    || row.version !== '3.0.0') {
  throw new Error('Incomplete Davis Medical pointer/page/file proof');
}
const evidence = {
  identity: 'corroborated',
  identity_basis: 'official-davis-medical-location-page-and-multi-location-file-exact-main-campus-address-state',
  pointerUrl: row.pointer_url, pointerSha256: row.pointer_sha256,
  pointerHttpStatus: row.pointer_http_status,
  pointerIssue: 'pointer-mrf-http-error-current-source-page-file',
  pointerMrfUrl: row.pointer_mrf_url,
  pointerMrfHttpStatus: row.pointer_mrf_http_status,
  pointerMrfSha256: row.pointer_mrf_sha256,
  url: row.current_mrf_url, fileSha256: row.current_mrf_sha256,
  http_status: row.current_mrf_http_status, checked_at: row.observed_at,
  date: row.declared_date, version: row.version, officialDomain: row.official_domain,
  location_name: row.declared_location_name,
  declared_hospital_name: row.declared_hospital_name,
  declared_address: row.declared_address,
  declared_license_state: row.declared_state, file_kind: 'csv',
  sourcePageUrl: row.source_page_url, sourcePageSha256: row.source_page_sha256,
  officialIdentityUrl: row.official_identity_url,
  officialIdentitySha256: row.official_identity_sha256,
  observedFinding: 'pointer-links-unavailable-mrf-source-page-current-file',
  next_action: row.next_action,
};
const entry = { ccn: row.ccn, base, action: 'replace-observation', evidence,
  evidence_run: 'davis-medical-pointer-404-current-page-multilocation-file-2026-09-16-510030',
  reviewed_at: row.observed_at,
  note: 'The Davis Health System plain-text root pointer names Davis Medical Center but its exact Davis Memorial Hospital CSV target returns HTTP 404. The first-party Davis Medical Center pricing section links a different readable Davis Medical Center CSV. A retained bounded sample has several declared locations, including the exact 812 Gorman Avenue, Elkins main campus for this CCN, West Virginia license state, 2026-07-30 and CMS 3.0.0. Other listed addresses are not assigned to this CCN by implication. The current page file is not called pointer-linked or compliant.' };
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const old = ledger.find(item => item.ccn === row.ccn);
if (old && (old.evidence_run !== entry.evidence_run
    || JSON.stringify(old.evidence) !== JSON.stringify(entry.evidence))) {
  throw new Error('Existing nonmatching Davis Medical resolution');
}
if (!old) {
  ledger.push(entry); ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
}
console.log(JSON.stringify({ applied: !old, ccn: row.ccn }));
