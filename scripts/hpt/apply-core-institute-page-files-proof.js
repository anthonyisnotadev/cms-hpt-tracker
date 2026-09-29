'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const { record: row } = JSON.parse(fs.readFileSync(path.join(audit,
  'reconciliation-core-institute-page-files-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
  .find(item => item.ccn === row.ccn);
const recovery = csvToObjects(fs.readFileSync(path.join(audit,
  'rechecks/2026-09-09/recovery-856/file-evidence.csv'), 'utf8'))
  .find(item => item.ccn === row.ccn && item.url === row.inpatient_url && item.identity === 'corroborated');
function sampleMatches(samplePath, size, sha) {
  const bytes = fs.readFileSync(path.join(root, samplePath));
  return bytes.length === size && crypto.createHash('sha256').update(bytes).digest('hex') === sha;
}
if (row.ccn !== '030108' || !base || base.finding !== 'no-cms-hpt-txt-published'
    || base.domain !== 'thecoreinstitutehospital.com' || !recovery
    || recovery.fileSha256 !== row.inpatient_sha256
    || row.pointer_http_status !== 404 || !row.pointer_response_has_pointer_style_text
    || row.inpatient_http_status !== 206 || row.full_http_status !== 206
    || row.inpatient_bytes !== 13737 || row.full_bytes !== 262144
    || !sampleMatches(row.inpatient_sample, row.inpatient_bytes, row.inpatient_sha256)
    || !sampleMatches(row.full_sample, row.full_bytes, row.full_sha256)
    || row.inpatient_declared_hospital_name !== 'The CORE Institute Specialty Hospital'
    || row.inpatient_declared_address !== '6501 N. 19th Ave, Phoenix, AZ, 85015'
    || row.inpatient_declared_state !== 'AZ' || row.inpatient_declared_date !== '2026-04-27'
    || row.inpatient_version !== '3.0.0'
    || row.full_opening_metadata !== 'no-hospital-name-date-or-version-in-bounded-opening') {
  throw new Error('Incomplete CORE page-file and root-404 proof');
}
const evidence = {
  identity: 'corroborated', identity_basis: 'official-site-address-and-inpatient-file-header',
  pointerUrl: row.pointer_url, pointerSha256: row.pointer_sha256,
  pointerHttpStatus: row.pointer_http_status, pointerIssue: 'root-pointer-http-error',
  pointerResponseHasPointerStyleText: row.pointer_response_has_pointer_style_text,
  url: row.inpatient_url, fileSha256: row.inpatient_sha256,
  http_status: row.inpatient_http_status, checked_at: row.observed_at,
  date: row.inpatient_declared_date, version: row.inpatient_version,
  officialDomain: row.official_domain, location_name: row.inpatient_declared_location_name,
  declared_hospital_name: row.inpatient_declared_hospital_name,
  declared_address: row.inpatient_declared_address,
  declared_license_state: row.inpatient_declared_state, file_kind: 'csv',
  sourcePageUrl: row.source_page_url, sourcePageSha256: row.source_page_sha256,
  officialIdentityUrl: row.official_identity_url, officialIdentitySha256: row.official_identity_sha256,
  fileScope: 'inpatient-labeled', fullFileUrl: row.full_url,
  fullFileSha256: row.full_sha256, fullFileOpeningMetadata: row.full_opening_metadata,
  observedFinding: 'official-page-mrf-root-pointer-unavailable', next_action: row.next_action,
};
const entry = { ccn: row.ccn, base, action: 'replace-observation', evidence,
  evidence_run: 'core-institute-root-404-paired-page-files-2026-09-16-030108',
  reviewed_at: row.observed_at,
  note: 'The exact root cms-hpt.txt path returns HTTP 404 even though its error response body contains pointer-style text; it is not a usable root pointer. The first-party billing page links separate Inpatient and Full CSVs. The retained Inpatient CSV header matches the Phoenix facility, Arizona license state, 2026-04-27 and CMS 3.0.0. The separately retained 262,144-byte opening of the Full CSV has no hospital-name, date or version fields, so its scope and metadata remain unverified. The Inpatient file is page-linked only; neither full-file validation nor compliance is inferred.' };
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const old = ledger.find(item => item.ccn === row.ccn);
if (old && (old.evidence_run !== entry.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(entry.evidence))) {
  throw new Error('Existing nonmatching CORE resolution');
}
if (!old) {
  ledger.push(entry); ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
}
console.log(JSON.stringify({ applied: !old, ccn: row.ccn }));
