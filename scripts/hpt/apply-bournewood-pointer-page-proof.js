'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const { records } = JSON.parse(fs.readFileSync(path.join(audit,
  'reconciliation-bournewood-pointer-page-proof.json'), 'utf8'));
if (records.length !== 1 || records[0].ccn !== '224022') throw new Error('Unexpected Bournewood proof cohort');
const p = records[0];
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
  .find(row => row.ccn === p.ccn);
const facility = JSON.parse(fs.readFileSync(path.join(root, 'cms_data/hpt/roster.json'), 'utf8'))
  .find(row => row.ccn === p.ccn);
const bytes = fs.readFileSync(path.join(root, p.retained_sample));
if (!base || base.finding !== 'not-assessed-domain-unknown' || base.domain || base.pointer_url || base.mrf_url
    || p.official_domain !== 'bournewood.com' || p.pointer_location_name !== 'Bournewood Health Systems'
    || p.pointer_http_status !== 200 || p.pointer_mrf_http_status !== 404
    || p.current_mrf_http_status !== 200 || p.pointer_mrf_url === p.current_mrf_url
    || p.retained_bytes !== 20266 || bytes.length !== p.retained_bytes
    || crypto.createHash('sha256').update(bytes).digest('hex') !== p.current_mrf_sha256
    || p.declared_hospital_name !== 'Bournewood Hospital'
    || p.declared_location_name !== 'Bournewood Hospital'
    || p.declared_address !== '300 SOUTH STREET  BROOKLINE  MA 02467'
    || p.declared_license_state !== null || p.declared_date !== '2026-08-31'
    || p.version !== '3.0.0' || facility?.address !== '300 SOUTH STREET'
    || facility.city !== 'BROOKLINE' || facility.state !== 'MA' || facility.zip !== '02467')
  throw new Error('Incomplete Bournewood proof or changed base');
const evidence = {
  identity: 'corroborated',
  identity_basis: 'current-first-party-pricing-and-contact-pages-plus-complete-page-file-header-name-address; standalone-license-state-not-declared',
  pointerUrl: p.pointer_url, pointerSha256: p.pointer_sha256,
  pointerHttpStatus: p.pointer_http_status, pointerMrfUrl: p.pointer_mrf_url,
  pointerMrfHttpStatus: p.pointer_mrf_http_status,
  url: p.current_mrf_url, fileSha256: p.current_mrf_sha256,
  http_status: p.current_mrf_http_status, checked_at: p.observed_at,
  date: p.declared_date, version: p.version, officialDomain: p.official_domain,
  location_name: p.declared_location_name, declared_hospital_name: p.declared_hospital_name,
  declared_address: p.declared_address, declared_license_state: '',
  file_kind: 'csv', sourcePageUrl: p.source_page_url, sourcePageSha256: p.source_page_sha256,
  observedFinding: 'pointer-links-unavailable-mrf-source-page-current-file',
  pointerIssue: 'pointer-mrf-http-error-current-source-page-file', next_action: p.next_action,
};
const entry = {
  ccn: p.ccn, base, action: 'replace-observation', evidence,
  evidence_run: 'bournewood-pointer-page-mismatch-2026-09-16-224022', reviewed_at: p.observed_at,
  note: 'The current Bournewood root pointer names a CSV returning HTTP 404. Its first-party pricing page links a different, complete 20,266-byte CSV declaring Bournewood Hospital at 300 South Street, Brookline MA 02467, 2026-08-31 and CMS v3.0.0. The first-party contact page and roster corroborate the address. The CSV lacks a standalone declared license-state field, and the page-linked file is not a working pointer target or a full structural validation.',
};
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const old = ledger.find(row => row.ccn === p.ccn);
if (old && (old.evidence_run !== entry.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(entry.evidence)))
  throw new Error('Existing nonmatching Bournewood resolution');
if (!old) {
  ledger.push(entry);
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
}
console.log(JSON.stringify({ applied: old ? [] : [p.ccn], already_present: !!old }));
