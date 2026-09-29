'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofName = 'reconciliation-holly-hill-browser-access-proof-2026-09-20.json';
const p = JSON.parse(fs.readFileSync(path.join(audit, proofName), 'utf8'));
const fp = path.join(audit, 'reconciliation-manual-access-observations.json');
const doc = JSON.parse(fs.readFileSync(fp, 'utf8'));
const rec = {
  ccn: p.ccn,
  observed_at: p.observed_at,
  proof_file: proofName,
  official_site: `https://${p.official_domain}/`,
  pointer_url: p.pointer_url,
  bounded_observations: [{ url: p.pointer_url, status: p.direct_client_status, result: 'Cloudflare security-verification response; no pointer bytes available' }],
  browser_observation: p.browser_result,
  third_party_lead: p.third_party_lead,
  disposition: p.disposition,
  next_action: p.next_action
};
doc.records = doc.records.filter(row => row.ccn !== p.ccn);
doc.records.push(rec);
doc.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(fp, `${JSON.stringify(doc, null, 2)}\n`);
console.log(JSON.stringify({ updated: p.ccn, disposition: p.disposition }, null, 2));
