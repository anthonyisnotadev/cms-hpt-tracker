'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-holy-name-pointer-not-found-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).find(row => row.ccn === '310008');
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const sha = body => crypto.createHash('sha256').update(body).digest('hex');
const pointerPath = path.join(root, 'cms_data/hpt/pointer-corpus/raw/holyname.org-6b5a83f07ce4.txt');
const samplePath = path.join(root, proof.retained_sample);

if (!base || base.finding !== 'compliant-date-unverified' || base.mrf_url !== proof.pointer_mrf_url
    || proof.pointer_sha256 !== sha(fs.readFileSync(pointerPath))
    || !fs.existsSync(samplePath) || proof.file_sha256 !== sha(fs.readFileSync(samplePath))
    || ![200, 206].includes(proof.pricing_http_status) || ![200, 206].includes(proof.pointer_http_status)
    || proof.pointer_mrf_http_status !== 200 || proof.pointer_mrf_html_title !== '404'
    || proof.browser_pointer_target_heading !== '404 - Page Not Found'
    || proof.browser_pointer_target_final_url !== proof.pointer_mrf_url
    || proof.file_http_status !== 206 || proof.retained_bytes !== 262144
    || !proof.file_content_range.startsWith('bytes 0-262143/')
    || proof.declared_hospital_name !== 'Holy Name'
    || proof.declared_location_name !== 'Holy Name Medical Center'
    || proof.declared_address !== '718 Teaneck Road, Teaneck, NJ 07666'
    || proof.declared_state !== 'NJ' || proof.declared_date !== '2025-11-10'
    || proof.version !== '3.0.0')
  throw new Error('Holy Name pointer/pricing/file evidence incomplete or base changed');

const evidence = {
  identity: 'corroborated', identity_basis: 'first-party-pricing-page-and-file-with-exact-hospital-address',
  pointerUrl: proof.pointer_url, pointerSha256: proof.pointer_sha256,
  pointerMrfUrl: proof.pointer_mrf_url, pointerMrfHttpStatus: proof.pointer_mrf_http_status,
  browserPointerTargetFinalUrl: proof.browser_pointer_target_final_url,
  browserPointerTargetObservedAt: proof.browser_pointer_target_observed_at,
  browserPointerTargetHeading: proof.browser_pointer_target_heading,
  url: proof.file_url, fileSha256: proof.file_sha256, http_status: proof.file_http_status,
  checked_at: proof.observed_at, date: proof.declared_date, version: proof.version,
  officialDomain: proof.official_domain, location_name: proof.pointer_location_name,
  declared_hospital_name: proof.declared_hospital_name,
  declared_location_name: proof.declared_location_name,
  declared_address: proof.declared_address, declared_license_state: proof.declared_state,
  file_kind: 'csv', sourcePageUrl: proof.pricing_url, sourcePageSha256: proof.pricing_sha256,
  observedFinding: 'pointer-file-url-renders-not-found-source-page-current-file',
  pointerIssue: 'pointer-file-like-url-renders-not-found'
};
const entry = {
  ccn: '310008', base, action: 'replace-observation', evidence,
  evidence_run: 'holy-name-pointer-not-found-source-page-file-2026-09-16', reviewed_at: proof.observed_at,
  note: 'Holy Name Medical Center’s current root pointer names the Teaneck hospital but its .csv mrf-url returns HTTP 200 HTML titled 404 and renders “404 - Page Not Found” in a browser. The first-party pricing page at the same hospital links a different CSV. Fresh retained bytes from that page-linked file identify Holy Name Medical Center at 718 Teaneck Road, Teaneck, New Jersey and declare 2025-11-10 on CMS 3.0.0. The current file is not directly linked by the root pointer; the HTTP 200 wrapper is not treated as a successful CSV response.'
};
const old = ledger.find(row => row.ccn === entry.ccn);
if (old) {
  if (old.evidence_run !== entry.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(evidence))
    throw new Error('Existing nonmatching Holy Name resolution');
  console.log('{"applied":false}');
  process.exit(0);
}
ledger.push(entry);
ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
console.log(JSON.stringify({ applied: entry.ccn, finding: evidence.observedFinding }));
