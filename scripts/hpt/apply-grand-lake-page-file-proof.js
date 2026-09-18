'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { csvToObjects } = require('./lib/util');
const { extractDeclared } = require('./lib/probe');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-grand-lake-page-file-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
  .find(row => row.ccn === proof.ccn);
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const retained = role => {
  const item = proof[role];
  const file = path.resolve(root, item.retained_sample);
  if (!file.startsWith(root + path.sep)) throw new Error('Proof sample outside repository');
  const bytes = fs.readFileSync(file);
  if (sha(bytes) !== (role === 'file' ? item.sample_sha256 : item.sha256))
    throw new Error(`Grand Lake ${role} sample hash mismatch`);
  return bytes;
};
const pointer = retained('pointer');
const page = retained('source_page');
const file = retained('file');
const meta = extractDeclared(file, 'csv');
if (proof.ccn !== '360032' || !base || base.finding !== 'not-assessed-domain-unknown'
  || base.domain || proof.pointer.http_status !== 200
  || !/^text\/html/i.test(proof.pointer.content_type)
  || !/^\s*<!doctype html/i.test(pointer.toString('utf8'))
  || !page.includes(Buffer.from(proof.file.url))
  || proof.file.http_status !== 206 || file.length !== 262144
  || proof.file.content_range !== 'bytes 0-262143/21434893'
  || meta.hospitalName !== 'Grand Lake Health System'
  || meta.locationName !== 'Grand Lake Health System'
  || meta.address !== '200 Saint Clair Street, Saint Marys, OH 45885'
  || meta.licenseState !== 'OH' || meta.raw !== '2026-04-01'
  || meta.version !== '3.0.0') throw new Error('Incomplete Grand Lake page/file proof');

const evidence = {
  identity: 'corroborated',
  identity_basis: 'official-locations-and-pricing-pages-and-file-header-exact-street-city-state',
  pointerUrl: proof.pointer.url, pointerSha256: proof.pointer.sha256,
  pointerHttpStatus: proof.pointer.http_status, pointerContentType: proof.pointer.content_type,
  url: proof.file.url, fileSha256: proof.file.sample_sha256,
  http_status: proof.file.http_status, checked_at: proof.observed_at,
  date: meta.raw, version: meta.version, officialDomain: 'grandlakehealth.org',
  location_name: meta.locationName, declared_hospital_name: meta.hospitalName,
  declared_address: meta.address, declared_license_state: meta.licenseState,
  file_kind: 'csv', sourcePageUrl: proof.source_page.url,
  sourcePageSha256: proof.source_page.sha256,
  officialLocationUrl: 'https://grandlakehealth.org/locations/',
  observedFinding: 'root-pointer-html-page-with-official-page-file',
  pointerIssue: 'root-path-serves-html-page',
  next_action: 'Retain the dated first-party page-linked CSV and exact facility header. Recheck whether root cms-hpt.txt begins serving a structured pointer to this file; do not treat the HTML response as one.'
};
const entry = { ccn: proof.ccn, base, action: 'replace-observation', evidence,
  evidence_run: 'grand-lake-html-root-page-file-2026-09-17-360032', reviewed_at: proof.observed_at,
  note: 'The current first-party root path returned HTTP 200 HTML, not a structured pointer. The official pricing page links a new August 2026 CSV whose bounded 262,144-byte header identifies Grand Lake Health System at the CMS roster address in Ohio, declares 2026-04-01 and template 3.0.0. The full 21.4 MB file and individual rates were not validated; no compliance conclusion follows.' };
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const old = ledger.find(row => row.ccn === proof.ccn);
if (old && (old.evidence_run !== entry.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(entry.evidence)))
  throw new Error('Existing nonmatching Grand Lake review');
if (!old) {
  ledger.push(entry);
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
}
console.log(JSON.stringify({ applied: !old, ccn: proof.ccn }));
