'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-oss-portal-not-found-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).find(row => row.ccn === '390325');
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const sha = body => crypto.createHash('sha256').update(body).digest('hex');
const pointerPath = path.join(root, 'cms_data/hpt/pointer-corpus/raw/osshealth.com-21f277c3d872.txt');
const samplePath = path.join(root, proof.retained_sample);

if (!base || base.finding !== 'compliant-date-unverified' || base.mrf_url !== proof.pointer_mrf_url
    || proof.pointer_sha256 !== sha(fs.readFileSync(pointerPath))
    || !fs.existsSync(samplePath) || proof.file_sha256 !== sha(fs.readFileSync(samplePath))
    || proof.identity_http_status !== 200 || proof.pricing_http_status !== 200
    || proof.pointer_http_status !== 206 || proof.portal_script_http_status !== 206
    || proof.file_http_status !== 206 || proof.retained_bytes < 65536
    || !proof.browser_portal_final_url.endsWith('/not-found')
    || !proof.browser_portal_excerpt.includes('404 Page does not exist')
    || proof.version !== '3.0.0' || proof.declared_state !== 'PA'
    || proof.declared_hospital_name !== 'OSS Orthopaedic Hospital'
    || proof.declared_address !== '1861 Powder Mill Rd, York, PA 17402'
    || proof.declared_date !== '2026-04-01')
  throw new Error('OSS portal/file evidence incomplete or base changed');

const evidence = {
  identity: 'corroborated', identity_basis: 'first-party-exact-hospital-page-and-pricing-file-with-street-city-state',
  pointerUrl: proof.pointer_url, pointerSha256: proof.pointer_sha256,
  pointerMrfUrl: proof.pointer_mrf_url, pointerMrfHttpStatus: proof.portal_script_http_status,
  browserPortalFinalUrl: proof.browser_portal_final_url,
  browserPortalObservedAt: proof.browser_portal_observed_at,
  browserPortalExcerpt: proof.browser_portal_excerpt,
  url: proof.file_url, fileSha256: proof.file_sha256, http_status: proof.file_http_status,
  checked_at: proof.observed_at, date: proof.declared_date, version: proof.version,
  officialDomain: proof.official_domain, location_name: proof.pointer_location_name,
  declared_hospital_name: proof.declared_hospital_name, declared_address: proof.declared_address,
  declared_license_state: proof.declared_state, file_kind: 'csv',
  sourcePageUrl: proof.pricing_url, sourcePageSha256: proof.pricing_sha256,
  identityPageUrl: proof.identity_url, identityPageSha256: proof.identity_sha256,
  observedFinding: 'pointer-html-portal-not-found-source-page-current-file',
  pointerIssue: 'pointer-html-portal-renders-not-found'
};
const entry = {
  ccn: '390325', base, action: 'replace-observation', evidence,
  evidence_run: 'oss-portal-not-found-first-party-file-2026-09-16', reviewed_at: proof.observed_at,
  note: 'OSS Health’s current root pointer names a third-party HTML standard-charges route. A scripted request returns HTTP 206 HTML, while a real browser renders a /not-found route and a 404 message. The first-party OSS Orthopaedic Hospital page identifies 1861 Powder Mill Road, York, Pennsylvania, and the first-party pricing page directly links a separate CSV whose fresh retained bytes declare the exact hospital, address, Pennsylvania, 2026-04-01 and CMS 3.0.0. Retain the current file evidence without calling it pointer-linked or treating the HTML route as a working download intermediary.'
};
const old = ledger.find(row => row.ccn === entry.ccn);
if (old) {
  if (old.evidence_run !== entry.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(evidence))
    throw new Error('Existing nonmatching OSS resolution');
  console.log('{"applied":false}');
  process.exit(0);
}
ledger.push(entry);
ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
console.log(JSON.stringify({ applied: entry.ccn, finding: evidence.observedFinding }, null, 2));
