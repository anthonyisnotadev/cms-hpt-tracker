'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { addressObservationRequiresAction, dispositionNextAction, historicalChanges, isSupportedAutomatedChallenge, isSupportedBrowserAddressConflict,
  isSupportedIdentityUncertainty, laterManualObservationRequiresFollowUp,
  reconciliationWorkstream, resolutionObservedAt, reviewedResolutionIsSameObservation, reviewedResolutionSupersedes,
  reconciliationStatus, sameResolvedPointerRetry, standingEvidenceRetained, standingFollowUpKind } = require('../lib/reconciliation-precedence');
const { applyNationwideVerification } = require('../lib/nationwide-verification-view');

test('a retained finding is an access retry only when the newer check was transport-only and nothing else is open', () => {
  const retained = ['standing-evidence-retained-review-new-observation'];
  for (const proposed_disposition of ['mrf-request-unsuccessful', 'pointer-access-denied-to-client', 'pointer-discovery-incomplete'])
    assert.equal(standingFollowUpKind({ issues: retained, proposed_disposition }), 'access-retry', proposed_disposition);
  // Identity contradictions are contrary evidence, not a failed fetch.
  for (const proposed_disposition of ['mrf-facility-identity-unresolved', 'linked-mrf-header-unmatched', 'pointer-facility-match-unresolved'])
    assert.equal(standingFollowUpKind({ issues: retained, proposed_disposition }), 'evidence-review', proposed_disposition);
  // Any additional open issue keeps the row in human review.
  assert.equal(standingFollowUpKind({ issues: [...retained, 'later-manual-observation-follow-up'],
    proposed_disposition: 'mrf-request-unsuccessful' }), 'evidence-review');
  assert.equal(standingFollowUpKind({ issues: ['later-manual-observation-follow-up'],
    proposed_disposition: 'mrf-request-unsuccessful' }), 'evidence-review');
  assert.equal(standingFollowUpKind({}), 'evidence-review');
});

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

test('an exact reviewed resolution adjudicates its same-timestamp observation instead of superseding it', () => {
  const hash = 'a'.repeat(64);
  const resolution = { action: 'replace', evidence: { identity: 'corroborated',
    checked_at: '2026-09-30T04:10:00Z', pointerSha256: hash, url: 'https://example.test/current.json',
    fileSha256: 'b'.repeat(64) } };
  const observation = { observed_at: '2026-09-30T04:10:00Z', pointer_corpus_sha256: hash,
    mrf_url: 'https://example.test/current.json' };
  const manual = { file_sha256: 'b'.repeat(64),
    manual_identity_gate: 'current-root-pointer-exact-file-full-bytes-header-name-address-state-date-attestation-agree' };
  assert.equal(reviewedResolutionIsSameObservation(resolution, observation, manual), true);
  assert.equal(reviewedResolutionIsSameObservation(resolution,
    { ...observation, mrf_url: 'https://example.test/other.json' }, manual), false);
  assert.equal(reviewedResolutionIsSameObservation(resolution, observation, manual, false), false);
});

test('a newer incomplete retry keeps a strongly supported cohort finding open despite an older applied resolution', () => {
  const resolution = { reviewed_at: '2026-09-20T10:00:00Z', evidence: { checked_at: '2026-09-20T10:00:00Z' } };
  const retryAt = '2026-09-29T18:00:00Z';
  const finding = 'pointer-facility-match-unresolved';
  assert.equal(reviewedResolutionSupersedes(resolution, retryAt, true), false);
  assert.equal(standingEvidenceRetained(finding, 'pointer-facility-match-unresolved'), true);
});

test('a byte-identical pointer retry does not reopen a file already resolved against that exact pointer and MRF', () => {
  const resolution = { action: 'replace', evidence: { identity: 'corroborated',
    pointerSha256: 'a'.repeat(64), fileSha256: 'b'.repeat(64),
    pointerUrl: 'https://example.test/cms-hpt.txt', url: 'https://example.test/prices.csv' } };
  const retry = { pointer_corpus_sha256: 'a'.repeat(64),
    pointer_url: 'https://example.test/cms-hpt.txt', mrf_url: 'https://example.test/prices.csv',
    disposition: 'pointer-facility-match-unresolved' };
  assert.equal(sameResolvedPointerRetry(resolution, retry), true);
  assert.equal(sameResolvedPointerRetry(resolution, { ...retry, pointer_corpus_sha256: 'c'.repeat(64) }), false);
  assert.equal(sameResolvedPointerRetry(resolution, { ...retry, mrf_url: 'https://example.test/changed.csv' }), false);
  assert.equal(sameResolvedPointerRetry({ ...resolution, action: 'replace-observation' },
    { ...retry, disposition: 'pointer-linked-file-not-probed' }), true);
  assert.equal(sameResolvedPointerRetry(resolution,
    { ...retry, disposition: 'linked-mrf-header-unmatched' }), false,
  'a newly retrieved contradictory header is not an unchanged incomplete retry');
  assert.equal(sameResolvedPointerRetry({ ...resolution, evidence: { ...resolution.evidence, fileSha256: '' } }, retry), false);
  assert.equal(sameResolvedPointerRetry(resolution, retry, false), false);
});

