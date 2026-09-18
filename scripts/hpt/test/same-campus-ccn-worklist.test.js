'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { build } = require('../build-same-campus-ccn-worklist');

const root = path.resolve(__dirname, '../../..');
const read = relative => fs.readFileSync(path.join(root, relative));

test('same-campus queue is complete, source-bound and does not infer CCN scope', () => {
  const roster = JSON.parse(read('cms_data/hpt/roster.json'));
  const reconciliation = JSON.parse(read('data/hpt-audit/nationwide-reconciliation.json'));
  const cmsEnrollmentReview = JSON.parse(read('data/hpt-audit/same-campus-cms-enrollment-snapshot-review.json'));
  const saved = JSON.parse(read('data/hpt-audit/same-campus-ccn-transition-worklist.json'));
  assert.deepEqual(saved.summary, {
    groups: 8, ccns: 16, shared_standing_file_groups: 3, priority_one_groups: 3,
  });
  assert.deepEqual(saved.groups, build(roster, reconciliation, cmsEnrollmentReview).groups);
  for (const relative of ['cms_data/hpt/roster.json', 'data/hpt-audit/nationwide-reconciliation.json',
    'data/hpt-audit/same-campus-cms-enrollment-snapshot-review.json'])
    assert.equal(saved.source_sha256[relative], crypto.createHash('sha256').update(read(relative)).digest('hex'));
  const wiregrass = saved.groups.find(group => group.ccns.includes('010062'));
  assert.deepEqual(wiregrass.ccns, ['010062', '011309']);
  assert.equal(wiregrass.records.find(row => row.ccn === '010062').workstream, 'consistent');
  assert.equal(wiregrass.priority, 1);
  assert.match(wiregrass.next_action, /Confirm primary CMS enrollment\/status/);
  const neshoba = saved.groups.find(group => group.ccns.includes('250043'));
  assert.deepEqual(neshoba.ccns, ['250043', '251340']);
  assert.equal(neshoba.shared_standing_file_url, '');
  assert.equal(neshoba.records.find(row => row.ccn === '251340').cms_enrollment_snapshot.rows, 1);
  assert.equal(neshoba.records.find(row => row.ccn === '250043').cms_enrollment_snapshot.rows, 0);
  assert.match(neshoba.next_action, /not a transition-date history/);
  const allCcns = saved.groups.flatMap(group => group.ccns);
  assert.equal(new Set(allCcns).size, 16);
});

test('same street with different hospital names is not a duplicate CCN transition', () => {
  const roster = [
    { ccn: '100001', name: 'Alpha Hospital', address: '1 Main St', city: 'Town', state: 'NY', zip: '10001', type: 'Acute Care Hospitals' },
    { ccn: '101301', name: 'Beta Hospital', address: '1 Main St', city: 'Town', state: 'NY', zip: '10001', type: 'Critical Access Hospitals' },
  ];
  const reconciliation = { records: roster.map(row => ({ ccn: row.ccn, standing_finding: '', proposed_disposition: '', workstream: 'genuinely-unresolved-investigation' })) };
  assert.equal(build(roster, reconciliation).summary.groups, 0);
});
