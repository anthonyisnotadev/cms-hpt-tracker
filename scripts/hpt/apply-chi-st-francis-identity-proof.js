'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const { record: row } = JSON.parse(fs.readFileSync(path.join(audit,
  'reconciliation-chi-st-francis-identity-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
  .find(item => item.ccn === row.ccn);
const prior = csvToObjects(fs.readFileSync(path.join(audit,
  'rechecks/2026-09-09/recovery-856/file-evidence.csv'), 'utf8'))
  .find(item => item.ccn === row.ccn && item.url === row.mrf_url
    && item.identity === 'corroborated');
const sample = fs.readFileSync(path.join(root, row.retained_sample));
if (row.ccn !== '241377' || !base || base.finding !== 'mrf-url-unreachable'
    || base.domain !== row.rejected_domain || base.mrf_url !== row.rejected_mrf_url
    || row.rejected_pointer_location_name !== 'St. Francis Regional Medical Center'
    || row.rejected_facility_city !== 'Shakopee' || !prior
    || prior.fileSha256 !== row.mrf_sha256
    || row.pointer_http_status !== 206 || row.mrf_http_status !== 200
    || row.retained_bytes !== 262144 || sample.length !== row.retained_bytes
    || crypto.createHash('sha256').update(sample).digest('hex') !== row.mrf_sha256
    || row.declared_hospital_name !== 'ST. FRANCIS MEDICAL CENTER'
    || row.declared_location_name !== 'CHI St. Francis Health'
    || row.declared_address !== '2400 ST. FRANCIS DR, Breckenridge, MN 56520'
    || row.declared_state !== 'MN' || row.declared_date !== '2026-02-28'
    || row.version !== '3.0.0') {
  throw new Error('Incomplete CHI St. Francis identity proof');
}
const evidence = {
  identity: 'corroborated',
  identity_basis: 'official-chi-site-exact-breckenridge-address-and-direct-pointer-linked-file-header',
  rejectedDomain: row.rejected_domain,
  rejectedPointerUrl: row.rejected_pointer_url,
  rejectedPointerSha256: row.rejected_pointer_sha256,
  rejectedPointerLocationName: row.rejected_pointer_location_name,
  rejectedMrfUrl: row.rejected_mrf_url,
  rejectedFacilityCity: row.rejected_facility_city,
  pointerUrl: row.pointer_url, pointerSha256: row.pointer_sha256,
  pointerHttpStatus: row.pointer_http_status,
  url: row.mrf_url, fileSha256: row.mrf_sha256,
  http_status: row.mrf_http_status, checked_at: row.observed_at,
  date: row.declared_date, version: row.version, officialDomain: row.official_domain,
  location_name: row.declared_location_name,
  declared_hospital_name: row.declared_hospital_name,
  declared_address: row.declared_address,
  declared_license_state: row.declared_state, file_kind: 'csv',
  sourcePageUrl: row.source_page_url, sourcePageSha256: row.source_page_sha256,
  officialIdentityUrl: row.official_identity_url,
  officialIdentitySha256: row.official_identity_sha256,
  next_action: row.next_action,
};
const entry = { ccn: row.ccn, base, action: 'replace', evidence,
  evidence_run: 'chi-st-francis-wrong-allina-facility-corrected-2026-09-16-241377',
  reviewed_at: row.observed_at,
  note: 'The original Allina root pointer names St. Francis Regional Medical Center in Shakopee, a different hospital from CCN 241377 St. Francis Medical Center in Breckenridge; that file assignment is rejected. CHI St. Francis Health independently identifies its hospital at 2400 St. Francis Drive, Breckenridge. Its current plain-text root pointer directly links the CSV on the first-party standard-charges page. A retained bounded CSV sample identifies ST. FRANCIS MEDICAL CENTER / CHI St. Francis Health at the Breckenridge campus, Minnesota license state, 2026-02-28 and CMS 3.0.0. This is a supported pointer-linked header observation, not full-file validation.' };
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const old = ledger.find(item => item.ccn === row.ccn);
if (old && (old.evidence_run !== entry.evidence_run
    || JSON.stringify(old.evidence) !== JSON.stringify(entry.evidence))) {
  throw new Error('Existing nonmatching CHI St. Francis resolution');
}
if (!old) {
  ledger.push(entry); ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
}
console.log(JSON.stringify({ applied: !old, ccn: row.ccn }));
