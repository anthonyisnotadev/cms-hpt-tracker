'use strict';

function resolutionObservedAt(resolution) {
  return resolution?.evidence?.checked_at || resolution?.reviewed_at || '';
}

function reviewedResolutionSupersedes(resolution, nationwideObservedAt, applied = true) {
  if (!applied || !resolution) return false;
  // A domain-only correction does not resolve the current pointer or file.
  if (resolution.action === 'correct-site' || resolution.action === 'scope-review-pending') return false;
  const reviewed = Date.parse(resolutionObservedAt(resolution));
  // An undated generated coverage gap cannot outrank an applied, dated review.
  // This commonly occurs immediately after a resolution changes the standing
  // row and the broad corpus has not yet incorporated its exact target.
  if (!nationwideObservedAt) return Number.isFinite(reviewed);
  const observed = Date.parse(nationwideObservedAt);
  return Number.isFinite(reviewed) && Number.isFinite(observed) && reviewed >= observed;
}

// A resolution that cites the exact pointer bytes, file URL/hash, identity
// review and observation timestamp adjudicates that observation; it does not
// supersede itself merely because timestamps have second-level precision.
function reviewedResolutionIsSameObservation(resolution, observation, manualObservation, applied = true) {
  const evidence = resolution?.evidence;
  return Boolean(applied
    && ['replace', 'replace-observation'].includes(resolution?.action)
    && evidence?.identity === 'corroborated'
    && evidence.checked_at
    && evidence.checked_at === observation?.observed_at
    && evidence.pointerSha256 === observation?.pointer_corpus_sha256
    && evidence.url === observation?.mrf_url
    && /^[a-f0-9]{64}$/i.test(String(evidence.fileSha256 || ''))
    && evidence.fileSha256 === manualObservation?.file_sha256
    && manualObservation?.manual_identity_gate === 'current-root-pointer-exact-file-full-bytes-header-name-address-state-date-attestation-agree');
}

// A later pointer fetch can be a real refresh yet still contain no new
// evidence. If an applied, identity-correlated review already binds the same
// pointer bytes to the same MRF URL and a file hash, an incomplete parser retry
// of that exact pair must not reopen or erase the reviewed disposition.
function sameResolvedPointerRetry(resolution, observation, applied = true) {
  const evidence = resolution?.evidence;
  const nonContradictoryRetry = new Set([
    'pointer-facility-match-unresolved',
    'pointer-linked-file-not-probed',
    'pointer-linked-file-review-pending',
    'pointer-discovery-incomplete',
    'pointer-not-retrieved',
    'mrf-request-unsuccessful'
  ]).has(String(observation?.disposition || ''));
  return Boolean(applied && ['replace', 'replace-observation'].includes(resolution?.action)
    && nonContradictoryRetry
    && evidence?.identity === 'corroborated'
    && /^[a-f0-9]{64}$/i.test(String(evidence.fileSha256 || ''))
    && /^[a-f0-9]{64}$/i.test(String(evidence.pointerSha256 || ''))
    && evidence.pointerSha256 === observation?.pointer_corpus_sha256
    && evidence.pointerUrl === observation?.pointer_url
    && evidence.url === observation?.mrf_url);
}

function laterManualObservationRequiresFollowUp(observation, nationwideObservedAt, resolution, applied = true) {
  if (!observation?.disposition || !observation.next_action) return false;
  // latestManualObservation() preserves the source row's original timestamp
  // while surfacing a newer nested recheck action. Compare the nested event
  // timestamp when present, or reconciliation can incorrectly prefer a
  // generic older action over the actual current follow-up.
  const manualTime = Date.parse(observation.latest_recheck_action_observed_at || observation.observed_at);
  const nationwideTime = Date.parse(nationwideObservedAt);
  const resolutionTime = applied && resolution ? Date.parse(resolutionObservedAt(resolution)) : NaN;
  return Number.isFinite(manualTime)
    && (!Number.isFinite(nationwideTime) || manualTime > nationwideTime)
    && (!Number.isFinite(resolutionTime) || manualTime > resolutionTime);
}

