'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const p = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-prairie-st-johns-pricing-access-proof-2026-09-21.json'), 'utf8'));
const fp = path.join(audit, 'reconciliation-manual-access-observations.json');
const doc = JSON.parse(fs.readFileSync(fp, 'utf8'));
const rec = {
  ccn: p.ccn,
  observed_at: p.observed_at,
  proof_file: 'reconciliation-prairie-st-johns-pricing-access-proof-2026-09-21.json',
  official_site: p.official_site,
  official_identity_source: p.association_source,
  official_pricing_page: p.official_pricing_page,
  pointer_url: p.pointer_url,
  pointer_status: String(p.pointer_http_status),
  pricing_page_status: String(p.pricing_page_http_status),
  browser_observation: p.browser_observation,
  disposition: p.disposition,
  next_action: p.next_action
};
doc.records = doc.records.filter(row => row.ccn !== p.ccn);
doc.records.push(rec);
doc.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(fp, `${JSON.stringify(doc, null, 2)}\n`);
console.log(JSON.stringify({ updated: p.ccn, disposition: p.disposition }, null, 2));
