'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const auditDir = path.resolve(__dirname, '../../../data/hpt-audit');
const read = name => JSON.parse(fs.readFileSync(path.join(auditDir, name), 'utf8'));

test('effective audit hash-binds every actionable worklist row and preserves its CCN-specific next action', () => {
  const effectiveAudit = read('nationwide-effective-audit.json');
  const worklistBytes = fs.readFileSync(path.join(auditDir, 'unresolved-investigation-worklist.json'));
  const worklist = JSON.parse(worklistBytes.toString('utf8'));
  const workByCcn = new Map(worklist.records.map(row => [row.ccn, row]));
  const sourceHash = crypto.createHash('sha256').update(worklistBytes).digest('hex');
  const mismatchCcns = [];
  const historicalMismatchCcns = [];

  assert.equal(effectiveAudit.records.length, 5419);
  assert.equal(effectiveAudit.inputs.unresolved_investigation_worklist.sha256, sourceHash);
  assert.equal(effectiveAudit.investigation_worklist.source_sha256, sourceHash);
  assert.equal(effectiveAudit.coverage.investigation_worklist_ccns, 581);
  assert.equal(effectiveAudit.coverage.investigation_worklist_exact_reconciliation_join, true);
  assert.equal(effectiveAudit.coverage.historical_891_unresolved_in_worklist, 541);
  assert.equal(effectiveAudit.investigation_worklist.actionable_items, worklist.records.length);

  for (const record of effectiveAudit.records) {
    const source = workByCcn.get(record.ccn);
    const joined = record.investigation_worklist;
    const expected = record.reconciliation.workstream === 'genuinely-unresolved-investigation';
    assert.equal(Boolean(joined), expected, `worklist presence mismatch for ${record.ccn}`);
    if (!source) continue;
    assert.deepEqual(joined, {
      source_file: 'unresolved-investigation-worklist.json',
      current_disposition: source.current_disposition,
      investigation_tier: source.investigation_tier,
      evidence_gate: source.evidence_gate,
      reviewed_follow_up: !!source.reviewed_follow_up,
      reviewed_sources: source.reviewed_sources || [],
      latest_review_at: source.latest_review_at || '',
      next_action: source.next_action,
      action_matches_reconciliation: source.next_action === record.reconciliation.next_action
    }, `worklist source fields mismatch for ${record.ccn}`);
    if (joined.action_matches_reconciliation === false) {
      mismatchCcns.push(record.ccn);
      if (record.historical_891_member
        && record.historical_891_current_category === 'genuinely-unresolved') historicalMismatchCcns.push(record.ccn);
    }
  }

  const historicalUnresolved = effectiveAudit.records.filter(record => record.historical_891_member
    && record.historical_891_current_category === 'genuinely-unresolved');
  assert.equal(historicalUnresolved.length, 541);
  assert.ok(historicalUnresolved.every(record => record.investigation_worklist),
    'all 541 unresolved members of the 891 cohort retain an exact actionable worklist row');
  assert.equal(effectiveAudit.investigation_worklist.next_action_differences_from_reconciliation, mismatchCcns.length);
  assert.deepEqual(effectiveAudit.investigation_worklist.next_action_difference_ccns, mismatchCcns);
  assert.equal(effectiveAudit.investigation_worklist.historical_891_next_action_differences, historicalMismatchCcns.length);
  assert.deepEqual(effectiveAudit.investigation_worklist.historical_891_next_action_difference_ccns, historicalMismatchCcns);

  const vendorPortal = effectiveAudit.records.find(record => record.ccn === '070031');
  assert.match(vendorPortal.investigation_worklist.next_action, /Only after user authorization/,
    'the prioritized action retains its vendor-terms authorization gate');

  const rush = workByCcn.get('140119');
  assert.equal(rush.reviewed_follow_up, true,
    'the retained current pointer/page target proof is attached to the actionable CCN');
  assert.deepEqual(rush.reviewed_sources, ['manual-access']);
  assert.match(rush.next_action, /bytes through a materially different permitted publisher route/);
  assert.match(rush.next_action, /1653 W Congress versus 1620 W Harrison/);
  assert.doesNotMatch(rush.next_action, /Reconcile every pointer entry/,
    'do not retain a stale generic pointer-alias task after exact page/pointer target linkage was proven');

  const reconciliation = read('nationwide-reconciliation.json').records.find(record => record.ccn === '251325');
  const standingFollowUp = read('standing-evidence-followup-worklist.json').records
    .find(record => record.ccn === '251325');
  assert.ok(reconciliation);
  assert.equal(reconciliation.standing_finding, 'compliant-observed');
  assert.equal(standingFollowUp, undefined,
    'a successfully validated current file is not left in the standing-evidence follow-up queue');
  assert.match(reconciliation.next_action, /Retain the raw publisher location_name suffix/);
});
