'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-childrens-national-current-page-file-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).find(row => row.ccn === proof.ccn);
const sample = fs.readFileSync(path.join(root, proof.retained_sample));
if (!base || sample.length !== proof.page_file_sample_bytes || crypto.createHash('sha256').update(sample).digest('hex').toUpperCase() !== proof.page_file_sample_sha256) throw new Error('Incomplete Children\'s National proof');
const evidence = {
  identity: 'corroborated',
  identity_basis: 'first-party-page-linked-complete-file-header-exact-campus-address-state-date-version',
  officialDomain: 'childrensnational.org',
  pointerUrl: proof.pointer_url,
  pointerHttpStatus: proof.pointer_direct_status,
  pointerSha256: proof.pointer_response_sha256,
  pointerIssue: 'root-pointer-http-error',
  pointerResponseContentType: proof.pointer_response_content_type,
  pointerResponseBytes: proof.pointer_response_bytes,
  url: proof.page_file_url,
  fileSha256: proof.page_file_full_sha256.toLowerCase(),
  fileBytes: proof.page_file_content_length,
  fullFileBytes: proof.page_file_content_length,
  http_status: proof.page_file_head_status,
  checked_at: proof.observed_at,
  date: proof.declared_date,
  version: proof.declared_version,
  location_name: proof.declared_hospital_name,
  declared_hospital_name: proof.declared_hospital_name,
  declared_address: proof.declared_address,
  declared_license_state: 'DC',
  file_kind: 'csv',
  sourcePageUrl: proof.official_pricing_page,
  browserSourceObservedAt: proof.observed_at,
  observedFinding: 'official-page-mrf-root-pointer-unavailable',
  next_action: proof.next_action
};
const entry = { ccn: proof.ccn, base, action: 'replace-observation', evidence, evidence_run: 'childrens-national-page-file-root-pointer-2026-09-19', reviewed_at: proof.observed_at, note: 'The official Children\'s National pricing page links a complete 239,617,936-byte CSV whose CMS 3.0.0 header identifies Children\'s National Hospital at 111 Michigan Avenue NW, Washington, DC, dated 2026-04-02. The root pointer returned a captured HTTP 502 response, so this is current page-linked evidence rather than pointer-linked or a compliance conclusion.' };
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const index = ledger.findIndex(row => row.ccn === proof.ccn);
const old = index >= 0 ? ledger[index] : null;
if (old && old.evidence_run !== entry.evidence_run) throw new Error('Existing nonmatching Children\'s National resolution');
if (index >= 0) ledger[index] = entry; else ledger.push(entry);
ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
console.log(JSON.stringify({ applied: proof.ccn, replaced: Boolean(old) }));
