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
  const manualObservations = JSON.parse(read('data/hpt-audit/reconciliation-manual-access-observations.json'));
  const saved = JSON.parse(read('data/hpt-audit/same-campus-ccn-transition-worklist.json'));
  assert.deepEqual(saved.summary, {
    groups: 8, ccns: 16, shared_standing_file_groups: 3, priority_one_groups: 3,
  });
  assert.deepEqual(saved.groups, build(roster, reconciliation, cmsEnrollmentReview, manualObservations).groups);
  for (const relative of ['cms_data/hpt/roster.json', 'data/hpt-audit/nationwide-reconciliation.json',
    'data/hpt-audit/same-campus-cms-enrollment-snapshot-review.json',
    'data/hpt-audit/reconciliation-manual-access-observations.json'])
    assert.equal(saved.source_sha256[relative], crypto.createHash('sha256').update(read(relative)).digest('hex'));
  const bullockRecord = manualObservations.records.find(record => record.ccn === '010110'
    && record.proof_file === 'reconciliation-bullock-current-csv-index-review-proof-2026-09-27.json');
  assert.ok(bullockRecord, 'later source-route observation is recorded');
  const bullockQies = manualObservations.records.find(record => record.ccn === '010110'
    && record.proof_file === 'reconciliation-qies-unresolved-status-audit-2026-09-27.json');
  assert.ok(bullockQies, 'earlier effective-dated transition proof remains in history');
  const wiregrass = saved.groups.find(group => group.ccns.includes('010062'));
  assert.deepEqual(wiregrass.ccns, ['010062', '011309']);
  assert.equal(wiregrass.records.find(row => row.ccn === '010062').workstream, 'verification-proof-gap');
  assert.equal(wiregrass.priority, 1);
  assert.match(wiregrass.next_action, /Confirm primary CMS enrollment\/status/);
  const neshoba = saved.groups.find(group => group.ccns.includes('250043'));
  assert.deepEqual(neshoba.ccns, ['250043', '251340']);
  assert.equal(neshoba.shared_standing_file_url, '');
  assert.equal(neshoba.records.find(row => row.ccn === '251340').cms_enrollment_snapshot.rows, 1);
  assert.equal(neshoba.records.find(row => row.ccn === '250043').cms_enrollment_snapshot.rows, 0);
  assert.equal(neshoba.disposition, 'same-campus-acute-to-cah-transition-recorded-historical-and-current-file-scope-pending');
  assert.match(neshoba.next_action, /250043.*2025-12-31.*251340.*2026-01-01/);
  assert.match(neshoba.next_action, /do not seek a current 250043 file/);
  assert.match(neshoba.next_action, /file-to-CCN assignment unresolved/);
  const bullock = saved.groups.find(group => group.ccns.includes('010110'));
  assert.deepEqual(bullock.ccns, ['010110', '010779']);
  assert.equal(bullock.disposition, 'same-campus-qies-effective-dated-transition-recorded-mrf-scope-pending');
  assert.match(bullock.next_action, /terminated 2024-04-30 and REH CCN 010779 began participation 2024-05-01/);
  assert.match(bullock.next_action, /do not transfer the REH MRF to 010110/);
  const lakeland = saved.groups.find(group => group.ccns.includes('010125'));
  assert.deepEqual(lakeland.ccns, ['010125', '011311']);
  assert.equal(lakeland.disposition, 'same-campus-qies-effective-dated-transition-recorded-mrf-scope-pending');
  assert.match(lakeland.next_action, /terminated 2025-11-13 and CAH CCN 011311 began participation 2025-11-14/);
  assert.match(lakeland.next_action, /do not transfer files or evidence between these CCNs/);
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
