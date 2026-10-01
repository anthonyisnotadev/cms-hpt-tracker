'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const read = name => fs.readFileSync(path.join(audit, name));

test('Minidoka third-party current-MRF label links to the previously documented legacy Excel file', () => {
  const proofName = 'reconciliation-minidoka-procedureradar-current-mrf-link-conflict-2026-09-27.json';
  const proof = JSON.parse(read(proofName));
  const manual = JSON.parse(read('reconciliation-manual-access-observations.json'));
  const reconciliation = JSON.parse(read('nationwide-reconciliation.json'));
  const verification = JSON.parse(read('nationwide-verification.json'));
  const worklist = JSON.parse(read('unresolved-investigation-worklist.json'));
  const record = manual.records.find(item => item.ccn === '131319');
  const previousThirdPartyLead = record.latest_third_party_search_lead;
  const row = reconciliation.records.find(item => item.ccn === '131319');
  const queued = worklist.records.find(item => item.ccn === '131319');

  assert.equal(proof.ccn, '131319');
  assert.equal(proof.third_party_claims.current_listing_label, 'Minidoka Memorial Hospital MRF (September 1, 2026)');
  assert.equal(proof.linked_file_observation.url, previousThirdPartyLead.file_url);
  assert.equal(proof.linked_file_observation.prior_exact_url_observation.sha256,
    previousThirdPartyLead.file_sha256);
  assert.equal(proof.linked_file_observation.prior_exact_url_observation.bytes, 507392);
  assert.equal(proof.independent_current_hospital_evidence.last_observed_target_status, 404);
  assert.equal(proof.independent_current_hospital_evidence.status_not_rechecked, true);
  assert.equal(proof.assessment.mrf_recovered, false);
  assert.equal(proof.assessment.prices_imported, false);
  assert.equal(proof.assessment.disposition_effect.startsWith('none;'), true);
  assert.equal(proof.latest_live_browser_recheck_2026_09_29.observed_at, '2026-09-29T14:39:26Z');
  assert.match(proof.latest_live_browser_recheck_2026_09_29.browser_file_link_observation ||
    proof.latest_live_browser_recheck_2026_09_29.raw_file_link_observation, /2020\/12\/Chargemaster-\.xls/);
  assert.match(proof.latest_live_browser_recheck_2026_09_29.source_claim_vs_target, /not supported by a new raw-file URL/);
  assert.equal(record.latest_procedureradar_live_browser_recheck_2026_09_29.observed_at,
    proof.latest_live_browser_recheck_2026_09_29.observed_at);
  assert.equal(record.latest_third_party_procedureradar_mrf_link_conflict_2026_09_27.proof_file, proofName);
  assert.equal(record.latest_third_party_procedureradar_mrf_link_conflict_2026_09_27.observed_at, '2026-09-27T23:53:20Z');
  assert.equal(row.workstream, 'genuinely-unresolved-investigation');
  assert.equal(queued.current_disposition, 'mrf-request-unsuccessful');
  assert.equal(queued.latest_review_at, proof.latest_live_browser_recheck_2026_09_29.observed_at);
  assert.match(queued.next_action, /Do not repeat this unchanged third-party link/);
  assert.match(queued.next_action, /restored pointer-declared CMS file or publisher-provided exact copy/);
  assert.equal(worklist.source_sha256[proofName], crypto.createHash('sha256').update(read(proofName)).digest('hex'));
  assert.equal(verification.records.find(item => item.ccn === '131319').ccn, '131319');
});
