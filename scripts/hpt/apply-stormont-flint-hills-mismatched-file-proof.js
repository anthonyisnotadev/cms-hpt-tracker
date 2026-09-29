'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = require(path.join(audit, 'reconciliation-stormont-flint-hills-mismatched-file-proof.json'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
  .find(row => row.ccn === proof.ccn);
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const pointer = fs.readFileSync(path.join(root, proof.pointer_retained_raw));
const sample = fs.readFileSync(path.join(root, proof.retained_sample));
const rows = csvToObjects(sample.toString('utf8', 0, 1500));
if (proof.ccn !== '170074' || !base || base.finding !== 'not-assessed-domain-unknown'
    || proof.roster_address !== '1102 ST MARY\'S ROAD' || proof.roster_city !== 'JUNCTION CITY'
    || proof.roster_state !== 'KS' || proof.roster_zip !== '66441'
    || proof.first_party_facility_address !== '1102 St. Marys Road, Junction City, KS 66441'
    || proof.price_page_file_label !== 'Flint Hills Campus Payer File (csv)'
    || proof.pointer_file_url !== proof.page_file_url
    || sha(pointer) !== proof.pointer_sha256 || sha(sample) !== proof.file_sample_sha256
    || sample.length !== 262144 || proof.file_http_status !== 206
    || !/location-name:Stormont Vail Flint Hills LLC\r?\nsource-page-url:https:\/\/www\.stormontvail\.org\/patient-resources\/cost-of-care\/\r?\nmrf-url: https:\/\/www\.stormontvail\.org\/wp-content\/uploads\/883089376_STORMONTVAIL_STANDARDCHARGES\.csv/.test(pointer.toString('utf8'))
    || rows[0]?.hospital_name !== 'Stormont Vail Healthcare, Inc'
    || rows[0]?.location_name !== 'Stormont Vail Healthcare, Inc'
    || rows[0]?.hospital_address !== '1500 SW 10th Ave, Topeka, KS 66604'
    || rows[0]?.last_updated_on !== '12/19/2025'
    || rows[0]?.version !== '3.0.0'
    || rows[0]?.['license_number|KS'] !== 'H-089-003|KS')
  throw new Error('Stormont Flint Hills source or base changed; manual review required');

const evidence = {
  ...proof, identity: 'conflicting-file',
  identity_basis: 'first-party-Flint-Hills-Junction-City-campus-versus-pointer-and-page-labeled-CSV-declaring-Topeka-campus',
  observedFinding: 'pointer-and-page-labeled-flint-hills-file-declares-topeka',
  next_action: proof.next_action,
};
const entry = {
  ccn: proof.ccn, base, action: 'quarantine', official: { domain: 'stormontvail.org' },
  evidence,
  proof: {
    pointer_sha256: proof.pointer_sha256,
    payload_sha256: proof.file_sample_sha256,
    observed_hospital_name: proof.declared_hospital_name,
    observed_address: proof.declared_address,
  },
  evidence_run: 'stormont-flint-hills-topeka-file-mismatch-2026-09-17',
  reviewed_at: proof.observed_at,
  note: 'Stormont Vail identifies Flint Hills at 1102 St. Marys Road, Junction City and labels the linked CSV Flint Hills. Its retained root pointer also labels that CSV Flint Hills. Fresh bounded CSV bytes instead declare Stormont Vail Healthcare, Inc at 1500 SW 10th Ave, Topeka. The file is excluded from CCN 170074; this is a publisher file-identity mismatch observation, not a legal compliance finding or proof that no Flint Hills file exists.',
};
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const old = ledger.find(row => row.ccn === proof.ccn);
if (old && (old.evidence_run !== entry.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(entry.evidence)))
  throw new Error('Existing nonmatching Flint Hills resolution');
if (!old) {
  ledger.push(entry);
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
}
console.log(JSON.stringify({ applied: !old, ccn: proof.ccn, finding: evidence.observedFinding }));
