'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { summarize } = require('../review-priority-one-cms-enrollments');

const audit = path.resolve(__dirname, '../../../data/hpt-audit');
const read = name => JSON.parse(fs.readFileSync(path.join(audit, name), 'utf8'));

test('exact-CCN CMS snapshot covers the priority-one cohort without treating absence as termination', () => {
  const snapshot = read('priority-one-cms-enrollment-snapshot-review.json');
  const worklist = read('unresolved-investigation-worklist.json');
  const reconciliation = read('nationwide-reconciliation.json');
  const priorityCcns = worklist.records.filter(row => row.investigation_tier === 1).map(row => row.ccn).sort();
  // The dated CMS lookup remains evidence for its original cohort even when
  // later pointer reclassification moves a CCN to a different work tier.
  const capturedCcns = new Set(snapshot.records.map(row => row.ccn));
  assert.ok(priorityCcns.every(ccn => capturedCcns.has(ccn)));
  // The snapshot is a dated capture of its original cohort.  Later evidence
  // may move a CCN into or out of Tier 1; require coverage of today's cohort
  // without pretending the historical query count must be identical.
  assert.ok(snapshot.summary.queried_ccns >= priorityCcns.length);
  assert.equal(snapshot.summary.ccns_with_rows + snapshot.summary.ccns_without_rows,
    snapshot.summary.queried_ccns);
  assert.match(snapshot.limitation, /No row is not proof of CCN termination/);
  for (const record of snapshot.records) {
    assert.match(record.query_url, new RegExp(`filter%5BCCN%5D=${record.ccn}&size=10$`));
    assert.match(record.response_sha256, /^[a-f0-9]{64}$/);
    assert.ok(record.rows.every(row => row.ccn === record.ccn));
    assert.deepEqual(reconciliation.records.find(row => row.ccn === record.ccn).cms_enrollment_snapshot, record);
  }
  const byCcn = new Map(snapshot.records.map(row => [row.ccn, row]));
  const expectedAddresses = {
    '321305': '1600 N MAIN AVE', '260110': '1701 LACEY ST',
    '380005': '280 MAPLE ST', '500003': '1415 E KINCAID ST',
  };
  for (const [ccn, address] of Object.entries(expectedAddresses)) {
    if (byCcn.has(ccn) && byCcn.get(ccn).rows.length)
      assert.equal(byCcn.get(ccn).rows[0].address_line_1, address);
  }
  if (byCcn.has('250043')) assert.equal(byCcn.get('250043').rows.length, 0);
  const retained380005 = reconciliation.records.find(row => row.ccn === '380005');
  if (retained380005) assert.match(retained380005.next_action,
    /do not infer active or terminated Medicare enrollment from the snapshot alone/);
});

test('CMS snapshot parser refuses another CCN and binds raw response bytes', () => {
  const raw = Buffer.from('[{"CCN":"321305","ORGANIZATION NAME":"Nor-Lea"}]');
  const row = summarize('321305', JSON.parse(raw), 'https://example.test/', raw, '2026-09-16T00:00:00Z');
  assert.equal(row.response_sha256, crypto.createHash('sha256').update(raw).digest('hex'));
  assert.throws(() => summarize('321305', [{ CCN: '321306' }], '', raw, ''), /exact-CCN/);
});
