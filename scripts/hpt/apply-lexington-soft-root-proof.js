'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const { record: row } = JSON.parse(fs.readFileSync(path.join(audit,
  'reconciliation-lexington-soft-root-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
  .find(item => item.ccn === row.ccn);
const prior = csvToObjects(fs.readFileSync(path.join(audit,
  'rechecks/2026-09-09/recovery-856/file-evidence.csv'), 'utf8'))
  .find(item => item.ccn === row.ccn && item.url === row.current_mrf_url
    && item.identity === 'corroborated');
const sample = fs.readFileSync(path.join(root, row.retained_sample));
if (row.ccn !== '420073' || !base || base.finding !== 'no-cms-hpt-txt-published'
    || base.domain !== 'lexmed.com' || !prior
    || prior.fileSha256 !== row.current_mrf_sha256
    || row.old_root_final_url !== row.pointer_final_url
    || row.pointer_http_status !== 200 || !/\/404(?:\?|$)/.test(row.pointer_final_url)
    || !String(row.pointer_response_content_type).startsWith('text/html')
    || row.pointer_response_title !== '404 - Page Not Found'
    || row.current_mrf_http_status !== 206 || row.retained_bytes !== 262144
    || sample.length !== row.retained_bytes
    || crypto.createHash('sha256').update(sample).digest('hex') !== row.current_mrf_sha256
    || row.declared_hospital_name !== 'Lexington Medical Center'
    || row.declared_location_name !== 'Lexington Medical Center'
    || row.declared_address !== '2720 Sunset Blvd, West Columbia, SC 29169'
    || row.declared_state !== 'SC' || row.declared_date !== '2026-04-01'
    || row.version !== '3.0.0') {
  throw new Error('Incomplete Lexington soft-root and page-file proof');
}
const evidence = {
  identity: 'corroborated',
  identity_basis: 'official-pricing-page-facility-page-and-file-name-address-state',
  pointerUrl: row.pointer_url, pointerSha256: row.pointer_response_sha256,
  pointerHttpStatus: row.pointer_http_status,
  pointerIssue: 'root-pointer-html-not-found',
  pointerFinalUrl: row.pointer_final_url,
  pointerResponseContentType: row.pointer_response_content_type,
  pointerResponseTitle: row.pointer_response_title,
  oldRootUrl: row.old_root_url, oldRootFinalUrl: row.old_root_final_url,
  url: row.current_mrf_url, fileSha256: row.current_mrf_sha256,
  http_status: row.current_mrf_http_status, checked_at: row.observed_at,
  date: row.declared_date, version: row.version, officialDomain: row.official_domain,
  location_name: row.declared_location_name,
  declared_hospital_name: row.declared_hospital_name,
  declared_address: row.declared_address,
  declared_license_state: row.declared_state, file_kind: 'json',
  sourcePageUrl: row.source_page_url, sourcePageSha256: row.source_page_sha256,
  officialIdentityUrl: row.official_identity_url,
  officialIdentitySha256: row.official_identity_sha256,
  observedFinding: 'official-page-mrf-root-pointer-unavailable',
  next_action: row.next_action,
};
const entry = { ccn: row.ccn, base, action: 'replace-observation', evidence,
  evidence_run: 'lexington-current-domain-soft-root-404-page-file-2026-09-16-420073',
  reviewed_at: row.observed_at,
  note: 'The old lexmed.com root path redirects to Lexington Health; the current lexhealth.com root cms-hpt.txt request returned HTTP 200 but landed on an HTML page titled 404 - Page Not Found. This is a soft not-found response, not a usable plain-text pointer. The first-party Lexington Health pricing page links a separate JSON and its facility page identifies Lexington Medical Center at 2720 Sunset Blvd, West Columbia. A fresh bounded JSON sample matches the name, address, South Carolina license state, 2026-04-01 date and CMS 3.0.0. The page-linked file is not called pointer-linked or compliant.' };
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const old = ledger.find(item => item.ccn === row.ccn);
if (old && (old.evidence_run !== entry.evidence_run
    || JSON.stringify(old.evidence) !== JSON.stringify(entry.evidence))) {
  throw new Error('Existing nonmatching Lexington resolution');
}
if (!old) {
  ledger.push(entry); ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
}
console.log(JSON.stringify({ applied: !old, ccn: row.ccn }));
