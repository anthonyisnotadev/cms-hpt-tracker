const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-parkview-current-shared-file-proof-2026-09-19.json'), 'utf8'));
const ledgerPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const observation = {
  ccn: proof.ccn,
  observed_at: proof.observed_at,
  proof_file: 'reconciliation-parkview-current-shared-file-proof-2026-09-19.json',
  official_site: proof.official_site,
  official_pricing_page: proof.official_pricing_page,
  competing_ccn: proof.competing_ccn,
  page_link_observation: proof.page_link_observation,
  mrf_url: proof.mrf_url,
  mrf_http_status: proof.http_status,
  mrf_content_range: proof.content_range,
  mrf_sample_bytes: proof.sample_bytes,
  mrf_sample_sha256: proof.sample_sha256,
  declared_hospital_name: proof.declared_hospital_name,
  declared_location_name: proof.declared_location_name,
  declared_address_prefix: proof.declared_address_prefix,
  declared_last_updated: proof.declared_last_updated,
  cms_template_version: proof.cms_template_version,
  disposition: proof.disposition,
  next_action: proof.next_action
};
const index = ledger.records.findIndex((row) => row.ccn === proof.ccn);
if (index >= 0) ledger.records[index] = { ...ledger.records[index], latest_shared_file_recheck: observation };
else ledger.records.push(observation);
fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
console.log(JSON.stringify({ applied: true, ccn: proof.ccn, action: index >= 0 ? 'update-latest-shared-file-recheck' : 'append-shared-file-recheck' }, null, 2));
