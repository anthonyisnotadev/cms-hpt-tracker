'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-southwoods-html-pointer-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).find(row => row.ccn === '360352');
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const sha = body => crypto.createHash('sha256').update(body).digest('hex');
const pointerPath = path.join(root, 'cms_data/hpt/pointer-corpus/raw/southwoodshealth.com-7262debbe077.txt');
const samplePath = path.join(root, proof.retained_sample);

if (!base || base.finding !== 'compliant-date-unverified' || base.mrf_url !== proof.pointer_mrf_url
    || proof.pointer_sha256 !== sha(fs.readFileSync(pointerPath))
    || !fs.existsSync(samplePath) || proof.file_sha256 !== sha(fs.readFileSync(samplePath))
    || proof.pointer_http_status !== 200 || proof.page_http_status !== 200 || proof.file_http_status !== 206
    || proof.retained_bytes < 65536 || proof.version !== '3.0.0' || proof.declared_state !== 'OH'
    || proof.declared_hospital_name !== 'Surgery Center at Southwoods, LLC'
    || proof.exact_campus_address !== '7630 SOUTHERN BLVD, YOUNGSTOWN, OH 44512'
    || !proof.declared_address.split('|').includes(proof.exact_campus_address)
    || proof.declared_date !== '2026-02-17')
  throw new Error('Southwoods evidence incomplete or base changed');

const evidence = {
  identity: 'corroborated', identity_basis: 'first-party-hospital-campus-page-pricing-label-pointer-location-and-exact-campus-in-shared-file',
  pointerUrl: proof.pointer_url, pointerSha256: proof.pointer_sha256,
  pointerMrfUrl: proof.pointer_mrf_url, pointerMrfHttpStatus: proof.page_http_status,
  url: proof.file_url, fileSha256: proof.file_sha256, http_status: proof.file_http_status,
  checked_at: proof.observed_at, date: proof.declared_date, version: proof.version,
  officialDomain: proof.official_domain, location_name: proof.pointer_location_name,
  declared_hospital_name: proof.declared_hospital_name, declared_location_name: proof.declared_location_name,
  declared_address: proof.declared_address, exact_campus_address: proof.exact_campus_address,
  declared_license_state: proof.declared_state, file_kind: 'csv',
  sourcePageUrl: proof.pointer_mrf_url, sourcePageSha256: proof.page_sha256,
  identityPageUrl: proof.identity_url, identityPageSha256: proof.identity_sha256,
  observedFinding: 'pointer-links-html-download-page-with-file',
  pointerIssue: 'mrf-url-resolves-html-page-linking-file'
};
const entry = {
  ccn: '360352', base, action: 'replace-observation', evidence,
  evidence_run: 'southwoods-html-pointer-current-multi-location-file-2026-09-16', reviewed_at: proof.observed_at,
  note: 'The current root pointer names Surgical Hospital at Southwoods but places its HTML pricing page in mrf-url. That page labels a separate CSV as standard charges for all Surgical Hospital at Southwoods locations. A fresh retained sample declares Surgery Center at Southwoods, LLC, 2026-02-17 and CMS 3.0.0, and explicitly includes the exact 7630 Southern Boulevard hospital campus among several Ohio addresses. This proof applies only to CCN 360352; the file is not called directly pointer-linked and its other locations are not promoted.'
};
const old = ledger.find(row => row.ccn === entry.ccn);
if (old) {
  if (old.evidence_run !== entry.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(evidence))
    throw new Error('Existing nonmatching Southwoods resolution');
  console.log('{"applied":false}');
  process.exit(0);
}
ledger.push(entry);
ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
console.log(JSON.stringify({ applied: entry.ccn, finding: evidence.observedFinding }, null, 2));
