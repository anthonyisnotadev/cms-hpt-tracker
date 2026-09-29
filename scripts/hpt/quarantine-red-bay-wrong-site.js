'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = require(path.join(audit, 'reconciliation-red-bay-wrong-site-proof.json'));
const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
  .find(row => row['Facility ID'] === proof.ccn);
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
  .find(row => row.ccn === proof.ccn);
const pointer = fs.readFileSync(path.join(root, proof.previous_pointer_artifact));
const sha = crypto.createHash('sha256').update(pointer).digest('hex');
if (proof.ccn !== '011302' || !roster || roster['Facility Name'] !== proof.roster_name
    || roster.Address !== proof.roster_address || roster['City/Town'] !== proof.roster_city
    || roster.State !== proof.roster_state || roster['ZIP Code'] !== proof.roster_zip
    || !base || base.finding !== 'not-assessed-not-named-in-file'
    || base.domain !== proof.previous_assigned_domain || base.pointer_url !== proof.previous_pointer_url
    || sha !== proof.previous_pointer_sha256 || proof.previous_pointer_names_red_bay !== false
    || /Red Bay|211 Hospital Road|Alabama/i.test(pointer.toString('utf8'))
    || proof.first_party_system_domain !== 'hh.health'
    || proof.first_party_page_file_url !== 'https://hh.health/wp-content/uploads/472323163_red-bay-hospital_standardcharges.csv')
  throw new Error('Red Bay wrong-site proof or base changed; manual review required');

const entry = {
  ccn: proof.ccn, base, action: 'quarantine', official: { domain: proof.first_party_system_domain },
  evidence: {
    ...proof, identity: 'corroborated',
    identity_basis: 'first-party-system-Red-Bay-page-and-price-page-link-versus-unrelated-Kaiser-pointer',
    observedFinding: 'corrected-site-pointer-pending',
    next_action: proof.next_action,
  },
  evidence_run: 'red-bay-wrong-kaiser-site-2026-09-17', reviewed_at: proof.observed_at,
  note: 'Huntsville Hospital Health System first-party pages identify Red Bay Hospital and link a Red Bay-specific CSV. The assigned Kaiser pointer has no Red Bay or Alabama entry and is excluded from this CCN. Current HH Health root-pointer and file bytes were not retrieved because this direct client and in-app browser could not resolve the host. The page file remains a lead, not a working pointer-linked MRF or compliance finding.',
};
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const old = ledger.find(row => row.ccn === proof.ccn);
if (old && (old.evidence_run !== entry.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(entry.evidence)))
  throw new Error('Existing nonmatching Red Bay resolution');
if (!old) {
  ledger.push(entry);
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
}
console.log(JSON.stringify({ applied: !old, ccn: proof.ccn, domain: proof.first_party_system_domain }));
