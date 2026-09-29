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
const docsSuspension = JSON.parse(fs.readFileSync(path.join(audit,
  'reconciliation-docs-hcai-voluntary-suspension-detail-2026-09-29.json'), 'utf8'));
const worklist = JSON.parse(fs.readFileSync(path.join(audit, 'unresolved-investigation-worklist.json'), 'utf8'));

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
    assert.ok(current.next_action, `historical CCN ${ccn} retains a dated evidence gate`);
  }
  assert.ok(nationwide.records.find(record => record.ccn === '050785'), 'DOCS historical CCN remains in the investigation worklist');
  assert.equal(nationwide.records.find(record => record.ccn === '010779').disposition, 'verified-stale-mrf');
  assert.equal(proof.unresolved_count_change, 0);
  assert.match(proof.field_interpretation.limitation, /No exact row is not evidence of closure/);
});

test('DOCS voluntary suspension corroborates the historical CCN boundary without closing replacement/HPT work', () => {
  assert.equal(docsSuspension.ccn, '050785');
  assert.equal(docsSuspension.license_record.license_remark,
    'Voluntary suspension 1/1/2025 - 12/31/2026.');
  assert.equal(docsSuspension.license_record.hcai_id, '106190681');
  assert.equal(docsSuspension.license_record.license_expiration_date, '2026-03-31');
  assert.equal(docsSuspension.cross_source_context.cms_qies_termination_date, '2025-01-01');
  assert.equal(docsSuspension.disposition_changed, false);
  assert.equal(docsSuspension.cohort_count_effect, 0);
  assert.match(docsSuspension.interpretation, /does not prove permanent closure/);
  assert.match(docsSuspension.next_action, /At or after the stated suspension end/);
  assert.match(docsSuspension.source.detail_response_sha256, /^[a-f0-9]{64}$/);

  const reconciledManual = manual.records.find(record => record.ccn === '050785'
    && record.latest_hcai_voluntary_suspension_detail_2026_09_29);
  assert.ok(reconciledManual, 'dated HCAI proof is joined to the exact manual CCN record');
  assert.equal(reconciledManual.latest_hcai_voluntary_suspension_detail_2026_09_29.proof_file,
    'reconciliation-docs-hcai-voluntary-suspension-detail-2026-09-29.json');

  const queued = worklist.records.find(record => record.ccn === '050785');
  assert.ok(queued, 'historical 050785 remains in the unresolved worklist');
  assert.match(queued.next_action, /At or after 2026-12-31/);
  assert.ok(nationwide.records.find(record => record.ccn === '050785'),
    'historical CCN remains covered in current nationwide review');
});
