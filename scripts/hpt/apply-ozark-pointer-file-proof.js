'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const { record: row } = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-ozark-pointer-file-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).find(item => item.ccn === row.ccn);
const sample = fs.readFileSync(path.join(root, row.retained_sample));
if (row.ccn !== '041313' || !base || base.finding !== 'not-assessed-not-named-in-file'
    || base.domain !== 'ozarkhealth.net' || row.pointer_http_status !== 200
    || !row.pointer_content_type.startsWith('text/html') || row.current_mrf_http_status !== 206
    || row.retained_bytes !== 262144 || sample.length !== row.retained_bytes
    || crypto.createHash('sha256').update(sample).digest('hex') !== row.current_mrf_sha256
    || row.declared_hospital_name !== 'Ozark Health Inc.' || row.declared_location_name !== 'Ozark Health'
    || row.declared_address !== '2500 Highway 65 South, Clinton, AR, 72031-6588'
    || row.declared_state !== 'AR' || row.declared_date !== '2026-04-01'
    || row.version !== '3.0.0') throw new Error('Incomplete Ozark HTML-root/page-file proof');
const evidence = {
  identity: 'corroborated',
  identity_basis: 'official-location-page-pricing-page-and-file-header-exact-street-city-state',
  pointerUrl: row.pointer_url, pointerSha256: row.pointer_sha256,
  pointerHttpStatus: row.pointer_http_status, pointerContentType: row.pointer_content_type,
  url: row.current_mrf_url, fileSha256: row.current_mrf_sha256,
  http_status: row.current_mrf_http_status, checked_at: row.observed_at,
  date: row.declared_date, version: row.version, officialDomain: row.official_domain,
  location_name: row.declared_location_name, declared_hospital_name: row.declared_hospital_name,
  declared_address: row.declared_address, declared_license_state: row.declared_state,
  file_kind: 'csv', sourcePageUrl: row.source_page_url, sourcePageSha256: row.source_page_sha256,
  officialLocationUrl: row.official_location_url, officialLocationSha256: row.official_location_sha256,
  observedFinding: 'root-pointer-html-page-with-official-page-file',
  pointerIssue: 'root-path-serves-html-page',
  next_action: 'Retain the current first-party page-linked CSV and metadata. Recheck whether the root cms-hpt.txt path begins serving a plain-text pointer; do not treat its current HTML page as a working pointer document.',
};
const entry = { ccn: row.ccn, base, action: 'replace-observation', evidence,
  evidence_run: 'ozark-html-root-page-file-2026-09-16-041313', reviewed_at: row.observed_at,
  note: 'The current root cms-hpt.txt URL returns HTTP 200 text/html with pointer-style text naming the same CSV as the official pricing page. The root response is an HTML page, not a plain-text pointer document. A retained bounded CSV header identifies Ozark Health at the Clinton campus, Arkansas license state, 2026-04-01 and CMS 3.0.0; a separate first-party location page confirms the address. File availability and metadata are recorded without calling the HTML root a working pointer or inferring compliance.' };
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const old = ledger.find(item => item.ccn === row.ccn);
if (old && (old.evidence_run !== entry.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(entry.evidence))) {
  throw new Error('Existing nonmatching Ozark resolution');
}
if (!old) {
  ledger.push(entry); ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
}
console.log(JSON.stringify({ applied: !old, ccn: row.ccn }));
