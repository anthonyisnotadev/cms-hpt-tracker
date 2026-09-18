'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-princeton-pointer-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
  .find(row => row.ccn === '310010');
const sample = fs.readFileSync(path.join(root, proof.retained_sample));
if (proof.ccn !== '310010' || !base || base.finding !== 'not-assessed-domain-unknown'
    || proof.roster_name !== 'UNIVERSITY MEDICAL CENTER OF PRINCETON AT PLAINSBORO'
    || proof.roster_address !== 'ONE-FIVE PLAINSBORO ROAD'
    || proof.roster_city !== 'PLAINSBORO' || proof.roster_state !== 'NJ' || proof.roster_zip !== '08536'
    || proof.identity_page_url !== 'https://www.pennmedicine.org/locations/princeton-medical-center'
    || proof.identity_page_address !== '1 Plainsboro Rd, Plainsboro Township, NJ 08536'
    || proof.pointer_url !== 'https://www.pennmedicine.org/cms-hpt.txt'
    || proof.pointer_http_status !== 200 || proof.pointer_bytes !== 5501
    || proof.pointer_sha256 !== '22b305b37ce20db17e5727e4c89d27822fc3f4c9221d1aa265048b96ad15954f'
    || proof.pointer_location_name !== 'Penn Medicine Princeton Health'
    || proof.pointer_source_page_url !== 'https://www.pennmedicine.org/patient-resources/policies/pricing-transparency'
    || proof.pointer_mrf_url !== 'https://tupa-q-001.sitecorecontenthub.cloud/api/public/content/210635009_penn-medicine-princeton-medical-center_standardcharges.csv'
    || proof.mrf_http_status !== 206 || proof.sample_bytes !== 65536
    || proof.total_bytes !== 248501573 || sample.length !== 65536
    || crypto.createHash('sha256').update(sample).digest('hex') !== proof.mrf_sha256
    || proof.declared_hospital_name !== 'Penn Medicine Princeton Medical Center'
    || !proof.declared_location_names.includes('Penn Medicine Princeton Medical Center')
    || !proof.declared_addresses.includes('1 Plainsboro Rd., Plainsboro, NJ 08536')
    || proof.declared_license_state !== 'NJ' || proof.declared_date !== '2026-03-20'
    || proof.version !== '3.0.0' || !Number.isFinite(Date.parse(proof.observed_at)))
  throw new Error('Princeton proof or base changed; manual review required');

const evidence = {
  identity: 'corroborated',
  identity_basis: 'first-party-current-campus-page-root-pointer-entry-and-bounded-multi-location-file-header',
  pointerUrl: proof.pointer_url, pointerSha256: proof.pointer_sha256,
  url: proof.pointer_mrf_url, fileSha256: proof.mrf_sha256,
  bytesRetained: proof.sample_bytes, fileTotalBytes: proof.total_bytes,
  http_status: proof.mrf_http_status, checked_at: proof.observed_at,
  date: proof.declared_date, version: proof.version,
  officialDomain: 'pennmedicine.org', location_name: proof.pointer_location_name,
  declared_hospital_name: proof.declared_hospital_name,
  declared_location_name: proof.declared_location_names,
  declared_address: proof.declared_addresses,
  declared_license_state: proof.declared_license_state,
  file_kind: 'csv', identityPageUrl: proof.identity_page_url,
  sourcePageUrl: proof.pointer_source_page_url, observedFinding: 'compliant-observed',
  next_action: proof.next_action,
};
const entry = { ccn: '310010', base, action: 'replace', evidence,
  evidence_run: 'princeton-current-pointer-header-2026-09-17', reviewed_at: proof.observed_at,
  note: 'The current first-party Princeton Medical Center page identifies 1 Plainsboro Rd, Plainsboro Township, NJ 08536, consistent with the roster ONE-FIVE PLAINSBORO ROAD campus. The current Penn Medicine root pointer has a Penn Medicine Princeton Health entry linking this exact CSV. A retained 65,536-byte sample of the 248,501,573-byte CSV declares Penn Medicine Princeton Medical Center at 1 Plainsboro Rd, NJ, 2026-03-20 and v3.0.0; the same file also names rehabilitation and behavioral-health locations. This is pointer/file/header identity recovery, not a full-file or legal compliance determination. The earlier domain-unknown result remains historical.' };
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const existing = ledger.find(row => row.ccn === entry.ccn);
if (existing && (existing.evidence_run !== entry.evidence_run || JSON.stringify(existing.evidence) !== JSON.stringify(entry.evidence)))
  throw new Error('Existing nonmatching Princeton resolution');
if (!existing) {
  ledger.push(entry);
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
}
console.log(JSON.stringify({ applied: !existing, ccn: entry.ccn, finding: 'compliant-observed', sample_sha256: proof.mrf_sha256 }));
