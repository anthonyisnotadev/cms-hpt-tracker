'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const { record: row } = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-burgess-pointer-mismatch-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).find(item => item.ccn === row.ccn);
const sample = fs.readFileSync(path.join(root, row.retained_sample));
if (row.ccn !== '161359' || !base || base.finding !== 'mrf-url-unreachable'
    || base.domain !== 'burgesshc.org' || row.pointer_http_status !== 206
    || row.pointer_mrf_http_status !== 404 || row.current_mrf_http_status !== 206
    || row.pointer_mrf_url === row.current_mrf_url || row.retained_bytes !== 262144
    || sample.length !== row.retained_bytes
    || crypto.createHash('sha256').update(sample).digest('hex') !== row.current_mrf_sha256
    || row.declared_hospital_name !== 'Burgess Health Center'
    || row.declared_address !== '1600 Diamond Street, Onawa, IA 51040-1548'
    || row.declared_state !== 'IA' || row.declared_date !== '2026-03-31'
    || row.version !== '3.0.0') throw new Error('Incomplete Burgess proof');

const evidence = {
  identity: 'corroborated',
  identity_basis: 'official-pricing-page-facility-page-and-file-header-exact-name-street-city-state',
  pointerUrl: row.pointer_url, pointerSha256: row.pointer_sha256,
  pointerHttpStatus: row.pointer_http_status, pointerMrfUrl: row.pointer_mrf_url,
  pointerMrfHttpStatus: row.pointer_mrf_http_status,
  url: row.current_mrf_url, fileSha256: row.current_mrf_sha256,
  http_status: row.current_mrf_http_status, checked_at: row.observed_at,
  date: row.declared_date, version: row.version, officialDomain: row.official_domain,
  location_name: row.declared_location_name, declared_hospital_name: row.declared_hospital_name,
  declared_address: row.declared_address, declared_license_state: row.declared_state,
  file_kind: 'csv', sourcePageUrl: row.source_page_url, sourcePageSha256: row.source_page_sha256,
  officialIdentityUrl: row.official_identity_url, officialIdentitySha256: row.official_identity_sha256,
  observedFinding: 'pointer-links-unavailable-mrf-source-page-current-file',
  pointerIssue: 'pointer-mrf-http-error-current-source-page-file', next_action: row.next_action,
};
const entry = { ccn: row.ccn, base, action: 'replace-observation', evidence,
  evidence_run: 'burgess-pointer-file-mismatch-2026-09-16-161359', reviewed_at: row.observed_at,
  note: 'The current Burgess root pointer names an older CSV that returns HTTP 404. Its first-party pricing page separately links a newer CDN CSV whose retained header identifies the matching Onawa facility and address, Iowa license state, 2026-03-31 date, and CMS 3.0.0. The official facility page corroborates the location. This is a current page-linked file, not a working pointer-linked file or compliance conclusion.' };
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const old = ledger.find(item => item.ccn === row.ccn);
if (old && (old.evidence_run !== entry.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(entry.evidence))) {
  throw new Error('Existing nonmatching Burgess resolution');
}
if (!old) {
  ledger.push(entry); ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
}
console.log(JSON.stringify({ applied: !old, ccn: row.ccn }));
