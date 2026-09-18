'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { candidatesFor } = require('../build-address-variant-alias-candidates');

const root = path.resolve(__dirname, '../../..');
const queue = require('../../../data/hpt-audit/address-variant-alias-candidates.json');

test('ZIP-variant alias lead requires same street, city and license state but differing ZIP', () => {
  const item = { ccn: '900001', reviewed_follow_up: false };
  const facility = { 'Facility Name': 'Example Hospital', Address: '975 E 3RD ST',
    'City/Town': 'CHATTANOOGA', State: 'TN', 'ZIP Code': '37499' };
  const header = { related_ccns: '900001', mrf_license_state: 'TN',
    mrf_address: '975 East Third Street, Chattanooga, TN 37403',
    mrf_url: 'https://hospital.example/standardcharges.csv?token=secret',
    header_status: 'unmatched', header_matched_ccns: '', pointer_sha256s: '' };
  const leads = candidatesFor(item, facility, header);
  assert.equal(leads.length, 1);
  assert.deepEqual(leads[0].declared_zip, ['37403']);
  assert.equal(leads[0].mrf_query_values_withheld, true);
  assert.equal(JSON.stringify(leads).includes('secret'), false);
  assert.equal(candidatesFor(item, { ...facility, 'ZIP Code': '37403' }, header).length, 0);
  assert.equal(candidatesFor(item, facility, { ...header, mrf_license_state: 'GA' }).length, 0);
  assert.equal(candidatesFor(item, facility, { ...header,
    mrf_address: '975 East Fourth Street, Chattanooga, TN 37403' }).length, 0);
  assert.equal(candidatesFor(item, facility, { ...header,
    mrf_address: '975 East Third Street, Nashville, TN 37403' }).length, 0);
  assert.equal(candidatesFor(item, facility, { ...header,
    mrf_address: '975 East Third Street, Chattanooga, TN 37403 | 975 East Third Street, Chattanooga, TN 37403' })[0]
    .requires_multi_campus_review, false);
});

test('ZIP-variant alias queue is source-bound and remains investigative', () => {
  for (const [relative, expected] of Object.entries(queue.source_sha256)) {
    const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, relative))).digest('hex');
    assert.equal(actual, expected, relative);
  }
  assert.equal(queue.summary.candidate_pairs, queue.candidates.length);
  assert.equal(queue.summary.candidate_ccns, new Set(queue.candidates.map(row => row.ccn)).size);
  assert.equal(queue.summary.sibling_review_pairs,
    queue.candidates.filter(row => row.requires_sibling_review).length);
  assert.equal(queue.summary.multi_campus_pairs,
    queue.candidates.filter(row => row.requires_multi_campus_review).length);
  for (const row of queue.candidates) {
    assert.equal(row.roster_state, row.declared_license_state);
    assert.equal(row.declared_zip.includes(row.roster_zip), false);
    assert.match(row.next_action, /Do not promote/);
    assert.match(row.mrf_url_sha256, /^[a-f0-9]{64}$/);
    assert.equal(Object.hasOwn(row, 'mrf_url'), false);
  }
});
