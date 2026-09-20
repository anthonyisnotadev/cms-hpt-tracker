const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-mymichigan-clare-browser-pointer-recheck-2026-09-19.json'), 'utf8'));
const ledgerPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const observation = {
  ccn: proof.ccn,
  observed_at: proof.browser_observed_at,
  proof_file: 'reconciliation-mymichigan-clare-browser-pointer-recheck-2026-09-19.json',
  official_site: proof.official_site,
  pointer_url: proof.pointer_url,
  pointer_browser_status: proof.browser_status,
  pointer_browser_title: proof.browser_title,
  detail: proof.browser_detail,
  disposition: proof.disposition,
  next_action: proof.next_action
};
const index = ledger.records.findIndex((row) => row.ccn === proof.ccn);
if (index >= 0) ledger.records[index] = { ...ledger.records[index], latest_browser_pointer_recheck: observation };
else ledger.records.push(observation);
fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
console.log(JSON.stringify({ applied: true, ccn: proof.ccn, action: index >= 0 ? 'update-latest-browser-pointer-recheck' : 'append-browser-pointer-recheck' }, null, 2));
