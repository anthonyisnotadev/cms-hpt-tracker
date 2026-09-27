'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { addressObservationRequiresAction, dispositionNextAction, historicalChanges, isSupportedAutomatedChallenge, isSupportedBrowserAddressConflict,
  isSupportedIdentityUncertainty, laterManualObservationRequiresFollowUp,
  reconciliationWorkstream, resolutionObservedAt, reviewedResolutionSupersedes,
  reconciliationStatus, standingEvidenceRetained } = require('../lib/reconciliation-precedence');
const { applyNationwideVerification } = require('../lib/nationwide-verification-view');

test('only an applied, dated resolution at or after the nationwide observation supersedes it', () => {
  const resolution = { reviewed_at: '2026-09-15T10:00:00Z', evidence: { checked_at: '2026-09-15T11:00:00Z' } };
  assert.equal(resolutionObservedAt(resolution), '2026-09-15T11:00:00Z');
  assert.equal(reviewedResolutionSupersedes(resolution, '2026-09-15T10:30:00Z'), true);
  assert.equal(reviewedResolutionSupersedes(resolution, '2026-09-15T11:30:00Z'), false);
  assert.equal(reviewedResolutionSupersedes(resolution, ''), true);
  assert.equal(reviewedResolutionSupersedes(resolution, '2026-09-15T10:30:00Z', false), false);
  assert.equal(reviewedResolutionSupersedes(resolution, '', false), false);
  assert.equal(reviewedResolutionSupersedes({ reviewed_at: 'invalid' }, '2026-09-15'), false);
  assert.equal(reviewedResolutionSupersedes(null, '2026-09-15'), false);
});

test('dated manual follow-up survives an older nationwide check but not a later reviewed resolution', () => {
  const observation = { observed_at: '2026-09-16T12:00:00Z', disposition: 'distinct-current-page-file',
    next_action: 'Compare complete files.' };
  const nationwideAt = '2026-09-15T12:00:00Z';
  assert.equal(laterManualObservationRequiresFollowUp(observation, nationwideAt, null), true);
  assert.equal(laterManualObservationRequiresFollowUp(observation, nationwideAt,
    { evidence: { checked_at: '2026-09-16T13:00:00Z' } }), false);
  assert.equal(laterManualObservationRequiresFollowUp(observation, nationwideAt,
    { evidence: { checked_at: '2026-09-16T11:00:00Z' } }), true);
  assert.equal(laterManualObservationRequiresFollowUp({ ...observation, next_action: '' }, nationwideAt, null), false);
  assert.equal(laterManualObservationRequiresFollowUp({ ...observation, observed_at: '' }, nationwideAt, null), false);
  assert.equal(laterManualObservationRequiresFollowUp({ ...observation, observed_at: nationwideAt }, nationwideAt, null), false);
});

test('incomplete newer checks retain stronger standing evidence without becoming unresolved', () => {
  for (const disposition of ['pointer-discovery-incomplete', 'pointer-not-retrieved',
    'pointer-access-denied-to-client', 'linked-mrf-header-unmatched',
    'mrf-facility-identity-unresolved', 'mrf-request-unsuccessful',
    'pointer-linked-file-not-probed']) {
    assert.equal(standingEvidenceRetained('compliant-observed', disposition), true);
  }
  assert.equal(standingEvidenceRetained('mrf-stale-over-365-days', 'pointer-discovery-incomplete'), true);
  assert.equal(standingEvidenceRetained('pointer-http-client-error-page-file-found', 'pointer-facility-match-unresolved'), true);
  assert.equal(standingEvidenceRetained('official-page-mrf-root-pointer-unavailable', 'pointer-not-retrieved'), true);
  assert.equal(standingEvidenceRetained('pointer-http-client-error-page-file-found', 'verified-current-mrf'), false);
  assert.equal(standingEvidenceRetained('not-assessed-domain-unknown', 'pointer-discovery-incomplete'), false);
  assert.equal(standingEvidenceRetained('compliant-observed', 'verified-current-mrf'), false);
  assert.equal(standingEvidenceRetained('compliant-observed', 'scope-exempt-closed'), false);
});

