'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const p = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-prwch-current-page-file-proof-2026-09-21.json'), 'utf8'));
const fp = path.join(audit, 'reconciliation-manual-access-observations.json');
const doc = JSON.parse(fs.readFileSync(fp, 'utf8'));
const rec = {
  ccn: p.ccn,
  observed_at: p.observed_at,
  proof_file: 'reconciliation-prwch-current-page-file-proof-2026-09-21.json',
  official_site: p.official_site,
  official_identity_source: p.official_pricing_page,
  official_facility_name: p.declared_hospital_name,
  official_facility_address: p.declared_address,
  pointer_url: p.pointer_url,
  pointer_status: String(p.pointer_status),
  mrf_url: p.mrf_url,
  mrf_status: String(p.mrf_status),
  mrf_response_bytes: p.mrf_bytes,
  mrf_response_sha256: p.mrf_sha256,
  declared_last_updated: p.declared_last_updated,
  cms_template_version: p.cms_template_version,
  declared_license_state: p.declared_license_state,
  disposition: p.disposition,
  next_action: p.next_action
};
doc.records = doc.records.filter(row => row.ccn !== p.ccn);
doc.records.push(rec);
doc.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(fp, `${JSON.stringify(doc, null, 2)}\n`);
console.log(JSON.stringify({ updated: p.ccn, disposition: p.disposition }, null, 2));
