'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-pontotoc-pointer-page-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
  .find(row => row.ccn === '251308');
const sample = fs.readFileSync(path.join(root, proof.retained_sample));
if (proof.ccn !== '251308' || !base || base.finding !== 'not-assessed-domain-unknown' || base.domain
    || proof.roster_name !== 'PONTOTOC HEALTH SERVICE INC CAH'
    || proof.roster_address !== '176 SOUTH MAIN STREET' || proof.roster_city !== 'PONTOTOC'
    || proof.roster_state !== 'MS' || proof.roster_zip !== '38863'
    || proof.official_domain !== 'nmhs.net'
    || proof.identity_url !== 'https://www.nmhs.net/locations/north-mississippi-medical-center-pontotoc'
    || !/^[a-f0-9]{64}$/.test(proof.identity_sha256)
    || proof.source_page_url !== 'https://www.nmhs.net/Patients-and-Visitors/Pricing/Price-Transparency'
    || !/^[a-f0-9]{64}$/.test(proof.source_page_sha256)
    || proof.pointer_url !== 'https://www.nmhs.net/cms-hpt.txt'
    || proof.pointer_http_status !== 206 || !/^[a-f0-9]{64}$/.test(proof.pointer_sha256)
    || proof.pointer_location_name !== 'Pontotoc Health Services, Inc.'
    || proof.pointer_mrf_url !== 'https://apps.nmhs.net/files/pt_mrf/640751410_pontotoc-health-services-inc_standardcharges.json'
    || proof.pointer_mrf_http_status !== 404
    || !/^[a-f0-9]{64}$/.test(proof.pointer_mrf_response_sha256)
    || proof.page_mrf_url !== 'https://apps.nmhs.net/files/pt_mrf/640751410_pontotoc-health-services,-inc-_standardcharges.json'
    || proof.page_mrf_http_status !== 206 || proof.page_mrf_sample_bytes !== 262144
    || sample.length !== proof.page_mrf_sample_bytes
    || crypto.createHash('sha256').update(sample).digest('hex') !== proof.page_mrf_sha256
    || proof.declared_hospital_name.trim() !== 'PONTOTOC HEALTH SERVICES, INC'
    || proof.declared_location_name.trim() !== 'PONTOTOC HEALTH SERVICES, INC'
    || proof.declared_address !== '176 South Main Street, Pontotoc, MS 38863'
    || proof.declared_license_state !== 'MS' || proof.declared_date !== '2026-04-01'
    || proof.version !== '3.0.0')
  throw new Error('Pontotoc proof or base changed; manual review required');

const evidence = {
  identity: 'corroborated',
  identity_basis: 'first-party-facility-page-exact-roster-address-root-pointer-pricing-page-link-and-retained-json-header',
  pointerUrl: proof.pointer_url, pointerSha256: proof.pointer_sha256,
  pointerHttpStatus: proof.pointer_http_status,
  pointerMrfUrl: proof.pointer_mrf_url, pointerMrfHttpStatus: proof.pointer_mrf_http_status,
  pointerMrfResponseSha256: proof.pointer_mrf_response_sha256,
  url: proof.page_mrf_url, fileSha256: proof.page_mrf_sha256,
  http_status: proof.page_mrf_http_status, checked_at: proof.observed_at,
  date: proof.declared_date, version: proof.version, officialDomain: proof.official_domain,
  location_name: proof.declared_location_name, declared_hospital_name: proof.declared_hospital_name,
  declared_address: proof.declared_address, declared_license_state: proof.declared_license_state,
  file_kind: 'json', identityPageUrl: proof.identity_url,
  identityPageSha256: proof.identity_sha256, sourcePageUrl: proof.source_page_url,
  sourcePageSha256: proof.source_page_sha256,
  observedFinding: 'pointer-links-unavailable-mrf-source-page-current-file',
  pointerIssue: 'pointer-mrf-http-error-current-source-page-file', next_action: proof.next_action,
};
const entry = { ccn: '251308', base, action: 'replace-observation', evidence,
  evidence_run: 'pontotoc-nmhs-pointer-page-mismatch-2026-09-17', reviewed_at: proof.observed_at,
  note: 'The NMHS first-party facility page names Pontotoc Health Services, Inc. DBA NMMC-Pontotoc at the exact 176 South Main Street roster campus. Its root pointer names Pontotoc but the pointer-declared JSON returns 404. Its price-transparency page links a distinct comma-containing JSON URL; a bounded header of that readable file identifies Pontotoc, the exact address, MS, 2026-04-01 and v3.0.0. The working page file is not the working pointer target. This is a bounded file observation, not complete-file validation or legal compliance.' };
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const existing = ledger.find(row => row.ccn === entry.ccn);
if (existing && (existing.evidence_run !== entry.evidence_run || JSON.stringify(existing.evidence) !== JSON.stringify(entry.evidence)))
  throw new Error('Existing nonmatching Pontotoc resolution');
if (!existing) {
  ledger.push(entry);
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
}
console.log(JSON.stringify({ applied: !existing, ccn: entry.ccn, finding: evidence.observedFinding }));
