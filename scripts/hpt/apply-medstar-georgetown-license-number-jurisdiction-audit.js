'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofFile = 'reconciliation-medstar-georgetown-license-number-jurisdiction-audit-2026-09-27.json';
const proof = JSON.parse(fs.readFileSync(path.join(audit, proofFile), 'utf8'));

const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
const manualRecord = manual.records.find((record) => record.ccn === proof.ccn);
if (!manualRecord) throw new Error(`Missing manual observation for ${proof.ccn}`);
manualRecord.license_number_jurisdiction_audit = {
  observed_at: proof.observed_at,
  proof_file: proofFile,
  finding: proof.finding,
  disposition: proof.disposition,
  count_effect: proof.count_effect,
  next_action: proof.next_action
};
fs.writeFileSync(manualPath, `${JSON.stringify(manual, null, 2)}\n`);

const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const entry = ledger.find((record) => record.ccn === proof.ccn);
if (!entry) throw new Error(`Missing reviewed resolution for ${proof.ccn}`);
entry.license_number_jurisdiction_audit = {
  observed_at: proof.observed_at,
  proof_file: proofFile,
  finding: proof.finding,
  disposition: proof.disposition,
  count_effect: proof.count_effect,
  next_action: proof.next_action
};
fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);

console.log(JSON.stringify({
  ccn: proof.ccn,
  disposition: proof.disposition,
  count_effect: proof.count_effect,
  preserved_existing_findings: [manualRecord.disposition, entry.finding]
}, null, 2));
