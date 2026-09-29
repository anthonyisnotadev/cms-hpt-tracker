'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-lake-butler-page-file-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).find(row => row.ccn === proof.ccn);
const sample = fs.readFileSync(path.join(root, proof.retained_sample));
if (!base || sample.length !== proof.retained_bytes || crypto.createHash('sha256').update(sample).digest('hex') !== proof.retained_sample_sha256) throw new Error('Incomplete Lake Butler proof');
const evidence = {
  identity: 'corroborated',
  identity_basis: 'first-party-page-linked-complete-file-header-exact-campus-address-state-date-version',
  officialDomain: proof.official_domain,
  pointerUrl: proof.root_pointer_url,
  pointerHttpStatus: proof.root_pointer_status,
  pointerSha256: proof.root_pointer_sha256,
  pointerResponseContentType: proof.root_pointer_content_type,
  pointerResponseBytes: proof.root_pointer_response_bytes,
  pointerIssue: 'root-pointer-http-error',
  url: proof.mrf_url,
  fileSha256: proof.mrf_sha256,
  fileBytes: proof.mrf_bytes,
  fullFileBytes: proof.mrf_bytes,
  http_status: proof.mrf_http_status,
  checked_at: proof.observed_at,
  date: proof.declared_date,
  version: proof.cms_template_version,
  location_name: proof.declared_location_name,
  declared_hospital_name: proof.declared_hospital_name,
  declared_address: proof.declared_address,
  declared_license_state: proof.declared_state,
  file_kind: 'csv',
  sourcePageUrl: proof.official_source_page_url,
  browserSourceObservedAt: proof.observed_at,
  observedFinding: 'official-page-mrf-root-pointer-unavailable',
  next_action: proof.next_action
};
const entry = { ccn: proof.ccn, base, action: 'replace-observation', evidence, evidence_run: 'lake-butler-page-file-root-pointer-2026-09-19', reviewed_at: proof.observed_at, note: 'The browser-rendered first-party Lake Butler Hospital financial-resources page links a complete 5,515,889-byte CSV. Its CMS 3.0.0 header identifies the Lake Butler campus at 850 E Main St, Lake Butler, Florida, dated 2026-04-02. The root pointer returned a captcha challenge, so this is current page-linked evidence rather than pointer-linked or a compliance conclusion.' };
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const index = ledger.findIndex(row => row.ccn === proof.ccn);
const old = index >= 0 ? ledger[index] : null;
if (old && old.evidence_run !== entry.evidence_run) throw new Error('Existing nonmatching Lake Butler resolution');
if (index >= 0) ledger[index] = entry;
else ledger.push(entry);
ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
console.log(JSON.stringify({ applied: proof.ccn, replaced: Boolean(old) }));
