'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-onslow-html-pointer-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).find(row => row.ccn === '340042');
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const sha = body => crypto.createHash('sha256').update(body).digest('hex');
const pointerPath = path.join(root, 'cms_data/hpt/pointer-corpus/raw/onslow.org-8fae1d92d7f6.txt');
const samplePath = path.join(root, proof.retained_sample);

if (!base || base.finding !== 'compliant-date-unverified' || base.mrf_url !== proof.pointer_mrf_url
    || proof.pointer_sha256 !== sha(fs.readFileSync(pointerPath))
    || !fs.existsSync(samplePath) || proof.file_sha256 !== sha(fs.readFileSync(samplePath))
    || ![200, 206].includes(proof.identity_http_status) || ![200, 206].includes(proof.pointer_http_status)
    || ![200, 206].includes(proof.portal_http_status) || proof.file_http_status !== 206
    || proof.browser_portal_download_url !== proof.file_url
    || proof.browser_portal_heading !== 'Onslow Memorial Hospital'
    || proof.browser_portal_last_update !== '2026-04-28'
    || proof.retained_bytes !== 262144 || !proof.file_content_range.startsWith('bytes 0-262143/')
    || proof.declared_hospital_name !== 'Onslow Memorial Hospital, Inc'
    || proof.declared_address !== '317 Western Blvd, Jacksonville, NC 28546'
    || proof.declared_state !== 'NC' || proof.declared_date !== '2026-04-28'
    || proof.version !== '3.0.0')
  throw new Error('Onslow pointer/portal/file evidence incomplete or base changed');

const evidence = {
  identity: 'corroborated', identity_basis: 'first-party-exact-hospital-page-and-pointer-portal-file-with-street-city-state',
  pointerUrl: proof.pointer_url, pointerSha256: proof.pointer_sha256,
  pointerMrfUrl: proof.pointer_mrf_url, pointerMrfHttpStatus: proof.portal_http_status,
  url: proof.file_url, fileSha256: proof.file_sha256, http_status: proof.file_http_status,
  checked_at: proof.observed_at, date: proof.declared_date, version: proof.version,
  officialDomain: proof.official_domain, location_name: proof.pointer_location_name,
  declared_hospital_name: proof.declared_hospital_name, declared_address: proof.declared_address,
  declared_license_state: proof.declared_state, file_kind: 'csv',
  identityPageUrl: proof.identity_url, identityPageSha256: proof.identity_sha256,
  browserPortalObservedAt: proof.browser_portal_observed_at,
  browserPortalDownloadUrl: proof.browser_portal_download_url,
  observedFinding: 'pointer-links-html-download-page-with-file',
  pointerIssue: 'mrf-url-resolves-html-page-linking-file'
};
const entry = {
  ccn: '340042', base, action: 'replace-observation', evidence,
  evidence_run: 'onslow-html-portal-file-2026-09-16', reviewed_at: proof.observed_at,
  note: 'The current root pointer names Onslow Memorial Hospital but places the Hospital Price Index HTML route in mrf-url. In a rendered browser, that exact route displayed the hospital, a 2026-04-28 last-update date, and a Download File link to the retained CSV. A fresh 262,144-byte sample of the separately linked CSV identifies Onslow Memorial Hospital, Inc. at 317 Western Blvd, Jacksonville, North Carolina and declares 2026-04-28 on CMS 3.0.0. The first-party hospital site corroborates the campus. The file is portal-linked, not directly pointer-linked.'
};
const old = ledger.find(row => row.ccn === entry.ccn);
if (old) {
  if (old.evidence_run !== entry.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(evidence))
    throw new Error('Existing nonmatching Onslow resolution');
  console.log('{"applied":false}');
  process.exit(0);
}
ledger.push(entry);
ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
console.log(JSON.stringify({ applied: entry.ccn, finding: evidence.observedFinding }));
