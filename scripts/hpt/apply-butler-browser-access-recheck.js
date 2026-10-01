'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const audit = path.join(root, 'data/hpt-audit');
const proofName = 'reconciliation-butler-current-page-proof.json';
const proof = JSON.parse(fs.readFileSync(path.join(audit, proofName), 'utf8'));
const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
const index = manual.records.findIndex(record => record.ccn === proof.ccn);
if (index < 0) throw new Error(`Missing manual observation for ${proof.ccn}`);
const check = proof.browser_access_recheck_2026_09_29;
if (!check || check.csv_bytes_received !== false || check.disposition_changed !== false)
  throw new Error('Incomplete browser-access recheck proof');

manual.records[index] = {
  ...manual.records[index],
  latest_browser_file_access_recheck_2026_09_29: {
    proof_file: proofName,
    observed_at: check.observed_at,
    browser_surface: check.browser_surface,
    official_pricing_page: proof.official_pricing_page,
    official_page_link_url: check.official_page_link_url,
    browser_result: check.browser_result,
    csv_bytes_received: check.csv_bytes_received,
    interpretation: check.interpretation,
    disposition_changed: false
  },
  observed_at: check.observed_at,
  latest_recheck_action_observed_at: check.observed_at,
  next_action: check.next_action
};
fs.writeFileSync(manualPath, `${JSON.stringify(manual, null, 2)}\n`);
console.log(JSON.stringify({ applied: proof.ccn, observed_at: check.observed_at, csv_bytes_received: false,
  disposition_changed: false, next_action: check.next_action }, null, 2));
