'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');
const { parsePointer } = require('./lib/parse');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-montefiore-new-rochelle-pointer-page-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
  .find(row => row.ccn === '330184');
const pointerSample = fs.readFileSync(path.join(root, proof.pointer_file_retained_sample));
const pageSample = fs.readFileSync(path.join(root, proof.page_file_retained_sample));
const rawPointer = fs.readFileSync(path.join(root, 'cms_data/hpt/pointer-corpus/raw/montefiorenewrochelle.org-aa9d68ea6d9a.txt'));
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const entry = parsePointer(rawPointer.toString('utf8')).entries[0];
if (proof.ccn !== '330184' || !base || base.finding !== 'not-assessed-domain-unknown'
    || proof.roster_name !== 'MONTEFIORE NEW ROCHELLE HOSPITAL'
    || proof.roster_address !== '16 GUION PLACE' || proof.roster_city !== 'NEW ROCHELLE'
    || proof.roster_state !== 'NY' || proof.roster_zip !== '10802'
    || proof.identity_page_url !== 'https://montefiorenewrochelle.org/contact-us'
    || !/^[a-f0-9]{64}$/.test(proof.identity_page_sha256)
    || proof.identity_page_address !== '16 Guion Place, New Rochelle, NY 10801'
    || proof.source_page_url !== 'https://montefiorenewrochelle.org/patients-and-visitors/paying-for-your-care'
    || !/^[a-f0-9]{64}$/.test(proof.source_page_sha256)
    || proof.source_page_declared_update !== '4/01/26' || proof.source_page_links_page_file !== true
    || proof.pointer_url !== 'https://montefiorenewrochelle.org/cms-hpt.txt'
    || proof.pointer_sha256 !== '14b50692ceb16c22e360e7e100f9431584c74cf560e7b0f40f3e94535b1c2833'
    || digest(rawPointer) !== proof.pointer_sha256 || proof.pointer_bytes !== 363
    || proof.pointer_line_endings !== 'CR-only'
    || proof.pointer_location_name !== 'Montefiore New Rochelle'
    || entry.locationName !== proof.pointer_location_name
    || entry.mrfUrl !== proof.pointer_mrf_url
    || entry.sourcePageUrl !== proof.source_page_url
    || proof.pointer_mrf_url !== 'https://assets.montefioreeinstein.org/patient-information/462931956_new-rochelle-hospital_standardcharges.csv'
    || proof.pointer_file_http_status !== 206 || proof.pointer_file_sample_bytes !== 262144
    || proof.pointer_file_total_bytes !== 166983064 || pointerSample.length !== 262144
    || digest(pointerSample) !== proof.pointer_file_sample_sha256
    || proof.pointer_file_declared_name !== 'Montefiore New Rochelle Hospital'
    || proof.pointer_file_declared_address !== '16 Guion Place, New Rochelle, NY 10801'
    || proof.pointer_file_declared_state !== 'NY'
    || proof.pointer_file_date !== '2025-06-27' || proof.pointer_file_version !== '2.0.0'
    || proof.page_mrf_url !== 'https://asset-storage-prod.s3.us-east-1.amazonaws.com/patient-information/492931956_new-rochelle-hospital_standardcharges.csv'
    || proof.page_file_http_status !== 206 || proof.page_file_sample_bytes !== 262144
    || proof.page_file_total_bytes !== 299963990 || pageSample.length !== 262144
    || digest(pageSample) !== proof.page_file_sample_sha256
    || proof.page_file_declared_name !== 'Montefiore New Rochelle Hospital'
    || proof.page_file_declared_address !== '16 Guion Place, New Rochelle, NY 10801'
    || proof.page_file_declared_state !== 'NY'
    || proof.page_file_date !== '2026-04-01' || proof.page_file_version !== '3.0.0'
    || !Number.isFinite(Date.parse(proof.observed_at)))
  throw new Error('Montefiore New Rochelle proof or base changed; manual review required');

const evidence = {
  identity: 'corroborated',
  identity_basis: 'current-first-party-contact-exact-street-city-pointer-cr-only-parsed-entry-and-two-byte-backed-facility-headers-with-roster-zip-exception',
  pointerUrl: proof.pointer_url, pointerSha256: proof.pointer_sha256,
  pointerIssue: 'pointer-and-current-source-page-mrf-differ',
  pointerMrfUrl: proof.pointer_mrf_url,
  pointerMrfSha256: proof.pointer_file_sample_sha256,
  pointerMrfHttpStatus: proof.pointer_file_http_status,
  pointerMrfDate: proof.pointer_file_date, pointerMrfVersion: proof.pointer_file_version,
  url: proof.page_mrf_url, fileSha256: proof.page_file_sample_sha256,
  bytesRetained: proof.page_file_sample_bytes, fileTotalBytes: proof.page_file_total_bytes,
  http_status: proof.page_file_http_status, checked_at: proof.observed_at,
  date: proof.page_file_date, version: proof.page_file_version,
  officialDomain: 'montefiorenewrochelle.org', location_name: proof.pointer_location_name,
  declared_hospital_name: proof.page_file_declared_name,
  declared_location_name: proof.page_file_declared_name,
  declared_address: proof.page_file_declared_address,
  declared_license_state: proof.page_file_declared_state,
  facility_address: proof.identity_page_address, roster_zip: proof.roster_zip,
  file_kind: 'csv', identityPageUrl: proof.identity_page_url,
  identityPageSha256: proof.identity_page_sha256,
  sourcePageUrl: proof.source_page_url, sourcePageSha256: proof.source_page_sha256,
  observedFinding: 'pointer-links-older-mrf-than-source-page', next_action: proof.next_action,
};
const resolution = { ccn: '330184', base, action: 'replace-observation', evidence,
  evidence_run: 'montefiore-cr-only-pointer-older-file-current-page-2026-09-17', reviewed_at: proof.observed_at,
  note: 'The publisher root pointer uses CR-only line endings, now parsed without altering raw bytes. It names Montefiore New Rochelle and links a readable 166,983,064-byte CSV whose bounded header declares this hospital at 16 Guion Place, New Rochelle NY 10801, 2025-06-27 and v2.0.0. The current first-party paying-for-care page links a different 299,963,990-byte CSV whose bounded header declares the same hospital/address, 2026-04-01 and v3.0.0. The contact page also lists 16 Guion Place, but the roster ZIP is 10802 while both files and the current first-party page say 10801. Retain that ZIP discrepancy and both file URL roles. The newer page file is not pointer-linked, and neither bounded sample establishes complete-file validity or legal compliance. The earlier generic domain-unknown result remains historical.' };
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const existing = ledger.find(row => row.ccn === resolution.ccn);
if (existing && (existing.evidence_run !== resolution.evidence_run || JSON.stringify(existing.evidence) !== JSON.stringify(resolution.evidence)))
  throw new Error('Existing nonmatching Montefiore New Rochelle resolution');
if (!existing) {
  ledger.push(resolution);
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
}
console.log(JSON.stringify({ applied: !existing, ccn: resolution.ccn,
  finding: evidence.observedFinding, page_sample_sha256: proof.page_file_sample_sha256 }));
