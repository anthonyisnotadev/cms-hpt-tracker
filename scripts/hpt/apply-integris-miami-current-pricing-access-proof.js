'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofName = 'reconciliation-integris-miami-current-pricing-access-proof-2026-09-20.json';
const p = JSON.parse(fs.readFileSync(path.join(audit, proofName), 'utf8'));
const fp = path.join(audit, 'reconciliation-manual-access-observations.json');
const doc = JSON.parse(fs.readFileSync(fp, 'utf8'));
const hostname = new URL(p.official_domain_lead).hostname;
const rec = {
  ccn: p.ccn,
  observed_at: p.observed_at,
  proof_file: proofName,
  official_site: hostname,
  publisher_domain_lead: hostname,
  official_identity_url: p.official_identity_url,
  official_identity_observation: p.official_identity_observation,
  cms_hospital_general_dataset: p.cms_hospital_general_dataset,
  cms_api_url: p.cms_api_url,
  cms_api_status: p.cms_api_status,
  cms_api_response_sha256: p.cms_api_response_sha256,
  cms_record: p.cms_record,
  pointer_url: p.official_pointer_url,
  pricing_page_url: p.pricing_page_url,
  bounded_observations: [{ url: p.official_pointer_url, status: p.direct_client_status, result: `HTTP 403; ${p.direct_client_bytes} challenge bytes; no pointer bytes` }, { url: p.pricing_page_url, status: 200, result: 'Browser rendered system pricing page; external hospitalpricedisclosure route redirected to an error page' }],
  browser_observation: p.browser_result,
  disposition: p.disposition,
  next_action: p.next_action
};
doc.records = doc.records.filter(row => row.ccn !== p.ccn);
doc.records.push(rec);
doc.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(fp, `${JSON.stringify(doc, null, 2)}\n`);
console.log(JSON.stringify({ updated: p.ccn, disposition: p.disposition }, null, 2));
