'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-memorial-aurora-page-file-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
  .find(row => row.ccn === '281320');
const sample = fs.readFileSync(path.join(root, proof.retained_sample));
const pointerFileUrl = 'https://sthpiprd.blob.core.windows.net/machine-readable-files/7911/470461859_memorial-community-health-inc_standardcharges.csv';
const pageFileUrl = 'https://sthpiprd.blob.core.windows.net/machine-readable-files/7911/470461859_memorial-community-health%2C-inc_standardcharges.csv';
if (proof.ccn !== '281320' || !base || base.finding !== 'not-assessed-not-named-in-file'
    || base.domain !== 'upmc.com' || proof.official_domain !== 'memorialcommunityhealth.org'
    || proof.roster_address !== '1423 SEVENTH ST' || proof.roster_city !== 'AURORA'
    || proof.roster_state !== 'NE' || proof.roster_zip !== '68818'
    || proof.pointer_url !== 'https://memorialcommunityhealth.org/cms-hpt.txt'
    || proof.pointer_final_url !== 'https://search.hospitalpriceindex.com/7911/cms-hpt.txt'
    || ![200, 206].includes(proof.pointer_http_status)
    || proof.pointer_mrf_url !== pointerFileUrl || proof.pointer_mrf_http_status !== 404
    || proof.current_mrf_url !== pageFileUrl || proof.current_mrf_http_status !== 206
    || proof.rendered_source_download_url !== pageFileUrl
    || proof.rendered_source_heading !== 'Memorial Community Health'
    || proof.rendered_source_update !== '2026-05-14'
    || proof.source_page_url !== 'https://search.hospitalpriceindex.com/hpi2/machineReadable/MemorialCommunityHealth/7911'
    || !/^[a-f0-9]{64}$/.test(proof.pointer_sha256)
    || !/^[a-f0-9]{64}$/.test(proof.source_page_shell_sha256)
    || proof.retained_bytes !== 262144 || sample.length !== proof.retained_bytes
    || crypto.createHash('sha256').update(sample).digest('hex') !== proof.current_mrf_sha256
    || proof.declared_hospital_name !== 'Memorial Community Health, Inc'
    || proof.declared_location_name !== 'Memorial Hospital'
    || proof.declared_address !== '1423 7th St, Aurora, NE 68818'
    || proof.declared_state !== 'NE' || proof.declared_date !== '2026-05-14'
    || proof.version !== '3.0.0' || !proof.rendered_source_observed_at)
  throw new Error('Aurora proof or base changed; manual review required');

const evidence = {
  identity: 'corroborated',
  identity_basis: 'first-party-Aurora-hospital-location-root-pointer-source-route-rendered-download-link-and-retained-file-header-name-address-state',
  pointerUrl: proof.pointer_url, pointerSha256: proof.pointer_sha256,
  pointerHttpStatus: proof.pointer_http_status, pointerMrfUrl: proof.pointer_mrf_url,
  pointerMrfHttpStatus: proof.pointer_mrf_http_status,
  url: proof.current_mrf_url, fileSha256: proof.current_mrf_sha256,
  http_status: proof.current_mrf_http_status, checked_at: proof.observed_at,
  date: proof.declared_date, version: proof.version, officialDomain: proof.official_domain,
  location_name: proof.declared_location_name, declared_hospital_name: proof.declared_hospital_name,
  declared_address: proof.declared_address, declared_license_state: proof.declared_state,
  file_kind: 'csv', identityPageUrl: proof.identity_url, identityPageSha256: proof.identity_sha256,
  sourcePageUrl: proof.source_page_url, sourcePageShellSha256: proof.source_page_shell_sha256,
  browserSourceHeading: proof.rendered_source_heading,
  browserSourceObservedAt: proof.rendered_source_observed_at,
  observedFinding: 'pointer-links-unavailable-mrf-source-page-current-file',
  pointerIssue: 'pointer-mrf-http-error-current-source-page-file', next_action: proof.next_action,
};
const entry = { ccn: '281320', base, action: 'replace-observation', evidence,
  evidence_run: 'memorial-aurora-hpi-pointer-page-mismatch-2026-09-17',
  reviewed_at: proof.observed_at,
  note: 'Memorial Community Health first-party locations page identifies Memorial Hospital at 1423 7th Street, Aurora NE 68818. Its root pointer redirects to a Hospital Price Index pointer naming Memorial Hospital, but the pointer MRF returns 404. The pointer-declared source route visibly links a different CSV, whose retained bounded header declares the exact Aurora campus, NE, 2026-05-14 and v3.0.0. The working page CSV is not the working pointer target; complete-file structure and legal compliance are not established. The prior UPMC assignment remains historical.' };
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const existing = ledger.find(row => row.ccn === entry.ccn);
if (existing && (existing.evidence_run !== entry.evidence_run || JSON.stringify(existing.evidence) !== JSON.stringify(entry.evidence)))
  throw new Error('Existing nonmatching Aurora resolution');
if (!existing) {
  ledger.push(entry);
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
}
console.log(JSON.stringify({ applied: !existing, ccn: entry.ccn, finding: evidence.observedFinding }));
