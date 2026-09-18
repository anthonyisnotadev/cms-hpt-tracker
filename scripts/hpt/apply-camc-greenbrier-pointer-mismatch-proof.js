'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const { record: row } = JSON.parse(fs.readFileSync(path.join(audit,
  'reconciliation-camc-greenbrier-pointer-mismatch-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
  .find(item => item.ccn === row.ccn);
const prior = csvToObjects(fs.readFileSync(path.join(audit,
  'rechecks/2026-09-09/recovery-856/file-evidence.csv'), 'utf8'))
  .find(item => item.ccn === row.ccn && item.url === row.current_mrf_url
    && item.identity === 'corroborated');
const sample = fs.readFileSync(path.join(root, row.retained_sample));
if (row.ccn !== '510002' || !base || base.finding !== 'mrf-url-unreachable'
    || base.domain !== 'camc.org' || base.mrf_url !== row.pointer_mrf_url
    || !prior || prior.fileSha256 !== row.current_mrf_sha256
    || row.pointer_http_status !== 206 || row.pointer_mrf_http_status !== 404
    || row.pointer_mrf_url === row.current_mrf_url
    || row.current_mrf_http_status !== 206 || row.retained_bytes !== 262144
    || sample.length !== row.retained_bytes
    || crypto.createHash('sha256').update(sample).digest('hex') !== row.current_mrf_sha256
    || row.declared_hospital_name !== 'Greenbrier Valley Medical Center'
    || row.declared_address !== '1320 Maplewood Ave , Ronceverte, WV 24970'
    || row.declared_state !== 'WV' || row.declared_date !== '2026-07-15'
    || row.version !== '3.0.0') {
  throw new Error('Incomplete CAMC Greenbrier pointer/page/file proof');
}
const evidence = {
  identity: 'corroborated',
  identity_basis: 'official-pricing-page-facility-page-and-file-name-address-state',
  pointerUrl: row.pointer_url, pointerSha256: row.pointer_sha256,
  pointerHttpStatus: row.pointer_http_status,
  pointerIssue: 'pointer-mrf-http-error-current-source-page-file',
  pointerMrfUrl: row.pointer_mrf_url,
  pointerMrfHttpStatus: row.pointer_mrf_http_status,
  pointerMrfSha256: row.pointer_mrf_sha256,
  url: row.current_mrf_url, fileSha256: row.current_mrf_sha256,
  http_status: row.current_mrf_http_status, checked_at: row.observed_at,
  date: row.declared_date, version: row.version, officialDomain: row.official_domain,
  location_name: row.declared_location_name || row.declared_hospital_name,
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
  evidence_run: 'camc-greenbrier-pointer-404-current-page-file-2026-09-16-510002',
  reviewed_at: row.observed_at,
  note: 'The first-party root pointer names Greenbrier Valley Medical Center but its exact Box CSV target returns HTTP 404. The separate CAMC Greenbrier price-transparency section links a different readable Box CSV. A fresh bounded sample matches the Ronceverte facility name, 1320 Maplewood Avenue campus and West Virginia license state, dated 2026-07-15 on CMS 3.0.0. The first-party facility page independently identifies the campus. The page-linked CSV is not called pointer-linked or compliant.' };
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const old = ledger.find(item => item.ccn === row.ccn);
if (old && (old.evidence_run !== entry.evidence_run
    || JSON.stringify(old.evidence) !== JSON.stringify(entry.evidence))) {
  throw new Error('Existing nonmatching CAMC Greenbrier resolution');
}
if (!old) {
  ledger.push(entry); ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
}
console.log(JSON.stringify({ applied: !old, ccn: row.ccn }));
