'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofName = 'reconciliation-greenwood-ummc-current-root-pointer-crosscheck-2026-09-29.json';
const proof = JSON.parse(fs.readFileSync(path.join(audit, proofName), 'utf8'));
const oldManual = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-manual-access-observations.json'), 'utf8'));
if (oldManual.records.some(row => row.ccn === proof.ccn && row.proof_file === proofName))
  throw new Error('Greenwood UMMC current-pointer review is already applied');
oldManual.records.push({
  ccn: proof.ccn,
  observed_at: proof.observed_at,
  proof_file: proofName,
  official_transition_page: proof.official_transition_page,
  official_pricing_page: proof.official_pricing_page.url,
  latest_ummc_root_pointer_recheck: {
    url: proof.official_root_pointer.url,
    status: proof.official_root_pointer.status,
    content_type: proof.official_root_pointer.content_type,
    bytes: proof.official_root_pointer.bytes,
    sha256: proof.official_root_pointer.sha256,
    last_modified: proof.official_root_pointer.last_modified,
    parsed_locations: proof.official_root_pointer.parsed_locations,
    parsed_mrf_urls: proof.official_root_pointer.parsed_mrf_urls,
    greenwood_entry_present: false,
    raw_contacts_retained: false,
  },
  pricing_page_facility_scope: proof.official_pricing_page.browser_observation,
  disposition: proof.disposition,
  count_effect: proof.count_effect,
  interpretation: proof.interpretation,
  next_action: proof.next_action,
});
oldManual.records.sort((a, b) => a.ccn.localeCompare(b.ccn)
  || String(a.observed_at || '').localeCompare(String(b.observed_at || '')));
fs.writeFileSync(path.join(audit, 'reconciliation-manual-access-observations.json'), `${JSON.stringify(oldManual, null, 2)}\n`);

const browserPath = path.join(audit, 'nationwide-browser-reviews.json');
const browser = JSON.parse(fs.readFileSync(browserPath, 'utf8'));
browser.records.push({
  kind: 'official-root-pointer-current-full-retrieval',
  ccn: proof.ccn,
  target: proof.official_root_pointer.url,
  final_url: proof.official_root_pointer.url,
  status: 'content-bearing-current-pointer-retrieved-greenwood-entry-omitted',
  title: 'UMMC current root pointer and Greenwood pricing scope',
  detail: 'Direct HTTP retrieval of the current UMMC root pointer returned 200 text/plain; 1,275 bytes; full response SHA-256 bound. A sanitized parse found exactly four current locations and MRF URLs (Jackson, Grenada, Holmes County and Madison) and no Greenwood entry. The rendered current UMMC pricing page likewise lists those four hospitals and no Greenwood file. No MRF is assigned to Greenwood; the pointer response includes contact fields that were deliberately omitted from retained evidence.',
  browser: 'Codex in-app browser plus bounded direct HTTP retrieval',
  http_status: 200,
  bytes_read: proof.official_root_pointer.bytes,
  identity: 'exact-ummc-source-pointer-and-page-scope-checked-no-greenwood-mrf-linkage',
  observed_at: proof.observed_at,
  source_page_url: proof.official_pricing_page.url,
  pointer_url: proof.official_root_pointer.url,
  mrf_url: '',
  file_sha256: '',
  proof_file: proofName,
  next_action: proof.next_action,
});
browser.updated_at = proof.observed_at;
fs.writeFileSync(browserPath, `${JSON.stringify(browser, null, 2)}\n`);

console.log(JSON.stringify({
  ccn: proof.ccn,
  evidence_gain: proof.comparison_to_2026_09_26.evidence_gain,
  mrf_recovered: false,
  disposition_changed: false,
  pointer_sha256: proof.official_root_pointer.sha256,
  listed_locations: proof.official_root_pointer.parsed_locations,
}, null, 2));
