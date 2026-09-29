'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const audit = path.resolve(__dirname, '../../../data/hpt-audit');
const ccns = ['214002', '214004', '214012', '214018'];
const reconciliation = require(path.join(audit, 'nationwide-reconciliation.json')).records;
const worklist = require(path.join(audit, 'unresolved-investigation-worklist.json')).records;
const resolutionLedger = require(path.join(audit, 'reviewed-resolutions.json'));

test('current Maryland scope-review overlay outranks historical scope-exempt wording without changing unresolved status', () => {
  for (const ccn of ccns) {
    const resolution = resolutionLedger.find(item => item.ccn === ccn);
    const row = reconciliation.find(item => item.ccn === ccn);
    const queued = worklist.find(item => item.ccn === ccn);
    assert.equal(resolution.action, 'scope-review-pending');
    assert.equal(resolution.scope_review.status, 'state-hospital-exception-not-established');
    assert.equal(row.scope_review_reconciliation.action, 'scope-review-pending');
    assert.equal(row.scope_review_reconciliation.status, 'state-hospital-exception-not-established');
    assert.equal(row.manual_access_observation.latest_scope_review.status, 'state-hospital-exception-not-established');
    assert.equal(row.manual_access_observation.latest_scope_review.observed_at, resolution.reviewed_at);
    assert.equal(row.manual_access_observation.previous_scope_review_assessment.state_hospital_scope,
      'deemed-compliant-under-45-CFR-180.30(b)');
    assert.equal(row.proposed_disposition, 'pointer-facility-match-unresolved');
    assert.equal(queued.current_disposition, 'pointer-facility-match-unresolved');
    assert.equal(row.next_action, resolution.scope_review.next_action);
    assert.match(queued.next_action, /^Keep the facility unresolved\. Locate and verify a current facility-specific CMS MRF/);
    assert.doesNotMatch(row.next_action, /retain the four as federal scope-exempt/i);
  }
});