const STRONG_STANDING_FINDINGS = new Set([
  'compliant-observed', 'compliant-date-unverified', 'mrf-stale-over-365-days',
  'old-template-version', 'mrf-facility-identity-unresolved',
  'linked-mrf-header-unmatched', 'pointer-facility-match-unresolved',
  'pointer-linked-file-not-probed', 'pointer-linked-file-review-pending',
  'file-custom-workbook-review', 'selected-file-only-in-earlier-pointer-version',
  'mrf-license-state-field-conflicts-facility',
  'mrf-address-field-conflicts-facility', 'mrf-template-version-noncanonical',
  'mrf-v3-file-validation-pending',
  'mrf-custom-workbook-metadata-unverified',
  'pricing-page-links-older-mrf-than-pointer',
  'pointer-http-client-error-page-file-found',
  'official-page-mrf-root-pointer-unavailable',
  'root-pointer-html-page-with-official-page-file',
  'root-pointer-omits-facility-page-file-found',
  'pointer-links-older-mrf-than-source-page',
  'pointer-links-different-facility-mrf-source-page-file',
  'pointer-links-unavailable-mrf-source-page-current-file',
  'pointer-html-portal-not-found-source-page-current-file',
  'pointer-file-url-renders-not-found-source-page-current-file',
  'pointer-target-google-sheet-page-file-found',
  'not-applicable-federal', 'not-applicable-indian-health-program', 'not-applicable-closed'
]);

// An incomplete or unresolved retry is a current operational observation, but
// it is not contrary evidence. Keep it visible without counting it as though it
// erased an independently supported standing finding. Explicit verified or
// scope dispositions are handled normally because they assert a new result.
function standingEvidenceRetained(priorFinding, disposition) {
  return STRONG_STANDING_FINDINGS.has(String(priorFinding || ''))
    && !/^verified-|^scope-exempt/.test(String(disposition || ''));
}

// Dispositions where the newer observation says nothing about the facility or
// file itself: the client could not reach or finish reading the source.
const ACCESS_ONLY_DISPOSITIONS = new Set([
  'mrf-request-unsuccessful', 'pointer-access-denied-to-client', 'pointer-discovery-incomplete'
]);

// A retained finding is an "access retry" only when the newer observation is
// transport-only and nothing else (identity, reviewed follow-up, manual
// recheck) keeps the row open. Every other retained row needs a person to
// weigh contrary or ambiguous evidence.
function standingFollowUpKind(row) {
  const issues = row?.issues || [];
  return issues.length === 1
    && issues[0] === 'standing-evidence-retained-review-new-observation'
    && ACCESS_ONLY_DISPOSITIONS.has(String(row.proposed_disposition || ''))
    ? 'access-retry' : 'evidence-review';
}

function isSupportedIdentityUncertainty(resolution) {
  const proof = resolution?.proof;
  return resolution?.action === 'quarantine' && Boolean(proof?.pointer_sha256 && proof?.payload_sha256
    && proof?.observed_hospital_name && proof?.observed_address);
}

function isSupportedBrowserAddressConflict(observation, proposal, browserReview) {
  return observation?.disposition === 'current-file-address-conflicts-official-facility-address'
    && observation.ccn === proposal?.ccn
    && observation.mrf_url === proposal?.mrf_url
    && observation.mrf_url === browserReview?.target
    && observation.browser_observed_at === browserReview?.observed_at
    && browserReview?.status === 'retrieved'
    && observation.declared_file_address === browserReview?.declared_address
    && proposal?.browser_identity_gate === 'file-address-reconciliation-required'
    && Boolean(observation.pointer_sha256 && observation.source_page_url && observation.facility_page_url
      && observation.declared_file_address && observation.official_facility_address && observation.roster_address);
}

function isSupportedAutomatedChallenge(observation, standing, proposal) {
  const observed = Date.parse(observation?.observed_at);
  const latest = Date.parse(proposal?.observed_at);
  return observation?.ccn === standing?.ccn
    && observation.pointer_url === standing?.pointer_url
    && observation.pointer_mrf_url === standing?.mrf_url
    && observation.prior_finding === standing?.finding
    && observation.disposition === 'automated-client-received-html-captcha-not-file-verdict'
    && observation.http_status === 200
    && /text\/html/i.test(observation.content_type || '')
    && observation.html_title === 'Radware Captcha Page'
    && /^[a-f0-9]{64}$/.test(observation.response_sha256 || '')
    && Number.isFinite(observed) && Number.isFinite(latest) && observed > latest;
}

function addressObservationRequiresAction(observation, proposal, resolution) {
  if (!observation) return false;
  if (proposal?.browser_identity_gate === 'reviewed-file-address-equivalence') return false;
  if (resolution?.action === 'replace' && resolution?.evidence?.rosterAddressException) return false;
  return /unresolved|pending/i.test(String(observation.status || ''));
}

