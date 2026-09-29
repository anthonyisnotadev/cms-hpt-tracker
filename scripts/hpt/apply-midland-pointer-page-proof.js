'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const { records } = JSON.parse(fs.readFileSync(path.join(audit,
  'reconciliation-midland-pointer-page-proof.json'), 'utf8'));
if (records.length !== 1 || records[0].ccn !== '450133') throw new Error('Unexpected Midland proof cohort');
const p = records[0];
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
  .find(row => row.ccn === p.ccn);
const facility = JSON.parse(fs.readFileSync(path.join(root, 'cms_data/hpt/roster.json'), 'utf8'))
  .find(row => row.ccn === p.ccn);
const sample = fs.readFileSync(path.join(root, p.retained_sample));
if (!base || base.finding !== 'mrf-url-unreachable' || base.domain !== p.official_domain
    || base.pointer_url !== p.pointer_url || base.mrf_url !== p.pointer_mrf_url
    || p.pointer_mrf_request_url !== p.pointer_mrf_url.replaceAll(' ', '%20')
    || p.pointer_location_name !== 'Midland Memorial Hospital'
    || p.pointer_http_status !== 200 || p.pointer_mrf_http_status !== 404
    || p.current_mrf_http_status !== 206 || p.pointer_mrf_url === p.current_mrf_url
    || p.retained_bytes !== 262144 || sample.length !== p.retained_bytes
    || crypto.createHash('sha256').update(sample).digest('hex') !== p.current_mrf_sha256
    || p.declared_hospital_name !== 'Midland County Hospital District'
    || !p.declared_location_name.includes('Midland County Hospital District')
    || !p.declared_address.includes('400 Rosalind Redfern Grover Parkway, Midland, TX 79701')
    || p.declared_state !== 'TX' || p.declared_date !== '2026-04-01'
    || p.version !== '3.0.0' || facility?.address !== '400 ROSALIND REDFERN GROVER PARKWAY'
    || facility.city !== 'MIDLAND' || facility.state !== 'TX' || facility.zip !== '79701')
  throw new Error('Incomplete Midland proof or changed base');
const evidence = {
  identity: 'corroborated',
  identity_basis: 'current-first-party-pricing-and-Midland-Memorial-main-campus-pages-plus-retained-district-file-header-exact-campus-address-state',
  pointerUrl: p.pointer_url, pointerSha256: p.pointer_sha256,
  pointerHttpStatus: p.pointer_http_status, pointerMrfUrl: p.pointer_mrf_url,
  pointerMrfRequestUrl: p.pointer_mrf_request_url, pointerMrfHttpStatus: p.pointer_mrf_http_status,
  url: p.current_mrf_url, fileSha256: p.current_mrf_sha256,
  http_status: p.current_mrf_http_status, checked_at: p.observed_at,
  date: p.declared_date, version: p.version, officialDomain: p.official_domain,
  location_name: p.declared_location_name, declared_hospital_name: p.declared_hospital_name,
  declared_address: p.declared_address, declared_license_state: p.declared_state,
  file_kind: 'csv', sourcePageUrl: p.source_page_url, sourcePageSha256: p.source_page_sha256,
  observedFinding: 'pointer-links-unavailable-mrf-source-page-current-file',
  pointerIssue: 'pointer-mrf-http-error-current-source-page-file', next_action: p.next_action,
};
const entry = {
  ccn: p.ccn, base, action: 'replace-observation', evidence,
  evidence_run: 'midland-pointer-page-mismatch-2026-09-16-450133', reviewed_at: p.observed_at,
  note: 'The current Midland root pointer lists Midland Memorial Hospital but names an unnumbered CSV path returning HTTP 404. Its first-party price-transparency page instead links a numbered CSV; the retained 262,144-byte header names Midland County Hospital District and includes the exact 400 Rosalind Redfern Grover Parkway, Midland TX 79701 main-campus address, Texas license state, 2026-04-01 and CMS v3.0.0. A separate first-party Midland Memorial Hospital location page and roster confirm that campus. The file location field uses the district name rather than literally Midland Memorial Hospital; the page file is not a working pointer target or a complete-file validation.',
};
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const old = ledger.find(row => row.ccn === p.ccn);
if (old && (old.evidence_run !== entry.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(entry.evidence)))
  throw new Error('Existing nonmatching Midland resolution');
if (!old) {
  ledger.push(entry);
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
}
console.log(JSON.stringify({ applied: old ? [] : [p.ccn], already_present: !!old }));
