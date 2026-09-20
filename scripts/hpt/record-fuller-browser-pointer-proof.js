'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-fuller-browser-pointer-proof.json'), 'utf8'));
const file = path.join(audit, 'reconciliation-manual-access-observations.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const record = {
  ccn: proof.ccn,
  observed_at: proof.observed_at,
  proof_file: 'reconciliation-fuller-browser-pointer-proof.json',
  official_site: `https://${proof.official_domain}/`,
  pointer_url: proof.pointer_url,
  pointer_http_status: proof.direct_http_status,
  browser_pointer_status: proof.browser_status,
  disposition: proof.disposition,
  next_action: proof.next_action
};
const idx = data.records.findIndex(row => row.ccn === proof.ccn);
if (idx >= 0) data.records[idx] = record;
else data.records.push(record);
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