function historicalChanges(current, prior) {
  const changes = [];
  if (current?.mrf_url !== prior?.mrf_url) changes.push('file-url-changed');
  if (current?.mrf_last_updated !== prior?.mrf_last_updated) changes.push('declared-date-changed');
  return changes;
}

function reconciliationWorkstream(issues, supportedIdentityUncertainty = false, supportedBrowserAddressConflict = false) {
  if (issues.includes('publisher-template-version-correction-pending')) return 'genuinely-unresolved-investigation';
  if (supportedIdentityUncertainty || supportedBrowserAddressConflict) return 'supported-uncertainty-monitor';
  if (issues.includes('quarantined-identity')) return 'identity-quarantine';
  if (issues.includes('latest-check-unresolved')) return 'genuinely-unresolved-investigation';
  if (issues.includes('verification-file-byte-proof-audit-pending')) return 'verification-proof-gap';
  if (issues.includes('standing-evidence-retained-review-new-observation')) return 'standing-evidence-follow-up';
  if (issues.includes('reviewed-pointer-target-client-follow-up')) return 'standing-evidence-follow-up';
  if (issues.includes('reviewed-html-root-pointer-follow-up')) return 'standing-evidence-follow-up';
  if (issues.includes('reviewed-pointer-or-page-linkage-follow-up')) return 'standing-evidence-follow-up';
  if (issues.includes('official-page-file-corroborated-root-pointer-pending')) return 'standing-evidence-follow-up';
  // A retained byte-proof can close the retrieval gate while leaving the
  // browser/header identity or pointer provenance gate open. Keep that
  // residual work in the standing-evidence queue instead of generic drift.
  if (issues.includes('browser-file-identity-proof-insufficient')) return 'standing-evidence-follow-up';
  if (issues.includes('later-manual-observation-follow-up')) return 'standing-evidence-follow-up';
  // A verified claim whose retained file street cannot yet be reconciled to
  // the CMS roster is a dated standing follow-up, not an unclassified
  // "other" discrepancy. Keep the current file identity while surfacing the
  // exact address gate for review.
  if (issues.includes('verified-summary-street-needs-reconciliation')) return 'standing-evidence-follow-up';
  // A verified file with an explicit license-state conflict remains a
  // standing publisher-metadata follow-up. Keep the conflict visible and
  // actionable instead of allowing it to fall into an untracked discrepancy
  // stream when byte proof is later backfilled.
  if (issues.includes('verified-summary-license-state-conflict')) return 'standing-evidence-follow-up';
  if (issues.includes('verified-template-version-unobserved-follow-up')) return 'standing-evidence-follow-up';
  if (issues.some(issue => /^verified-summary-missing-(file-address|state-evidence)$/.test(issue))) return 'standing-evidence-follow-up';
  if (issues.includes('proposed-finding-differs-from-standing')) return 'standing-finding-discrepancy';
  return issues.length ? 'other-reconciliation' : 'consistent';
}

function dispositionNextAction(issues, disposition) {
  return issues.length ? disposition?.next_action || '' : '';
}

function reconciliationStatus(issues, proofAudit, supportedIdentityUncertainty = false,
  supportedBrowserAddressConflict = false, latestSuperseded = false) {
  if (supportedIdentityUncertainty) return 'supported-identity-uncertainty';
  if (supportedBrowserAddressConflict) return 'supported-current-file-address-conflict';
  if (issues.length) return 'review-required';
  if (proofAudit?.status === 'proof-audit-complete') return 'consistent-proof-audited';
  if (latestSuperseded || proofAudit?.status === 'superseded-by-reviewed-resolution') return 'consistent-superseded-by-reviewed-resolution';
  return 'consistent-summary-proof-audit-pending';
}

module.exports = { addressObservationRequiresAction, dispositionNextAction, historicalChanges, isSupportedBrowserAddressConflict,
  isSupportedAutomatedChallenge, isSupportedIdentityUncertainty, laterManualObservationRequiresFollowUp,
  reconciliationStatus, reconciliationWorkstream, resolutionObservedAt, reviewedResolutionIsSameObservation, reviewedResolutionSupersedes,
  sameResolvedPointerRetry, standingEvidenceRetained, standingFollowUpKind };
