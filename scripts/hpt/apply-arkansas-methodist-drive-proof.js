'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-arkansas-methodist-drive-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).find(row => row.ccn === '040039');
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const sha = body => crypto.createHash('sha256').update(body).digest('hex');
const pointerPath = path.join(root, 'cms_data/hpt/pointer-corpus/raw/myammc.org-ad31bfbc96f4.txt');
const samplePath = path.join(root, proof.retained_sample);
const viewerId = proof.pointer_mrf_url.match(/^https:\/\/drive\.google\.com\/file\/d\/([^/]+)\/view\?usp=sharing$/)?.[1];

if (!base || base.finding !== 'compliant-date-unverified' || base.mrf_url !== proof.pointer_mrf_url
    || !viewerId || proof.file_url !== `https://drive.google.com/uc?export=download&id=${viewerId}`
    || proof.pointer_sha256 !== sha(fs.readFileSync(pointerPath))
    || !fs.existsSync(samplePath) || proof.file_sha256 !== sha(fs.readFileSync(samplePath))
    || ![200, 206].includes(proof.identity_http_status) || ![200, 206].includes(proof.pointer_http_status)
    || proof.viewer_http_status !== 200 || proof.file_http_status !== 206
    || proof.retained_bytes !== 262144 || !proof.file_content_range.startsWith('bytes 0-262143/')
    || proof.viewer_file_name !== '710230218_arkansas-methodist-medical-center_standardcharges.csv'
    || proof.declared_hospital_name !== 'Arkansas Methodist Hospital'
    || proof.declared_address !== '900 W Kingshighway Paragould AR 72450'
    || proof.declared_state !== 'AR' || proof.declared_date !== '2025-05-29'
    || proof.version !== '2.0.0')
  throw new Error('Arkansas Methodist Drive viewer/file evidence incomplete or base changed');

const evidence = {
  identity: 'corroborated', identity_basis: 'first-party-exact-hospital-address-and-pointer-viewer-csv-address',
  pointerUrl: proof.pointer_url, pointerSha256: proof.pointer_sha256,
  pointerMrfUrl: proof.pointer_mrf_url, pointerMrfHttpStatus: proof.viewer_http_status,
  url: proof.file_url, fileSha256: proof.file_sha256, http_status: proof.file_http_status,
  checked_at: proof.observed_at, date: proof.declared_date, version: proof.version,
  officialDomain: proof.official_domain, location_name: proof.pointer_location_name,
  declared_hospital_name: proof.declared_hospital_name, declared_address: proof.declared_address,
  declared_license_state: proof.declared_state, file_kind: 'csv',
  identityPageUrl: proof.identity_url, identityPageSha256: proof.identity_sha256,
  viewerFileName: proof.viewer_file_name, viewerSha256: proof.viewer_sha256,
  browserViewerObservedOn: proof.browser_viewer_observed_on,
  observedFinding: 'pointer-links-html-download-page-with-file',
  pointerIssue: 'mrf-url-resolves-html-page-linking-file'
};
const entry = {
  ccn: '040039', base, action: 'replace-observation', evidence,
  evidence_run: 'arkansas-methodist-drive-viewer-file-2026-09-16', reviewed_at: proof.observed_at,
  note: 'The current root pointer names Arkansas Methodist Hospital and links a Google Drive HTML viewer, not direct CSV bytes. The viewer displays the named CSV and its first rows. A fresh bounded download using the same Drive file ID retained 262,144 CSV bytes declaring Arkansas Methodist Hospital at 900 W Kingshighway, Paragould, Arkansas, dated 2025-05-29 on CMS template 2.0.0. The first-party hospital directory confirms the same campus. The older date and template remain explicit; this is not classified as a directly pointer-linked current file.'
};
const old = ledger.find(row => row.ccn === entry.ccn);
if (old) {
  if (old.evidence_run !== entry.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(evidence))
    throw new Error('Existing nonmatching Arkansas Methodist resolution');
  console.log('{"applied":false}');
  process.exit(0);
}
ledger.push(entry);
ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
console.log(JSON.stringify({ applied: entry.ccn, finding: evidence.observedFinding }));
