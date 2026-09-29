'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofName = 'reconciliation-carthage-331324-sibling-file-rejection-proof-2026-09-20.json';
const p = JSON.parse(fs.readFileSync(path.join(audit, proofName), 'utf8'));
const obsPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const obs = JSON.parse(fs.readFileSync(obsPath, 'utf8'));
const observation = {
  ccn: p.ccn,
  observed_at: p.observed_at,
  proof_file: proofName,
  official_pricing_page: p.official_pricing_page,
  pointer_url: p.pointer_url,
  pointer_sha256: p.pointer_sha256,
  pointer_mrf_url: p.mrf_url,
  pointer_mrf_http_status: p.mrf_http_status,
  mrf_bytes: p.mrf_bytes,
  mrf_sha256: p.mrf_sha256,
  declared_hospital_name: p.declared_hospital_name,
  declared_address: p.declared_address,
  declared_license_state: p.declared_license_state,
  declared_npi: p.declared_npi,
  declared_last_updated: p.declared_last_updated,
  cms_template_version: p.cms_template_version,
  disposition: p.disposition,
  next_action: p.next_action
};
obs.records = obs.records.filter(row => row.ccn !== p.ccn);
obs.records.push(observation);
obs.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(obsPath, `${JSON.stringify(obs, null, 2)}\n`);
const hdrPath = path.join(audit, 'reconciliation-reviewed-header-dispositions.json');
const hdr = JSON.parse(fs.readFileSync(hdrPath, 'utf8'));
hdr.records = hdr.records.filter(row => row.ccn !== p.ccn);
hdr.records.push({
  ccn: p.ccn,
  disposition: p.disposition,
  candidate: `${p.declared_hospital_name}, ${p.declared_address}`,
  related_ccn: p.related_ccn,
  roster_address: p.roster_address,
  official_url: p.official_pricing_page,
  pointer_url: p.pointer_url,
  observation: 'The complete current pointer-linked file identifies the Carthage, NY campus at 1001 West Street, which matches related CCN 331318, not unresolved CCN 331324 whose roster address is 214 Kings Street, Ogdensburg, NY. The shared hospital name is insufficient for assignment.',
  next_action: p.next_action
});
hdr.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(hdrPath, `${JSON.stringify(hdr, null, 2)}\n`);
console.log(JSON.stringify({ updated: p.ccn, disposition: p.disposition }, null, 2));
