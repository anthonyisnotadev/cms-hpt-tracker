'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-bucktail-html-pointer-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).find(row => row.ccn === '391304');
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const sha = body => crypto.createHash('sha256').update(body).digest('hex');
const pointerPath = path.join(root, 'cms_data/hpt/pointer-corpus/raw/bucktailmedicalcenter.org-318fa2e421f3.txt');
const samplePath = path.join(root, proof.retained_sample);

if (!base || base.finding !== 'compliant-date-unverified' || base.mrf_url !== proof.pointer_mrf_url
    || proof.pointer_sha256 !== sha(fs.readFileSync(pointerPath))
    || !fs.existsSync(samplePath) || proof.file_sha256 !== sha(fs.readFileSync(samplePath))
    || proof.page_http_status !== 200 || proof.file_http_status !== 206
    || proof.retained_bytes !== 841769 || proof.version !== '3.0.0'
    || proof.declared_state !== 'PA' || proof.declared_location_name !== 'Bucktail Medical Center'
    || proof.declared_date !== '2026-03-29')
  throw new Error('Bucktail evidence incomplete or base changed');

const evidence = {
  identity: 'corroborated', identity_basis: 'official-facility-page-pointer-location-html-pricing-link-and-zip-file-exact-street-city-state',
  pointerUrl: proof.pointer_url, pointerSha256: proof.pointer_sha256,
  pointerMrfUrl: proof.pointer_mrf_url, pointerMrfHttpStatus: proof.page_http_status,
  url: proof.file_url, fileSha256: proof.file_sha256, http_status: proof.file_http_status,
  checked_at: proof.observed_at, date: proof.declared_date, version: proof.version,
  officialDomain: proof.official_domain, location_name: proof.declared_location_name,
  declared_hospital_name: proof.declared_hospital_name, declared_address: proof.declared_address,
  declared_license_state: proof.declared_state, file_kind: 'csv.zip', member: proof.member,
  sourcePageUrl: proof.pointer_mrf_url, sourcePageSha256: proof.page_sha256,
  identityPageUrl: proof.identity_url, identityPageSha256: proof.identity_sha256,
  observedFinding: 'pointer-links-html-download-page-with-file',
  pointerIssue: 'mrf-url-resolves-html-page-linking-file'
};
const entry = {
  ccn: '391304', base, action: 'replace-observation', evidence,
  evidence_run: 'bucktail-html-pointer-current-file-2026-09-16', reviewed_at: proof.observed_at,
  note: 'The current root pointer names Bucktail Medical Center but labels an HTML price-transparency page as mrf-url. That page and the current official hospital pricing page link a separate ZIP containing a CSV whose retained full bytes identify the exact 1001 Pine Street, Renovo, Pennsylvania campus and declare 2026-03-29 and CMS 3.0.0. Retain the page-linked file evidence and the pointer defect separately; do not describe the ZIP as directly pointer-linked.'
};
const old = ledger.find(row => row.ccn === entry.ccn);
if (old) {
  if (old.evidence_run !== entry.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(evidence))
    throw new Error('Existing nonmatching Bucktail resolution');
  console.log('{"applied":false}');
  process.exit(0);
}
ledger.push(entry);
ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
console.log(JSON.stringify({ applied: entry.ccn, finding: evidence.observedFinding }, null, 2));
