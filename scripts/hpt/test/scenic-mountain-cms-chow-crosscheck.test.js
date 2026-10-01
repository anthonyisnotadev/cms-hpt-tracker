'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { selectRelevant } = require('../capture-scenic-mountain-cms-chow-recheck');

const root = path.resolve(__dirname, '../../..');

test('CMS CHOW cross-check binds exact CCN 450653 and does not infer Shannon NPI continuity', () => {
  const proof = JSON.parse(fs.readFileSync(path.join(root,
    'data/hpt-audit/reconciliation-scenic-mountain-cms-chow-crosscheck-2026-09-29.json'), 'utf8'));
  const records = JSON.parse(fs.readFileSync(path.join(root,
    'data/hpt-audit/reconciliation-manual-access-observations.json'), 'utf8')).records;
  const observation = records.find(row => row.ccn === '450653');
  assert.ok(observation);
  assert.equal(proof.source.response_sha256, '76f2a3fdfa7f69b78363e59189e0ec4f10e602c8c8b95b8e0d44bf7c496ae33f');
  assert.equal(proof.query.response_rows, 772);
  assert.equal(proof.query.exact_ccn_or_npi_match_rows, 1);
  assert.equal(proof.relevant_transaction_rows[0]['CCN - BUYER'], '450653');
  assert.equal(proof.relevant_transaction_rows[0]['CCN - SELLER'], '450653');
  assert.equal(proof.relevant_transaction_rows[0]['EFFECTIVE DATE'], '2024-10-17');
  assert.equal(proof.comparison.shannon_npi_match_in_this_chow_response, false);
  assert.match(proof.comparison.scope_interpretation, /does not establish that no operational transition/i);
  assert.equal(proof.cohort_count_effect, 0);
  assert.equal(observation.latest_cms_chow_recheck.proof_file,
    'reconciliation-scenic-mountain-cms-chow-crosscheck-2026-09-29.json');
  assert.equal(observation.latest_cms_chow_recheck.matching_rows, 1);
  assert.equal(observation.disposition, 'current-operator-same-campus-pointer-file-ccn-continuity-unresolved');
});

test('CMS CHOW selector returns only rows naming the target CCN or candidate Shannon NPI', () => {
  const { selectRelevant } = require('../capture-scenic-mountain-cms-chow-recheck');
  const rows = [
    { 'CCN - BUYER': '450653', 'CCN - SELLER': '450653', 'NPI - BUYER': '1336976034' },
    { 'CCN - BUYER': '000001', 'CCN - SELLER': '000002', 'NPI - BUYER': '1497606438' },
    { 'CCN - BUYER': '000001', 'CCN - SELLER': '000002', 'NPI - BUYER': '9999999999' }
  ];
  assert.deepEqual(selectRelevant(rows), rows.slice(0, 2));
});
