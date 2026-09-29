'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofFile = path.join(audit, 'reconciliation-oaklawn-pointer-page-proof.json');
const { records } = JSON.parse(fs.readFileSync(proofFile, 'utf8'));
if (records.length !== 1 || records[0].ccn !== '230217') throw new Error('Unexpected Oaklawn proof cohort');
const p = records[0];
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
  .find(row => row.ccn === p.ccn);
const facility = JSON.parse(fs.readFileSync(path.join(root, 'cms_data/hpt/roster.json'), 'utf8'))
  .find(row => row.ccn === p.ccn);
const sample = fs.readFileSync(path.join(root, p.retained_sample));
if (!base || base.finding !== 'mrf-url-unreachable' || base.domain !== p.official_domain
    || base.pointer_url !== p.pointer_url || base.mrf_url !== p.pointer_mrf_url
    || ![200, 206].includes(p.pointer_http_status) || p.pointer_mrf_http_status !== 404
    || p.current_mrf_http_status !== 206 || p.pointer_mrf_url === p.current_mrf_url
    || p.retained_bytes !== 262144 || sample.length !== p.retained_bytes
    || crypto.createHash('sha256').update(sample).digest('hex') !== p.current_mrf_sha256
    || p.archive_member !== 'oaklawn-standard-charges.csv'
    || p.declared_hospital_name !== 'Ella E.M. Brown Charitable Circle dba Oaklawn Hospital'
    || !p.declared_address.includes('200 North Madison Street, Marshall, MI 49068')
    || p.declared_state !== 'MI' || p.declared_date !== '2026-03-27' || p.version !== '3.0.0'
    || facility?.address !== '200 N MADISON' || facility.city !== 'MARSHALL'
    || facility.state !== 'MI' || facility.zip !== '49068')
  throw new Error('Incomplete Oaklawn proof or changed base');
const evidence = {
  identity: 'corroborated',
  identity_basis: 'current-first-party-pricing-and-hospital-location-pages-plus-retained-archive-member-header-name-address-state',
  pointerUrl: p.pointer_url, pointerSha256: p.pointer_sha256,
  pointerHttpStatus: p.pointer_http_status, pointerMrfUrl: p.pointer_mrf_url,
  pointerMrfHttpStatus: p.pointer_mrf_http_status,
  url: p.current_mrf_url, fileSha256: p.current_mrf_sha256,
  http_status: p.current_mrf_http_status, checked_at: p.observed_at,
  date: p.declared_date, version: p.version, officialDomain: p.official_domain,
  location_name: p.declared_location_name, declared_hospital_name: p.declared_hospital_name,
  declared_address: p.declared_address, declared_license_state: p.declared_state,
  file_kind: 'zip', sourcePageUrl: p.source_page_url, sourcePageSha256: p.source_page_sha256,
  observedFinding: 'pointer-links-unavailable-mrf-source-page-current-file',
  pointerIssue: 'pointer-mrf-http-error-current-source-page-file', next_action: p.next_action,
};
const entry = {
  ccn: p.ccn, base, action: 'replace-observation', evidence,
  evidence_run: 'oaklawn-pointer-page-mismatch-2026-09-16-230217', reviewed_at: p.observed_at,
  note: 'The current Oaklawn root pointer names a ZIP returning HTTP 404. Its first-party pricing page links a different ZIP whose retained member header identifies Oaklawn Hospital at 200 North Madison Street, Marshall MI 49068, Michigan license state, 2026-03-27 and CMS v3.0.0. The first-party hospital location page corroborates the address. The page-linked archive is not a working pointer target or a full-file validation.',
};
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const old = ledger.find(row => row.ccn === p.ccn);
if (old && (old.evidence_run !== entry.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(entry.evidence)))
  throw new Error('Existing nonmatching Oaklawn resolution');
if (!old) {
  ledger.push(entry);
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
}
console.log(JSON.stringify({ applied: old ? [] : [p.ccn], already_present: !!old }));