test('nationwide overlay cannot erase a stronger standing finding even without a retained flag', () => {
  const row = { ccn: '001234', hospital_name: 'Example Hospital', city: 'Example', state: 'AL',
    finding: 'compliant-observed', assessable: 'yes', checked_at: '2026-09-01T00:00:00Z',
    mrf_url: 'https://example.test/current.json', cms_template_version: '3.0.0' };
  for (const disposition of ['pointer-discovery-incomplete', 'pointer-not-retrieved',
    'pointer-access-denied-to-client', 'mrf-request-unsuccessful', 'linked-mrf-header-unmatched']) {
    const [result] = applyNationwideVerification([row], [{ ccn: row.ccn,
      hospital_name: row.hospital_name, city: row.city, state: row.state,
      prior_finding: row.finding, disposition, observed_at: '2026-09-02T00:00:00Z' }]);
    assert.deepEqual(result, row, `incomplete ${disposition} must not erase standing evidence`);
  }
});

test('supported identity uncertainty requires a quarantine and reproducible pointer/file identity proof', () => {
  const proof = { pointer_sha256: 'p', payload_sha256: 'f', observed_hospital_name: 'Other Campus', observed_address: '1 Main St' };
  assert.equal(isSupportedIdentityUncertainty({ action: 'quarantine', proof }), true);
  assert.equal(isSupportedIdentityUncertainty({ action: 'replace', proof }), false);
  assert.equal(isSupportedIdentityUncertainty({ action: 'quarantine', proof: { ...proof, payload_sha256: '' } }), false);
  assert.equal(isSupportedIdentityUncertainty({ action: 'quarantine', proof: null }), false);
});

test('supported browser address conflict is bound to the exact current CCN, file, and observation', () => {
  const proposal = { ccn: '170185', mrf_url: 'https://example.org/file.json',
    observed_at: '2026-09-15T09:07:51Z', browser_identity_gate: 'file-address-reconciliation-required' };
  const observation = { ccn: proposal.ccn, disposition: 'current-file-address-conflicts-official-facility-address',
    mrf_url: proposal.mrf_url, browser_observed_at: proposal.observed_at, pointer_sha256: 'p',
    source_page_url: 'https://example.org/pricing', facility_page_url: 'https://example.org/facility',
    declared_file_address: '1200 Main St', official_facility_address: '12300 Main St', roster_address: '12300 MAIN ST' };
  const browserReview = { target: proposal.mrf_url, observed_at: proposal.observed_at,
    status: 'retrieved', declared_address: observation.declared_file_address };
  assert.equal(isSupportedBrowserAddressConflict(observation, proposal, browserReview), true);
  for (const change of [{ ccn: '170186' }, { mrf_url: 'https://example.org/other.json' },
    { browser_observed_at: '2026-09-14' }, { pointer_sha256: '' }]) {
    assert.equal(isSupportedBrowserAddressConflict({ ...observation, ...change }, proposal, browserReview), false);
  }
  assert.equal(isSupportedBrowserAddressConflict(observation, { ...proposal, browser_identity_gate: 'other' }, browserReview), false);
  assert.equal(isSupportedBrowserAddressConflict(observation, proposal, { ...browserReview, declared_address: 'other' }), false);
});

test('automated CAPTCHA evidence is dated and URL-bound without overturning standing file evidence', () => {
  const standing = { ccn: '390001', pointer_url: 'https://hospital.test/cms-hpt.txt',
    mrf_url: 'https://hospital.test/file', finding: 'compliant-observed' };
  const proposal = { observed_at: '2026-09-15T00:00:00Z' };
  const observation = { ccn: standing.ccn, pointer_url: standing.pointer_url,
    pointer_mrf_url: standing.mrf_url, prior_finding: standing.finding,
    disposition: 'automated-client-received-html-captcha-not-file-verdict',
    http_status: 200, content_type: 'text/html', html_title: 'Radware Captcha Page',
    response_sha256: 'a'.repeat(64), observed_at: '2026-09-16T00:00:00Z' };
  assert.equal(isSupportedAutomatedChallenge(observation, standing, proposal), true);
  assert.equal(isSupportedAutomatedChallenge({ ...observation, pointer_mrf_url: 'https://hospital.test/other' }, standing, proposal), false);
  assert.equal(isSupportedAutomatedChallenge({ ...observation, observed_at: '2026-09-14T00:00:00Z' }, standing, proposal), false);
  assert.equal(isSupportedAutomatedChallenge({ ...observation, html_title: 'Download File' }, standing, proposal), false);
});

