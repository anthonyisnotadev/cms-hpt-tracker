'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-uvm-medical-center-alias-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).find(row => row.ccn === '470003');
const sample = fs.readFileSync(path.join(root, proof.retained_sample));
if (!base || base.finding !== 'not-assessed-domain-unknown'
    || proof.ccn !== '470003' || proof.roster_name !== 'UNIV. OF VERMONT - FLETCHER ALLEN HEALTH CARE'
    || proof.roster_address !== '111 COLCHESTER AVE' || proof.roster_city !== 'BURLINGTON'
    || proof.roster_state !== 'VT' || proof.roster_zip !== '05401'
    || proof.history_page_url !== 'https://www.uvmhealth.org/locations/university-of-vermont-medical-center/history'
    || !/^[a-f0-9]{64}$/.test(proof.history_page_sha256)
    || proof.history_explicit_former_name !== 'Fletcher Allen Health Care'
    || proof.identity_page_url !== 'https://www.uvmhealth.org/locations/university-of-vermont-medical-center'
    || !/^[a-f0-9]{64}$/.test(proof.identity_page_sha256)
    || proof.pricing_page_links_file !== true || !/^[a-f0-9]{64}$/.test(proof.pricing_page_sha256)
    || proof.pointer_url !== 'https://www.uvmhealth.org/cms-hpt.txt'
    || proof.pointer_sha256 !== 'b9584a0bdb9b08b1a972d0c701d507c76f3bafa1591a59f1ab5e56998402e014'
    || proof.pointer_entry_count !== 6 || proof.pointer_location_name !== 'University of Vermont Medical Center'
    || proof.mrf_url !== 'https://www.uvmhealth.org/sites/default/files/030219309_university-of-vermont-medical-center-inc_standardcharges.csv'
    || proof.file_http_status !== 206 || proof.file_sample_bytes !== 262144 || proof.file_total_bytes !== 273530788
    || sample.length !== 262144 || crypto.createHash('sha256').update(sample).digest('hex') !== proof.file_sample_sha256
    || proof.declared_hospital_name !== 'University of Vermont Medical Center Inc'
    || !proof.declared_location_names.includes('University of Vermont Medical Center - Rehabilitation Unit')
    || !proof.declared_addresses.includes('111 Colchester Avenue, Burlington, VT 05401')
    || !proof.declared_addresses.includes('790 College Parkway, Colchester, VT 05446')
    || proof.declared_license_state !== 'VT' || proof.declared_date !== '2026-04-28'
    || proof.version !== '3.0.0' || !Number.isFinite(Date.parse(proof.observed_at)))
  throw new Error('UVM Medical Center proof or base changed; manual review required');

const evidence = {
  identity: 'corroborated',
  identity_basis: 'first-party-history-explicitly-links-fletcher-allen-former-name-to-uvm-medical-center-with-exact-burlington-campus-pointer-pricing-and-file-header',
  pointerUrl: proof.pointer_url, pointerSha256: proof.pointer_sha256,
  url: proof.mrf_url, fileSha256: proof.file_sample_sha256,
  bytesRetained: proof.file_sample_bytes, fileTotalBytes: proof.file_total_bytes,
  http_status: proof.file_http_status, checked_at: proof.observed_at,
  date: proof.declared_date, version: proof.version, officialDomain: 'uvmhealth.org',
  location_name: proof.pointer_location_name,
  declared_hospital_name: proof.declared_hospital_name,
  declared_location_name: proof.declared_location_names,
  declared_address: proof.declared_addresses,
  declared_license_state: proof.declared_license_state, file_kind: 'csv',
  identityPageUrl: proof.identity_page_url, identityPageSha256: proof.identity_page_sha256,
  historyPageUrl: proof.history_page_url, historyPageSha256: proof.history_page_sha256,
  sourcePageUrl: proof.pricing_page_url, sourcePageSha256: proof.pricing_page_sha256,
  observedFinding: 'compliant-observed', next_action: proof.next_action,
};
const entry = { ccn: '470003', base, action: 'replace', evidence,
  evidence_run: 'uvm-medical-center-fletcher-allen-alias-2026-09-17', reviewed_at: proof.observed_at,
  note: 'UVM Health first-party history explicitly identifies Fletcher Allen Health Care as today’s University of Vermont Medical Center. Its current location page, shared root pointer and pricing page identify the exact file, whose retained prefix names University of Vermont Medical Center Inc at 111 Colchester Avenue, Burlington VT 05401. The file separately names a rehabilitation location at 790 College Parkway. This is observed identity/pointer/header evidence, not full-file validation or a legal compliance determination; the earlier domain-unknown result remains historical.' };
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const existing = ledger.find(row => row.ccn === entry.ccn);
if (existing && (existing.evidence_run !== entry.evidence_run || JSON.stringify(existing.evidence) !== JSON.stringify(entry.evidence)))
  throw new Error('Existing nonmatching UVM Medical Center resolution');
if (!existing) {
  ledger.push(entry);
  ledger.sort((left, right) => left.ccn.localeCompare(right.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
}
console.log(JSON.stringify({ applied: !existing, ccn: entry.ccn, finding: evidence.observedFinding }));
