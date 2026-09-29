'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofName = 'reconciliation-lifebrite-early-domain-scope-proof-2026-09-20.json';
const p = JSON.parse(fs.readFileSync(path.join(audit, proofName), 'utf8'));
const fp = path.join(audit, 'reconciliation-manual-access-observations.json');
const doc = JSON.parse(fs.readFileSync(fp, 'utf8'));
const rec = {
  ccn: p.ccn,
  observed_at: p.observed_at,
  proof_file: proofName,
  official_site: p.official_domain,
  browser_final_url: p.browser_final_url,
  browser_observation: p.browser_observation,
  bounded_observations: p.bounded_observations,
  disposition: p.disposition,
  next_action: p.next_action
};
doc.records = doc.records.filter(row => row.ccn !== p.ccn);
doc.records.push(rec);
doc.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(fp, `${JSON.stringify(doc, null, 2)}\n`);
console.log(JSON.stringify({ updated: p.ccn, disposition: p.disposition }, null, 2));
