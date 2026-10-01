'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const audit = path.resolve(__dirname, '../../../data/hpt-audit');
const ccns = ['214002', '214004', '214012', '214018'];
const reconciliation = require(path.join(audit, 'nationwide-reconciliation.json')).records;
const worklist = require(path.join(audit, 'unresolved-investigation-worklist.json')).records;
const resolutionLedger = require(path.join(audit, 'reviewed-resolutions.json'));
const scopeProof = require(path.join(audit, 'reconciliation-maryland-state-hospital-scope-proof-2026-09-27.json'));

test('live CMS FAQ recheck rejects blanket state-hospital exemption and preserves the four unresolved facilities', () => {
  const policy = scopeProof.latest_cms_faq_recheck_2026_09_30;
  assert.equal(policy.source_url,
    'https://www.cms.gov/files/document/hospital-price-transparency-frequently-asked-questions.pdf');
  assert.match(policy.cms_text_observed, /state-owned or operated facilities other than those deemed compliant/i);
  assert.match(policy.cms_text_observed, /state forensic hospitals that treat exclusively/i);
  assert.equal(policy.disposition_effect, 'none; keep the four unresolved for facility-specific MRF coverage or exact-facility exception proof');
  assert.match(scopeProof.scope_disposition, /Historical first assessment only/);
  assert.match(scopeProof.next_action, /Do not restore the superseded blanket state-hospital exemption/);
  for (const ccn of ccns) {
    const row = reconciliation.find(item => item.ccn === ccn);
    const queued = worklist.find(item => item.ccn === ccn);
    assert.equal(row.proposed_disposition, 'pointer-facility-match-unresolved');
    assert.equal(queued.current_disposition, 'pointer-facility-match-unresolved');
  }
});

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
    assert.equal(row.next_action, queued.next_action);
    assert.match(row.next_action, /^Keep the facility unresolved\. Locate and verify a current facility-specific CMS MRF/);
    assert.doesNotMatch(row.next_action, /retain the four as federal scope-exempt/i);
  }
});
