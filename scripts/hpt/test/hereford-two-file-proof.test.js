'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const read = name => JSON.parse(fs.readFileSync(path.join(audit, name), 'utf8'));

test('Hereford keeps nonstandard pointer field and distinct page files separate', () => {
  const proof = read('reconciliation-hereford-two-file-proof.json');
  const currentRecheck = read('reconciliation-hereford-live-pointer-page-recheck-2026-09-29.json');
  const pointer = fs.readFileSync(path.join(root, 'cms_data/hpt/pointer-corpus/raw/dschd.org-5c4e2db86eed.txt'));
  const verification = read('nationwide-verification.json').records.find(row => row.ccn === proof.ccn);
  const reconciliation = read('nationwide-reconciliation.json').records.find(row => row.ccn === proof.ccn);
  const queued = read('unresolved-investigation-worklist.json').records.find(row => row.ccn === proof.ccn);
  assert.equal(crypto.createHash('sha256').update(pointer).digest('hex'), proof.pointer_sha256);
  assert.equal(verification.pointer_corpus_sha256, proof.pointer_sha256);
  assert.match(pointer.toString(), /^url: /m);
  assert.doesNotMatch(pointer.toString(), /^mrf-url:/m);
  assert.notEqual(proof.pointer_url_field_file_url, proof.page_patient_pricing_tool_file_url);
  assert.equal(proof.pointer_url_field_file_declared_version, '2.0.0');
  assert.equal(proof.page_patient_pricing_tool_file_declared_version, '3.0.0');
  const texasRow = proof.current_address_crosscheck_2026_09_28
    .additional_primary_state_sources_checked_2026_09_28.texas_hhsc_2025_ffy_sda_verification;
  assert.match(texasRow.excerpt, /CCN 450155, NPI 1568454403/);
  assert.match(texasRow.excerpt, /540 W 15TH ST/);
  assert.match(texasRow.evidence_role, /not a retrieved\/hash-verified PDF/);
  assert.match(proof.scope_decision, /CMS Provider Data Catalog and an older CMS transmittal report 801 East Third/);
  assert.match(proof.scope_decision, /lacks an explicit mrf-url/);
  const historicalCms = proof.current_address_crosscheck_2026_09_28
    .historical_cms_transmittal_address_crosscheck_2026_09_28;
  assert.match(historicalCms.observed_row, /CCN 450155; HEREFORD REGIONAL MEDICAL CENTER; 801 EAST THIRD/);
  assert.match(historicalCms.evidence_role, /does not establish that it is the current physical hospital site/);
  assert.match(historicalCms.current_source_comparison, /current CMS Provider Data Catalog continues to show 801 EAST THIRD/);
  const currentCms = proof.current_address_crosscheck_2026_09_28
    .current_cms_ehr_hospital_paid_list_search_recheck_2026_09_29;
  assert.equal(currentCms.exact_fields.ccn, '450155');
  assert.equal(currentCms.exact_fields.npi, '1568454403');
  assert.equal(currentCms.exact_fields.address, '540 W 15th St');
  assert.match(currentCms.evidence_role, /does not explain the separate CMS Provider Data Catalog/);
  assert.match(proof.scope_decision, /separate official CMS EHR Hospital Paid List associate exact CCN 450155/);
  assert.match(proof.scope_decision, /still lacks an explicit mrf-url/);
  assert.equal(reconciliation.workstream, 'genuinely-unresolved-investigation');
  assert.equal(queued.ccn, '450155');
  assert.equal(queued.next_action, proof.next_action);
  assert.equal(queued.reviewed_follow_up, true);
  assert.equal(currentRecheck.ccn, proof.ccn);
  assert.equal(currentRecheck.official_pricing_page.http_status, 200);
  assert.equal(currentRecheck.official_root_pointer.response_sha256, proof.pointer_sha256);
  assert.equal(currentRecheck.official_root_pointer.contains_explicit_mrf_url_field, false);
  assert.equal(currentRecheck.file_head_checks.bytes_retrieved, false);
  assert.equal(currentRecheck.disposition_changed, false);
  assert.equal(currentRecheck.count_effect, 0);
  const manual = read('reconciliation-manual-access-observations.json').records.find(row => row.ccn === proof.ccn);
  assert.equal(manual.latest_live_pointer_page_recheck_2026_09_29.proof_file,
    'reconciliation-hereford-live-pointer-page-recheck-2026-09-29.json');
  assert.equal(manual.latest_live_pointer_page_recheck_2026_09_29.observed_at, currentRecheck.observed_at);
  assert.equal(queued.latest_review_at, currentRecheck.observed_at);
});