test('a later page-file review timestamp supersedes an older retrieval observation', () => {
  const resolution = { action: 'replace-page-file-observation', reviewed_at: '2026-09-29T06:35:13Z',
    evidence: { checked_at: '2026-09-26T06:30:00Z' } };
  assert.equal(Date.parse(resolution.reviewed_at) > Date.parse('2026-09-26T05:15:00Z'), true);
  assert.equal(Date.parse(resolution.evidence.checked_at) > Date.parse('2026-09-26T05:15:00Z'), true);
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
  const nestedRecheck = { ...observation, observed_at: '2026-09-14T12:00:00Z',
    latest_recheck_action_observed_at: '2026-09-16T12:00:00Z' };
  assert.equal(laterManualObservationRequiresFollowUp(nestedRecheck, nationwideAt, null), true,
    'a newer nested recheck action must be compared by its surfaced recheck timestamp');
  assert.equal(laterManualObservationRequiresFollowUp({ ...nestedRecheck,
    latest_recheck_action_observed_at: '2026-09-14T12:00:00Z' }, nationwideAt, null), false);
});

test('incomplete newer checks retain stronger standing evidence without becoming unresolved', () => {
  for (const disposition of ['pointer-discovery-incomplete', 'pointer-not-retrieved',
    'pointer-access-denied-to-client', 'linked-mrf-header-unmatched',
    'mrf-facility-identity-unresolved', 'mrf-request-unsuccessful',
    'pointer-linked-file-not-probed']) {
    assert.equal(standingEvidenceRetained('compliant-observed', disposition), true);
  }
  assert.equal(standingEvidenceRetained('mrf-stale-over-365-days', 'pointer-discovery-incomplete'), true);
  assert.equal(standingEvidenceRetained('mrf-license-state-field-conflicts-facility', 'linked-mrf-header-unmatched'), true,
    'an incomplete retry must not erase the reviewed license-state conflict');
  for (const finding of ['mrf-facility-identity-unresolved', 'linked-mrf-header-unmatched',
    'pointer-facility-match-unresolved', 'pointer-linked-file-not-probed',
    'pointer-linked-file-review-pending', 'file-custom-workbook-review',
    'selected-file-only-in-earlier-pointer-version']) {
    assert.equal(standingEvidenceRetained(finding, 'mrf-request-unsuccessful'), true,
      `incomplete transport retry must retain ${finding}`);
  }
  assert.equal(standingEvidenceRetained('pointer-http-client-error-page-file-found', 'pointer-facility-match-unresolved'), true);
  assert.equal(standingEvidenceRetained('official-page-mrf-root-pointer-unavailable', 'pointer-not-retrieved'), true);
  assert.equal(standingEvidenceRetained('root-pointer-html-page-with-official-page-file', 'pointer-not-retrieved'), true);
  assert.equal(standingEvidenceRetained('root-pointer-html-page-with-official-page-file', 'verified-current-mrf'), false);
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

test('later transport failures retain explicit file-identity, metadata-conflict, and pointer-linkage findings', () => {
  for (const finding of ['mrf-facility-identity-unresolved', 'linked-mrf-header-unmatched',
    'mrf-license-state-field-conflicts-facility',
    'pointer-facility-match-unresolved', 'pointer-linked-file-not-probed',
    'pointer-linked-file-review-pending', 'file-custom-workbook-review',
    'selected-file-only-in-earlier-pointer-version']) {
    const row = { ccn: '009876', hospital_name: 'Example Hospital', city: 'Example', state: 'TN',
      finding, assessable: 'yes', checked_at: '2026-09-01T00:00:00Z',
      evidence: 'Retained exact pointer/header/workbook identity evidence.',
      mrf_url: 'https://example.test/exact-current-file' };
    const [result] = applyNationwideVerification([row], [{
      ccn: row.ccn, hospital_name: row.hospital_name, city: row.city, state: row.state,
      prior_finding: finding, disposition: 'mrf-request-unsuccessful',
      observed_at: '2026-09-02T00:00:00Z',
      standing_evidence_retained: standingEvidenceRetained(finding, 'mrf-request-unsuccessful'),
    }]);
    assert.deepEqual(result, row, `later transport failure must not erase ${finding}`);
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
