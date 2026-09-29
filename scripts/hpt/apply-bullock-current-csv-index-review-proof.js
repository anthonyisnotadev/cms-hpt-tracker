'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofFile = 'reconciliation-bullock-current-csv-index-review-proof-2026-09-27.json';
const proof = JSON.parse(fs.readFileSync(path.join(audit, proofFile), 'utf8'));
const ledgerPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
ledger.records = ledger.records.filter(record => record.proof_file !== proofFile);
ledger.records.push({
  ccn: proof.ccn,
  observed_at: proof.observed_at,
  proof_file: proofFile,
  official_pricing_page: proof.official_page_url,
  official_pricing_page_status: proof.official_page_status,
  official_pricing_page_sha256: proof.official_page_sha256,
  disposition: 'historical-acute-ccn-current-csv-label-unlinked-no-historical-file-recovered',
  current_csv_label: '631070858_Bullock_Hospital_StandardCharges.CSV',
  current_csv_label_is_link: false,
  count_effect: 0,
  interpretation: proof.interpretation,
  next_action: proof.next_action
});
ledger.records.sort((a, b) => a.ccn.localeCompare(b.ccn)
  || a.observed_at.localeCompare(b.observed_at));
fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
console.log(JSON.stringify({ recorded: proof.ccn, proof_file: proofFile, count_effect: proof.count_effect }, null, 2));
