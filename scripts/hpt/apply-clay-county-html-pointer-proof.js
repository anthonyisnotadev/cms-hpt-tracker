'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-clay-county-html-pointer-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).find(row => row.ccn === '010073');
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const sha = body => crypto.createHash('sha256').update(body).digest('hex');
const pointerPath = path.join(root, 'cms_data/hpt/pointer-corpus/raw/claycountyhospital.com-ca0b46943645.txt');
const samplePath = path.join(root, proof.retained_sample);

if (!base || base.finding !== 'compliant-date-unverified' || base.mrf_url !== proof.pointer_mrf_url
    || proof.pointer_sha256 !== sha(fs.readFileSync(pointerPath))
    || !fs.existsSync(samplePath) || proof.file_sha256 !== sha(fs.readFileSync(samplePath))
    || proof.page_http_status !== 200 || proof.pointer_http_status !== 206
    || proof.file_http_status !== 206 || proof.retained_bytes < 65536
    || proof.version !== '3.0.0' || proof.declared_state !== 'AL'
    || proof.declared_location_name !== 'Clay County Hospital'
    || proof.declared_date !== '2026-03-23')
  throw new Error('Clay County evidence incomplete or base changed');

const evidence = {
  identity: 'corroborated', identity_basis: 'official-contact-page-pointer-location-pricing-page-link-and-file-exact-street-city-state',
  pointerUrl: proof.pointer_url, pointerSha256: proof.pointer_sha256,
  pointerMrfUrl: proof.pointer_mrf_url, pointerMrfHttpStatus: proof.page_http_status,
  url: proof.file_url, fileSha256: proof.file_sha256, http_status: proof.file_http_status,
  checked_at: proof.observed_at, date: proof.declared_date, version: proof.version,
  officialDomain: proof.official_domain, location_name: proof.declared_location_name,
  declared_hospital_name: proof.declared_hospital_name, declared_address: proof.declared_address,
  declared_license_state: proof.declared_state, file_kind: 'csv',
  sourcePageUrl: proof.pointer_mrf_url, sourcePageSha256: proof.page_sha256,
  identityPageUrl: proof.identity_url, identityPageSha256: proof.identity_sha256,
  observedFinding: 'pointer-links-html-download-page-with-file',
  pointerIssue: 'mrf-url-resolves-html-page-linking-file'
};
const entry = {
  ccn: '010073', base, action: 'replace-observation', evidence,
  evidence_run: 'clay-county-html-pointer-current-file-2026-09-16', reviewed_at: proof.observed_at,
  note: 'The current root pointer names Clay County Hospital but labels its HTML hospital-pricing page as mrf-url. That page directly links a separate CSV. A fresh retained file sample declares Clay County Hospital at the exact Ashland campus, Alabama, 2026-03-23 and CMS 3.0.0. The file is official-page-linked evidence, not a direct pointer MRF; retain the pointer defect as an explicit observed result.'
};
const old = ledger.find(row => row.ccn === entry.ccn);
if (old) {
  if (old.evidence_run !== entry.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(evidence))
    throw new Error('Existing nonmatching Clay County resolution');
  console.log('{"applied":false}');
  process.exit(0);
}
ledger.push(entry);
ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
console.log(JSON.stringify({ applied: entry.ccn, finding: evidence.observedFinding }, null, 2));
