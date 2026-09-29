'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const { record: row } = JSON.parse(fs.readFileSync(path.join(audit,
  'reconciliation-wth-milan-page-file-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
  .find(item => item.ccn === row.ccn);
const prior = csvToObjects(fs.readFileSync(path.join(audit,
  'rechecks/2026-09-09/recovery-856/file-evidence.csv'), 'utf8'))
  .find(item => item.ccn === row.ccn && item.url === row.current_mrf_url
    && item.identity === 'corroborated');
const sample = fs.readFileSync(path.join(root, row.retained_sample));
if (row.ccn !== '440060' || !base || base.finding !== 'no-cms-hpt-txt-published'
    || base.domain !== 'wth.org' || !prior || prior.fileSha256 !== row.current_mrf_sha256
    || row.pointer_http_status !== 404 || row.current_mrf_http_status !== 206
    || row.retained_bytes !== 262144 || sample.length !== row.retained_bytes
    || crypto.createHash('sha256').update(sample).digest('hex') !== row.current_mrf_sha256
    || row.declared_hospital_name !== 'West Tennessee Healthcare Milan Hospital'
    || row.declared_location_name !== row.declared_hospital_name
    || row.declared_address !== '4039 Highland StreetMilan, TN 3, Milan, TN 8358-3493'
    || row.declared_state !== 'TN' || row.declared_date !== '2026-06-02'
    || row.version !== '3.0.0'
    || row.address_disposition !== 'declared-address-malformed-street-city-state-match') {
  throw new Error('Incomplete WTH Milan proof');
}
const evidence = {
  identity: 'corroborated',
  identity_basis: 'official-pricing-page-facility-page-and-file-name-street-city-state-with-malformed-declared-zip',
  pointerUrl: row.pointer_url, pointerSha256: row.pointer_sha256,
  pointerHttpStatus: row.pointer_http_status, pointerIssue: 'root-pointer-http-error',
  url: row.current_mrf_url, fileSha256: row.current_mrf_sha256,
  http_status: row.current_mrf_http_status, checked_at: row.observed_at,
  date: row.declared_date, version: row.version, officialDomain: row.official_domain,
  location_name: row.declared_location_name, declared_hospital_name: row.declared_hospital_name,
  declared_address: row.declared_address, declared_license_state: row.declared_state,
  declaredAddressDisposition: row.address_disposition, file_kind: 'csv',
  sourcePageUrl: row.source_page_url, sourcePageSha256: row.source_page_sha256,
  officialIdentityUrl: row.official_identity_url, officialIdentitySha256: row.official_identity_sha256,
  observedFinding: 'official-page-mrf-root-pointer-unavailable', next_action: row.next_action,
};
const entry = { ccn: row.ccn, base, action: 'replace-observation', evidence,
  evidence_run: 'wth-milan-page-file-malformed-address-2026-09-16-440060',
  reviewed_at: row.observed_at,
  note: 'The WTH root cms-hpt.txt returns HTTP 404. Its first-party charges page separately labels a Milan CSV, and the Milan hospital page identifies 4039 Highland St, Milan, TN 38358. The retained CSV header agrees on facility name, street, city and Tennessee license state, dated 2026-06-02 on CMS 3.0.0, but its hospital_address field is literally malformed: "4039 Highland StreetMilan, TN 3, Milan, TN 8358-3493". The publisher field is retained verbatim, not silently corrected to the official campus address. This page-linked file is not called pointer-linked or compliant.' };
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const old = ledger.find(item => item.ccn === row.ccn);
if (old && (old.evidence_run !== entry.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(entry.evidence))) {
  throw new Error('Existing nonmatching WTH Milan resolution');
}
if (!old) {
  ledger.push(entry); ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
}
console.log(JSON.stringify({ applied: !old, ccn: row.ccn }));