test('resolved address evidence remains provenance rather than an actionable discrepancy', () => {
  const pending = { status: 'address-equivalence-reviewed-file-proof-pending' };
  assert.equal(addressObservationRequiresAction(pending, { browser_identity_gate: 'reviewed-file-address-equivalence' }), false);
  assert.equal(addressObservationRequiresAction({ status: 'roster-campus-relationship-unresolved' }, {}, {
    action: 'replace', evidence: { rosterAddressException: 'CMS documents the campus relationship.' }
  }), false);
  assert.equal(addressObservationRequiresAction({ status: 'roster-campus-relationship-unresolved' }, {}, null), true);
});

test('supported URL and date changes are tracked separately from discrepancies', () => {
  assert.deepEqual(historicalChanges({ mrf_url: 'new', mrf_last_updated: '2026-01-01' }, {
    mrf_url: 'old', mrf_last_updated: '2025-01-01'
  }), ['file-url-changed', 'declared-date-changed']);
  assert.deepEqual(historicalChanges({ mrf_url: 'same', mrf_last_updated: 'same' }, {
    mrf_url: 'same', mrf_last_updated: 'same'
  }), []);
});

test('reconciliation workstreams separate current uncertainty from lower-risk follow-up', () => {
  assert.equal(reconciliationWorkstream(['latest-check-unresolved']), 'genuinely-unresolved-investigation');
  assert.equal(reconciliationWorkstream(['verification-file-byte-proof-audit-pending']), 'verification-proof-gap');
  assert.equal(reconciliationWorkstream(['standing-evidence-retained-review-new-observation']), 'standing-evidence-follow-up');
  assert.equal(reconciliationWorkstream(['reviewed-pointer-target-client-follow-up']), 'standing-evidence-follow-up');
  assert.equal(reconciliationWorkstream(['reviewed-pointer-or-page-linkage-follow-up']), 'standing-evidence-follow-up');
  assert.equal(reconciliationWorkstream(['official-page-file-corroborated-root-pointer-pending']), 'standing-evidence-follow-up');
  assert.equal(reconciliationWorkstream(['browser-file-identity-proof-insufficient']), 'standing-evidence-follow-up');
  assert.equal(reconciliationWorkstream(['later-manual-observation-follow-up']), 'standing-evidence-follow-up');
  assert.equal(reconciliationWorkstream(['proposed-finding-differs-from-standing']), 'standing-finding-discrepancy');
  assert.equal(reconciliationWorkstream(['latest-check-unresolved'], true), 'supported-uncertainty-monitor');
  assert.equal(reconciliationWorkstream([]), 'consistent');
});

test('reconciliation status distinguishes audited proof and reviewed supersession from pending proof', () => {
  assert.equal(reconciliationStatus([], { status: 'proof-audit-complete' }), 'consistent-proof-audited');
  assert.equal(reconciliationStatus([], { status: 'superseded-by-reviewed-resolution' }), 'consistent-superseded-by-reviewed-resolution');
  assert.equal(reconciliationStatus([], { status: 'not-a-verification-claim' }, false, false, true),
    'consistent-superseded-by-reviewed-resolution');
  assert.equal(reconciliationStatus([], null), 'consistent-summary-proof-audit-pending');
  assert.equal(reconciliationStatus(['latest-check-unresolved'], { status: 'proof-audit-complete' }), 'review-required');
  assert.equal(reconciliationStatus([], null, true), 'supported-identity-uncertainty');
  assert.equal(reconciliationStatus([], null, false, true), 'supported-current-file-address-conflict');
});

test('a rejected sibling artifact cannot create work on a consistent CCN', () => {
  const disposition = { next_action: 'Find the correct facility file.' };
  assert.equal(dispositionNextAction([], disposition), '');
  assert.equal(dispositionNextAction(['latest-check-unresolved'], disposition), disposition.next_action);
  assert.equal(dispositionNextAction(['latest-check-unresolved'], null), '');
});
