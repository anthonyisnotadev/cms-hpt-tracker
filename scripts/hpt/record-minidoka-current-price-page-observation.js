'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofName = 'reconciliation-minidoka-current-price-page-proof.json';
const proof = JSON.parse(fs.readFileSync(path.join(audit, proofName), 'utf8'));
const file = path.join(audit, 'reconciliation-manual-access-observations.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const record = {
  ccn: proof.ccn,
  observed_at: proof.observed_at,
  proof_file: proofName,
  official_site: proof.official_site,
  official_pricing_page: proof.pricing_page,
  pricing_page_status: proof.pricing_page_status,
  pricing_page_role: proof.pricing_page_role,
  root_pointer_url: proof.root_pointer_url,
  root_pointer_observation: proof.root_pointer_observation,
  disposition: proof.disposition,
  next_action: proof.next_action
};
const idx = data.records.findIndex(row => row.ccn === proof.ccn);
if (idx >= 0) {
  const prior = data.records[idx];
  data.records[idx] = {
    ...prior,
    latest_current_pricing_route: record,
    latest_recheck_observed_at: proof.observed_at,
    latest_recheck_proof_file: proofName
  };
} else data.records.push(record);
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
