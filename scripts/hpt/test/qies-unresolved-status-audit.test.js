'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data', 'hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-qies-unresolved-status-audit-2026-09-27.json'), 'utf8'));
const manual = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-manual-access-observations.json'), 'utf8'));
const nationwide = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-verification.json'), 'utf8'));

test('QIES unresolved census records exact transition dates without closing historical HPT work', () => {
  assert.equal(proof.source.release, 'Q1 2026');
  assert.equal(proof.cohort.unresolved_ccn_count, 572);
  assert.equal(proof.cohort.exact_ccn_match_count, 100);
  assert.equal(proof.cohort.no_exact_row_count, 472);
  assert.match(proof.source_response_sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(proof.matched_status_counts, { '00': 97, '07': 2, '01': 1 });
  assert.equal(proof.matched_non_active_rows.length, 3);
  assert.equal(proof.cohort.no_exact_row_ccns.length, 472);

  const row = ccn => proof.selected_transition_crosswalk_rows.find(item => item.ccn === ccn);
  assert.deepEqual(
    [row('010110').termination_code, row('010110').termination_date, row('010779').provider_category_subtype_code, row('010779').original_participation_date],
    ['07', '20240430', '28', '20240501']
  );
  assert.deepEqual(
    [row('010125').termination_code, row('010125').termination_date, row('011311').provider_category_subtype_code, row('011311').original_participation_date],
    ['07', '20251113', '11', '20251114']
  );
  assert.deepEqual([row('050785').termination_code, row('050785').termination_date], ['01', '20250101']);

  for (const ccn of ['010110', '010779', '010125', '011311', '050785']) {
    assert.ok(manual.records.some(record => record.ccn === ccn
      && record.proof_file === 'reconciliation-qies-unresolved-status-audit-2026-09-27.json'));
  }
  for (const ccn of ['010110', '010125']) {
    const current = nationwide.records.find(record => record.ccn === ccn);
    assert.ok(current, `historical CCN ${ccn} remains in the 572-case investigation worklist`);
    assert.match(current.next_action, /historical accountability baseline/);
  }
  assert.ok(nationwide.records.find(record => record.ccn === '050785'), 'DOCS historical CCN remains in the investigation worklist');
  assert.equal(nationwide.records.find(record => record.ccn === '010779').disposition, 'verified-stale-mrf');
  assert.equal(proof.unresolved_count_change, 0);
  assert.match(proof.field_interpretation.limitation, /No exact row is not evidence of closure/);
});
