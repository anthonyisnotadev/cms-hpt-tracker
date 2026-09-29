'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const { record: row } = JSON.parse(fs.readFileSync(path.join(audit,
  'reconciliation-covington-official-page-file-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
  .find(item => item.ccn === row.ccn);
const prior = csvToObjects(fs.readFileSync(path.join(audit,
  'rechecks/2026-09-09/recovery-856/file-evidence.csv'), 'utf8'))
  .find(item => item.ccn === row.ccn && item.url === row.current_mrf_url
    && item.identity === 'corroborated');
const sample = fs.readFileSync(path.join(root, row.retained_sample));
const raw = sample.toString('utf8').split(/\r?\n/)[1] || '';
if (row.ccn !== '251325' || !base || base.finding !== 'pointer-blocked-to-automation'
    || base.domain !== 'irp.cdn-website.com' || !prior
    || prior.fileSha256 !== row.current_mrf_sha256
    || row.pointer_http_status !== 404
    || !String(row.pointer_response_content_type).startsWith('text/html')
    || row.current_mrf_http_status !== 206 || row.retained_bytes !== 262144
    || sample.length !== row.retained_bytes
    || crypto.createHash('sha256').update(sample).digest('hex') !== row.current_mrf_sha256
    || row.declared_hospital_name !== 'covington_county_hospital'
    || row.declared_location_name !== 'covington_county_hospital_.1'
    || !raw.includes(',covington_county_hospital_.1,')
    || row.declared_address !== '701_south_holly_avenue_collins_ms_39428'
    || row.declared_state !== 'MS' || row.declared_date !== '2026-07-21'
    || row.version !== '3.0.0') {
  throw new Error('Incomplete Covington official-page/file proof');
}
const evidence = {
  identity: 'corroborated',
  identity_basis: 'official-hospital-domain-pricing-page-contact-address-and-file-name-address-state',
  pointerUrl: row.pointer_url, pointerSha256: row.pointer_response_sha256,
  pointerHttpStatus: row.pointer_http_status,
  pointerIssue: 'root-pointer-http-error',
  url: row.current_mrf_url, fileSha256: row.current_mrf_sha256,
  http_status: row.current_mrf_http_status, checked_at: row.observed_at,
  date: row.declared_date, version: row.version, officialDomain: row.official_domain,
  location_name: row.declared_location_name,
  declared_hospital_name: row.declared_hospital_name,
  declared_address: row.declared_address,
  declared_license_state: row.declared_state,
  declaredLocationNameDisposition: 'literal-publisher-value-contains-dot-one-suffix',
  file_kind: 'csv',
  sourcePageUrl: row.source_page_url, sourcePageSha256: row.source_page_sha256,
  officialIdentityUrl: row.official_identity_url,
  officialIdentitySha256: row.official_identity_sha256,
  observedFinding: 'official-page-mrf-root-pointer-unavailable',
  next_action: row.next_action,
};
const entry = { ccn: row.ccn, base, action: 'replace-observation', evidence,
  evidence_run: 'covington-official-domain-root-404-page-file-2026-09-16-251325',
  reviewed_at: row.observed_at,
  note: 'The crawl used a CDN hostname as Covington County Hospital’s domain and observed access trouble there. The current first-party hospital domain instead identifies its Collins campus and directly links a CSV from its pricing page. The official-domain root cms-hpt.txt path returns HTTP 404. A retained bounded CSV sample matches the hospital name, 701 South Holly Avenue campus and Mississippi license state, dated 2026-07-21 on CMS 3.0.0. The raw publisher location_name is literally covington_county_hospital_.1; it is preserved, not normalized into an exact facility name. This file is page-linked only, and its full validity or compliance is not inferred.' };
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const old = ledger.find(item => item.ccn === row.ccn);
if (old && (old.evidence_run !== entry.evidence_run
    || JSON.stringify(old.evidence) !== JSON.stringify(entry.evidence))) {
  throw new Error('Existing nonmatching Covington resolution');
}
if (!old) {
  ledger.push(entry); ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
}
console.log(JSON.stringify({ applied: !old, ccn: row.ccn }));
