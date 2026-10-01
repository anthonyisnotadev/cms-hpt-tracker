'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const proofFile = 'reconciliation-asante-ashland-hrsa-q4-mef-crosscheck-2026-09-29.json';

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(audit, name), 'utf8'));
}

test('HRSA 340B audit and Q4 MEF evidence stays separate from Medicare and HPT status', () => {
  const proof = readJson(proofFile);
  assert.equal(proof.ccn, '380005');
  assert.equal(proof.sources.hrsa_fy26_program_integrity_audit.hrsa_340b_id, 'DSH380005');
  assert.equal(proof.sources.hrsa_fy26_program_integrity_audit.corrective_action_status, 'Pending');
  assert.equal(proof.sources.hrsa_q4_2026_medicaid_exclusion_file.data_rows, 144044);
  assert.equal(proof.sources.hrsa_q4_2026_medicaid_exclusion_file.exact_match_checks['340BID_DSH380005'], 0);
  assert.equal(proof.sources.hrsa_q4_2026_medicaid_exclusion_file.exact_match_checks.NPI_1730628827_token, 0);
  assert.equal(proof.evidence_accounting.new_hospital_mrf_bytes, 0);
  assert.equal(proof.evidence_accounting.hpt_disposition_effect, 'none');
  assert.equal(proof.evidence_accounting.cohort_count_effect, 0);
  assert.match(proof.hrsa_mef_scope.limit, /does not establish no 340B participation, no Medicare enrollment/);

  const manual = readJson('reconciliation-manual-access-observations.json');
  const manualRow = manual.records.find(record => record.ccn === proof.ccn);
  assert.ok(manualRow.latest_hrsa_q4_2026_medicaid_exclusion_crosscheck_2026_09_29);
  assert.equal(manualRow.latest_hrsa_q4_2026_medicaid_exclusion_crosscheck_2026_09_29.disposition_effect, 'none');

  const browser = readJson('nationwide-browser-reviews.json');
  const browserRow = browser.records.find(record => record.proof_file === proofFile);
  assert.ok(browserRow);
  assert.equal(browserRow.ccn, proof.ccn);
  assert.equal(browserRow.mrf_url, '');
  assert.equal(browserRow.file_sha256, '');

  const cohort = readJson('reconciliation-891-baseline-member-roster-2026-09-27.json');
  assert.equal(cohort.summary.category_membership_sum, 891);
  assert.equal(cohort.summary.unique_ccns, 720);
  assert.equal(cohort.summary.current_effective_categories['genuinely-unresolved'], 541);
});
