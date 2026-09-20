'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '../../..');
const queue = require(path.join(root, 'data/hpt-audit/exact-address-alias-candidates.json'));

test('alias candidate queue is source-bound and remains investigative', () => {
  for (const [relative, expected] of Object.entries(queue.source_sha256)) {
    const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, relative))).digest('hex');
    assert.equal(actual, expected, relative);
  }
  assert.equal(queue.summary.candidate_pairs, queue.candidates.length);
  assert.equal(queue.summary.candidate_ccns, new Set(queue.candidates.map(row => row.ccn)).size);
  assert.equal(queue.summary.new_address_lead_pairs,
    queue.candidates.filter(row => row.candidate_kind === 'new-address-lead').length);
  assert.equal(queue.summary.already_reviewed_follow_up_pairs,
    queue.candidates.filter(row => row.candidate_kind === 'already-reviewed-follow-up').length);
  assert.equal(queue.summary.sibling_review_pairs, queue.candidates.filter(row => row.requires_sibling_review).length);
  assert.equal(queue.candidates.some(row => row.ccn === '140184'), false);
  assert.equal(queue.candidates.some(row => row.ccn === '220111'), false);
  assert.equal(queue.candidates.some(row => row.ccn === '150179'), false);
  assert.equal(queue.candidates.some(row => row.ccn === '180043'), false);
  assert.equal(queue.candidates.some(row => row.ccn === '271324'), false);
  assert.equal(queue.candidates.some(row => row.ccn === '310115'), false);
  assert.equal(queue.candidates.some(row => row.ccn === '310118'), false);
  assert.equal(queue.candidates.some(row => row.ccn === '520103'), false);
  assert.equal(queue.candidates.some(row => row.ccn === '521307'), false);
  for (const ccn of ['141335', '360041', '360075', '360098', '361307'])
    assert.equal(queue.candidates.some(row => row.ccn === ccn), false);
  for (const row of queue.candidates) {
    assert.ok(['unmatched', 'review', 'matched'].includes(row.source_header_status));
    assert.equal(row.roster_state, row.declared_state);
    assert.match(row.next_action, /Do not promote on address and ZIP alone/);
    assert.equal(row.requires_sibling_review,
      row.source_header_matched_ccns.some(ccn => ccn !== row.ccn));
  }
  // Lincoln was removed from this investigative alias queue after its
  // complete current browser download received a guarded reviewed resolution.
  assert.equal(queue.candidates.some(row => row.ccn === '330080'), false);
});
