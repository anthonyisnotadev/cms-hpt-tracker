'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofName = 'reconciliation-greenwood-current-route-recheck-2026-09-20.json';
const p = JSON.parse(fs.readFileSync(path.join(audit, proofName), 'utf8'));
const fp = path.join(audit, 'reconciliation-manual-access-observations.json');
const doc = JSON.parse(fs.readFileSync(fp, 'utf8'));
const previous = doc.records.find(row => row.ccn === p.ccn) || {};
const rec = {
  ...previous,
  ccn: p.ccn,
  observed_at: p.observed_at,
  proof_file: proofName,
  official_identity_url: p.official_identity_url,
  official_identity_sha256: p.official_identity_sha256,
  official_transition_source_url: p.official_transition_source_url,
  official_transition_source_status: p.official_transition_source_status,
  official_transition_source_sha256: p.official_transition_source_sha256,
  official_transition_statement: p.official_transition_statement,
  official_pricing_page: p.current_pricing_url,
  current_pricing_status: p.current_pricing_status,
  current_pricing_sha256: p.current_pricing_sha256,
  current_pricing_listed_facilities: p.current_pricing_listed_facilities,
  current_pricing_greenwood_file_present: p.current_pricing_greenwood_file_present,
  pointer_url: p.current_pointer_url,
  current_pointer_status: p.current_pointer_status,
  current_pointer_sha256: p.current_pointer_sha256,
  current_pointer_lists_greenwood: p.current_pointer_lists_greenwood,
  browser_observation: p.browser_result,
  cms_hospital_general_dataset: p.cms_hospital_general_dataset,
  cms_api_url: p.cms_api_url,
  cms_api_status: p.cms_api_status,
  cms_api_response_sha256: p.cms_api_response_sha256,
  cms_record: p.cms_record,
  former_vendor_files: p.former_vendor_files,
  disposition: p.disposition,
  next_action: p.next_action
};
doc.records = doc.records.filter(row => row.ccn !== p.ccn);
doc.records.push(rec);
doc.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(fp, `${JSON.stringify(doc, null, 2)}\n`);
console.log(JSON.stringify({ updated: p.ccn, disposition: p.disposition }, null, 2));
