'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const audit = path.resolve(__dirname, '../../../data/hpt-audit');

test('reviewed pointer and page gaps retain actionable standing follow-ups', () => {
  const reconciliation = JSON.parse(fs.readFileSync(path.join(audit,
    'nationwide-reconciliation.json'), 'utf8'));
  const queue = JSON.parse(fs.readFileSync(path.join(audit,
    'standing-evidence-followup-worklist.json'), 'utf8'));
  const queued = new Map(queue.records.map(row => [row.ccn, row]));
  const reviewed = reconciliation.records.filter(row =>
    row.issues.includes('reviewed-pointer-or-page-linkage-follow-up'));

  assert.ok(reviewed.length >= 67);
  for (const row of reviewed) {
    assert.ok(['standing-evidence-follow-up', 'genuinely-unresolved-investigation'].includes(row.workstream), row.ccn);
    assert.equal(row.reconciliation_status, 'review-required', row.ccn);
    const followUp = queued.get(row.ccn)
      || JSON.parse(fs.readFileSync(path.join(audit, 'unresolved-investigation-worklist.json'), 'utf8'))
        .records.find(item => item.ccn === row.ccn);
    assert.ok(followUp, row.ccn);
    assert.equal(followUp.reviewed_follow_up, true, row.ccn);
    assert.ok(followUp.next_action && !followUp.next_action.startsWith('No further action'), row.ccn);
  }
  for (const ccn of ['450860', '440200', '010058']) assert.ok(queued.has(ccn), ccn);
});
