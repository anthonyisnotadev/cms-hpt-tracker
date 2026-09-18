'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-uvm-shared-pointer-attribution-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).find(row => row.ccn === '331321');
const a = proof.alice;
const c = proof.champlain;
const sample = fs.readFileSync(path.join(root, a.retained_sample));
if (!base || base.finding !== 'not-assessed-domain-unknown'
    || proof.pointer_url !== 'https://www.uvmhealth.org/cms-hpt.txt'
    || proof.pointer_sha256 !== 'b9584a0bdb9b08b1a972d0c701d507c76f3bafa1591a59f1ab5e56998402e014'
    || proof.pointer_entry_count !== 6 || proof.pricing_page_links_alice_file !== true
    || !/^[a-f0-9]{64}$/.test(proof.identity_page_sha256)
    || !/^[a-f0-9]{64}$/.test(proof.pricing_page_sha256)
    || a.ccn !== '331321' || a.roster_address !== '133 PARK STREET, PO BOX 729'
    || a.mrf_url !== 'https://www.uvmhealth.org/sites/default/files/150346515_alice-hyde-medical-center_standardcharges.csv'
    || a.file_http_status !== 206 || a.file_sample_bytes !== 262144 || a.file_total_bytes !== 53533454
    || sample.length !== 262144 || crypto.createHash('sha256').update(sample).digest('hex') !== a.file_sample_sha256
    || a.declared_hospital_name !== 'Alice Hyde Medical Center'
    || a.declared_addresses !== '133 Park Street, Malone, NY 12953|133 Park Street, Malone, NY 12953'
    || a.declared_license_state !== 'NY' || a.declared_date !== '2026-04-28' || a.version !== '3.0.0'
    || c.ccn !== '330250' || c.roster_address !== '75 BEEKMAN STREET'
    || !c.declared_addresses.includes('75 Beekman Street, Plattsburgh, NY 12901')
    || !Number.isFinite(Date.parse(proof.observed_at)))
  throw new Error('UVM Alice Hyde proof or base changed; manual review required');

const evidence = {
  identity: 'corroborated',
  identity_basis: 'first-party-alice-hyde-campus-page-current-root-pointer-pricing-link-and-distinct-alice-file-header-address',
  pointerUrl: proof.pointer_url, pointerSha256: proof.pointer_sha256,
  url: a.mrf_url, fileSha256: a.file_sample_sha256,
  bytesRetained: a.file_sample_bytes, fileTotalBytes: a.file_total_bytes,
  http_status: a.file_http_status, checked_at: proof.observed_at,
  date: a.declared_date, version: a.version, officialDomain: 'uvmhealth.org',
  location_name: a.pointer_location_name, declared_hospital_name: a.declared_hospital_name,
  declared_location_name: a.declared_location_names, declared_address: a.declared_addresses,
  declared_license_state: a.declared_license_state, file_kind: 'csv',
  identityPageUrl: proof.identity_page_url, identityPageSha256: proof.identity_page_sha256,
  sourcePageUrl: proof.pricing_page_url, sourcePageSha256: proof.pricing_page_sha256,
  observedFinding: 'compliant-observed', next_action: proof.next_action,
};
const entry = { ccn: '331321', base, action: 'replace', evidence,
  evidence_run: 'uvm-alice-hyde-shared-pointer-attribution-2026-09-17', reviewed_at: proof.observed_at,
  note: 'Current UVM root pointer and first-party pricing page identify an Alice Hyde CSV distinct from Champlain Valley. The bounded Alice file header names Alice Hyde Medical Center at 133 Park Street, Malone NY, matching the roster campus. The distinct Champlain file names 75 Beekman Street, Plattsburgh NY. This is observed pointer/page/file/header identity evidence, not full-file validation or a legal compliance determination; the prior domain-unknown result remains historical.' };
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const existing = ledger.find(row => row.ccn === entry.ccn);
if (existing && (existing.evidence_run !== entry.evidence_run || JSON.stringify(existing.evidence) !== JSON.stringify(entry.evidence)))
  throw new Error('Existing nonmatching UVM Alice Hyde resolution');
if (!existing) {
  ledger.push(entry);
  ledger.sort((left, right) => left.ccn.localeCompare(right.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
}
console.log(JSON.stringify({ applied: !existing, ccn: entry.ccn, finding: evidence.observedFinding }));
