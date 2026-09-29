'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit,
  'reconciliation-highland-hills-transition-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
  .find(row => row.ccn === '250172');
const sample = fs.readFileSync(path.join(root, proof.retained_sample));
if (proof.ccn !== '250172' || !base || base.finding !== 'not-assessed-not-named-in-file'
    || base.domain !== 'deltahealthsystem.org'
    || proof.roster_name !== 'HIGHLAND HILLS MEDICAL CENTER'
    || proof.roster_address !== '401 GETWELL DRIVE' || proof.roster_city !== 'SENATOBIA'
    || proof.roster_state !== 'MS' || proof.roster_zip !== '38668'
    || proof.current_official_domain !== 'highlandhillsmc.com'
    || proof.identity_page_url !== 'https://highlandhillsmc.com/contact-highland-hills/'
    || !/^[a-f0-9]{64}$/.test(proof.identity_page_sha256)
    || proof.pointer_url !== 'https://highlandhillsmc.com/cms-hpt.txt'
    || ![200, 206].includes(proof.pointer_http_status)
    || !/^[a-f0-9]{64}$/.test(proof.pointer_sha256)
    || proof.pointer_location_name !== 'Highland Hills Medical Center'
    || proof.mrf_url !== 'https://highlandhills.pg.quadax.revenuemasters.com/cdm-files/922135241_tate-county-hospital-dba-highland-hills-medical-center_standardcharges.csv'
    || proof.mrf_http_status !== 206 || proof.mrf_sample_bytes !== 262144
    || sample.length !== proof.mrf_sample_bytes
    || crypto.createHash('sha256').update(sample).digest('hex') !== proof.mrf_sample_sha256
    || proof.declared_hospital_name !== 'tate county hospital | highland hills medical center'
    || proof.declared_location_name !== 'tate county hospital | highland hills medical center'
    || proof.declared_address !== '401 Getwell Dr, Senatobia, MS 38668'
    || proof.declared_license_state !== 'MS' || proof.declared_date !== '2026-03-27'
    || proof.version !== '3.0.0')
  throw new Error('Highland Hills transition proof or base changed');

const evidence = {
  identity: 'corroborated',
  identity_basis: 'first-party-current-hospital-page-former-publisher-sale-source-exact-root-pointer-and-retained-file-header-name-address-state',
  pointerUrl: proof.pointer_url, pointerSha256: proof.pointer_sha256,
  url: proof.mrf_url, fileSha256: proof.mrf_sample_sha256,
  http_status: proof.mrf_http_status, checked_at: proof.observed_at,
  date: proof.declared_date, version: proof.version,
  officialDomain: proof.current_official_domain,
  location_name: proof.declared_location_name,
  declared_hospital_name: proof.declared_hospital_name,
  declared_address: proof.declared_address,
  declared_license_state: proof.declared_license_state,
  file_kind: 'csv', identityPageUrl: proof.identity_page_url,
  identityPageSha256: proof.identity_page_sha256,
  sourcePageUrl: proof.pricing_page_url,
  sourcePageSha256: proof.pricing_page_sha256,
  transitionPageUrl: proof.transition_page_url,
  transitionWebReaderObservation: proof.transition_web_reader_observation,
  next_action: proof.next_action,
};
const entry = { ccn: '250172', base, action: 'replace', evidence,
  evidence_run: 'highland-hills-current-publisher-transition-2026-09-17',
  reviewed_at: proof.observed_at,
  note: 'Delta Health System announced sale of Highland Hills to the Tate County Board of Supervisors in 2023. The current Highland Hills first-party site identifies the exact Senatobia roster campus, its root pointer names Highland Hills, and the pointer-linked CSV bounded header declares Tate County Hospital | Highland Hills Medical Center at 401 Getwell Dr, Senatobia MS 38668, MS license-state field, 2026-03-27 and v3.0.0. The old Delta-domain nonmatch remains historical. This is bounded header/access observation, not complete-file validation or legal compliance.' };
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const existing = ledger.find(row => row.ccn === entry.ccn);
if (existing && (existing.evidence_run !== entry.evidence_run || JSON.stringify(existing.evidence) !== JSON.stringify(entry.evidence)))
  throw new Error('Existing nonmatching Highland Hills resolution');
if (!existing) {
  ledger.push(entry);
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
}
console.log(JSON.stringify({ applied: !existing, ccn: entry.ccn,
  current_domain: proof.current_official_domain, file_sha256: proof.mrf_sample_sha256 }));
