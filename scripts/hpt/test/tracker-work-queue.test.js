'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildReviewedWorkQueue } = require('../lib/tracker-work-queue');

test('reviewed queue excludes resolved base investigations and preserves explicit monitoring and scope follow-ups', () => {
  const records = [
    { ccn: '1', disposition: 'unresolved' },
    { ccn: '2', disposition: 'unresolved', latest_observation_superseded: true },
    { ccn: '3', disposition: 'verified-access' },
    { ccn: '4', disposition: 'scope-exempt' },
    { ccn: '5', disposition: 'scope-exempt' },
  ];
  const steps = {
    '1': { stream: 'genuinely-unresolved-investigation' },
    '2': { stream: 'genuinely-unresolved-investigation' },
    '3': { stream: 'supported-uncertainty-monitor' },
    '4': { stream: 'same-campus-ccn-review' },
  };
  const queue = buildReviewedWorkQueue(steps, records);
  assert.equal(queue.find(row => row.key === 'genuinely-unresolved-investigation').n, 1);
  assert.equal(queue.reduce((sum, row) => sum + row.n, 0), 3);
  assert.ok(queue.every(row => row.n > 0));
  assert.ok(queue.some(row => row.key === 'supported-uncertainty-monitor'));
  assert.ok(queue.some(row => row.key === 'same-campus-ccn-review'));
  assert.ok(queue.every(row => !row.label.includes('Close as exempt')));
});

test('retained findings with unresolved metadata conflicts stay in the investigation count', () => {
  const records = [
    { ccn: '1', disposition: 'linked-mrf-header-unmatched', standing_evidence_retained: true,
      reconciliation_workstream: 'genuinely-unresolved-investigation' },
    { ccn: '2', disposition: 'linked-mrf-header-unmatched', standing_evidence_retained: true,
      reconciliation_workstream: 'standing-evidence-follow-up' },
  ];
  const steps = {
    '1': { stream: 'genuinely-unresolved-investigation' },
    '2': { stream: 'standing-evidence-follow-up' },
  };
  const queue = buildReviewedWorkQueue(steps, records);
  assert.equal(queue.find(row => row.key === 'genuinely-unresolved-investigation').n, 1);
  assert.equal(queue.find(row => row.key === 'standing-evidence-follow-up').n, 1);
});

test('queue fails visibly when unresolved coverage, stream definitions, or CCN identity drift', () => {
  assert.throws(() => buildReviewedWorkQueue({}, [{ ccn: '1' }]), /no reviewed next step/);
  assert.throws(() => buildReviewedWorkQueue({ '1': { stream: 'unknown' } }, [{ ccn: '1' }]), /Unknown/);
  assert.throws(() => buildReviewedWorkQueue({ '2': { stream: 'identity-quarantine' } }, [{ ccn: '1' }]), /absent/);
  assert.throws(() => buildReviewedWorkQueue({}, [{ ccn: '1' }, { ccn: '1' }]), /Duplicate/);
});
