'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadReviewedView } = require('./lib/reviewed-resolutions');
const { effectiveVerifiedFinding, finding } = require('./lib/nationwide-verification-view');
const { verificationStateEvidence } = require('./lib/verification-state-evidence');
const { extractDeclared, toISODate } = require('./lib/probe');
const { strongAddressAgreement, corroboratedAddressAgreement } = require('./lib/mrf-header-match');
const root = path.resolve(__dirname, '../..');
const dir = path.join(root, 'data/hpt-audit');
const before = loadReviewedView(dir, { nationwide: false });
const after = loadReviewedView(dir);
const prior = new Map(before.compliance.map(r => [r.ccn, r]));
const proposals = new Map(after.nationwide.records.map(r => [r.ccn, r]));
const manual = JSON.parse(fs.readFileSync(path.join(root, 'cms_data/outreach.public.json'), 'utf8'));
let manualReviews;
const roster = new Map(JSON.parse(fs.readFileSync(path.join(root, 'cms_data/hpt/roster.json'), 'utf8')).map(r => [r.ccn, r]));
const addressObservations = new Map(JSON.parse(fs.readFileSync(path.join(dir, 'reconciliation-address-observations.json'), 'utf8')).records.map(r => [r.ccn, r]));
const reviewedHeaderDispositions = new Map(JSON.parse(fs.readFileSync(path.join(dir, 'reconciliation-reviewed-header-dispositions.json'), 'utf8')).records.map(r => [r.ccn, r]));
const cmsEnrollmentSnapshotPath = path.join(dir, 'priority-one-cms-enrollment-snapshot-review.json');
const cmsEnrollmentSnapshot = JSON.parse(fs.readFileSync(cmsEnrollmentSnapshotPath, 'utf8'));
if (!cmsEnrollmentSnapshot.records.length
  || new Set(cmsEnrollmentSnapshot.records.map(record => record.ccn)).size !== cmsEnrollmentSnapshot.records.length)
  throw new Error('Priority-one CMS enrollment review must contain unique CCNs');
const cmsEnrollmentByCcn = new Map(cmsEnrollmentSnapshot.records.map(record => [record.ccn, record]));
const proofPath = path.join(dir, 'nationwide-source-proof-audit.json');
const proofAudits = new Map((fs.existsSync(proofPath) ? JSON.parse(fs.readFileSync(proofPath, 'utf8')).records : []).map(r => [r.ccn, r]));
const challengePath = path.join(dir, 'reconciliation-geisinger-challenge-observations.json');
const challengeProof = fs.existsSync(challengePath) ? JSON.parse(fs.readFileSync(challengePath, 'utf8')) : null;
if (challengeProof) {
  const pointerSample = fs.readFileSync(path.join(root, challengeProof.pointer_sample));
  const digest = crypto.createHash('sha256').update(pointerSample).digest('hex');
  if (digest !== challengeProof.pointer_sha256) throw new Error('Geisinger challenge pointer proof hash changed');
}
const challengeObservations = new Map((challengeProof?.observations || []).map(record => [record.ccn, record]));
const archiveReviews = new Map(JSON.parse(fs.readFileSync(path.join(dir, 'reconciliation-archive-browser-observations.json'), 'utf8')).records
  .flatMap(record => record.ccns.map(ccn => [ccn, record])));
const archiveContentPath = path.join(dir, 'reconciliation-archive-content-proof.json');
const archiveContent = new Map((fs.existsSync(archiveContentPath)
  ? JSON.parse(fs.readFileSync(archiveContentPath, 'utf8')).records : []).map(record => [record.ccn, record]));
const officialPageFileArtifact = JSON.parse(fs.readFileSync(path.join(dir, 'reconciliation-official-page-file-observations.json'), 'utf8'));
const officialPageFiles = new Map(officialPageFileArtifact.records.map(record => [record.ccn, record]));
const browserAddressConflictPath = path.join(dir, 'reconciliation-browser-file-address-conflicts.json');
const browserAddressConflicts = new Map((fs.existsSync(browserAddressConflictPath)
  ? JSON.parse(fs.readFileSync(browserAddressConflictPath, 'utf8')).records : []).map(record => [record.ccn, record]));
const browserMrfReviews = new Map(JSON.parse(fs.readFileSync(path.join(dir, 'nationwide-browser-reviews.json'), 'utf8')).records
  .filter(record => record.kind === 'mrf').map(record => [record.target, record]));
const browserByteProofRetries = new Map(JSON.parse(fs.readFileSync(path.join(dir, 'reconciliation-browser-byte-proof-retries.json'), 'utf8')).records.map(record => [record.ccn, record]));
const smallArchiveDispositions = new Map(JSON.parse(fs.readFileSync(path.join(dir, 'reconciliation-small-archive-dispositions.json'), 'utf8')).records.map(record => [record.ccn, record]));
const troyPointerMismatchPath = path.join(dir, 'reconciliation-troy-pointer-mismatch-proof.json');
const REVIEWED_POINTER_FOLLOWUP_FINDINGS = new Set([
  'pointer-lists-no-mrf-url',
  'pointer-links-older-mrf-than-source-page',
  'pointer-links-different-facility-mrf-source-page-file',
  'pointer-links-unavailable-mrf-source-page-current-file',
  'pointer-target-dns-unresolved-page-file-found',
  'pointer-links-html-download-page-with-file',
  'pointer-html-portal-not-found-source-page-current-file',
  'pointer-file-url-renders-not-found-source-page-current-file',
  'pointer-target-google-sheet-page-file-found',
  'official-page-mrf-root-pointer-unavailable',
  'root-pointer-omits-facility-page-file-found',
  'pricing-page-links-older-mrf-than-pointer'
]);
function reviewedPointerFollowUpAction(finding) {
  if (finding === 'official-page-mrf-root-pointer-unavailable')
    return 'Retrieve structured root pointer bytes through a permitted client or publisher copy, then test whether its exact MRF target is the facility-specific file linked on the first-party page; access failure is not file absence.';
  if (finding === 'root-pointer-omits-facility-page-file-found')
    return 'Ask the publisher to add an exact facility entry to the root pointer; then recheck its MRF target against the separately observed first-party page file.';
  if (finding === 'pointer-lists-no-mrf-url')
    return 'Ask the publisher to supply a correctly labeled mrf-url in the facility pointer entry; then retrieve that exact target and verify facility identity and metadata.';
  if (finding === 'pointer-target-google-sheet-page-file-found')
    return 'Ask the publisher to replace the Google Sheets edit-page target with a direct CSV/JSON MRF or document an official export chain to the separately verified page-linked file; then recheck pointer linkage and facility metadata without inferring rate-level validity or compliance.';
  if (finding === 'pointer-links-older-mrf-than-source-page' || finding === 'pricing-page-links-older-mrf-than-pointer')
    return 'Reconcile the differing pointer and pricing-page file versions with the publisher, then recheck both exact URLs, declared dates and facility identity.';
  if (finding === 'pointer-links-different-facility-mrf-source-page-file')
    return 'Ask the publisher to correct the pointer target for this facility; do not inherit the different-campus file. Recheck the exact target and header after a change.';
  return 'Recheck the exact pointer target after the publisher repairs its unavailable, indirect or malformed file link; compare it with the first-party page file and verify facility identity and metadata without inferring compliance from client access errors.';
}
const troyPointerMismatch = fs.existsSync(troyPointerMismatchPath)
  ? JSON.parse(fs.readFileSync(troyPointerMismatchPath, 'utf8')) : null;
const uhsDirectFilePath = path.join(dir, 'reconciliation-uhs-direct-file-proof.json');
const uhsDirectFiles = new Map((fs.existsSync(uhsDirectFilePath)
  ? JSON.parse(fs.readFileSync(uhsDirectFilePath, 'utf8')).records : []).map(record => [record.ccn, record]));
const manualAccessPath = path.join(dir, 'reconciliation-manual-access-observations.json');
const omhCohortPath = path.join(dir, 'reconciliation-omh-unreviewed-cohort-proof.json');
const omhCohort = JSON.parse(fs.readFileSync(omhCohortPath, 'utf8'));
if (omhCohort.records.length !== 14 || new Set(omhCohort.records.map(record => record.ccn)).size !== 14
  || crypto.createHash('sha256').update(fs.readFileSync(path.join(root, omhCohort.directory_retained_file))).digest('hex') !== omhCohort.directory_sha256
  || omhCohort.records.some(record => record.pointer_sha256 !== omhCohort.pointer_sha256
    || record.shared_file_sha256 !== omhCohort.shared_file_sha256))
  throw new Error('OMH cohort review proof changed');
const hhHealthPageLinksPath = path.join(dir, 'reconciliation-hh-health-official-page-links.json');
const communityTallasseePath = path.join(dir, 'reconciliation-community-tallassee-file-observation.json');
const greeneCountyPath = path.join(dir, 'reconciliation-greene-county-file-observation.json');
const manualAccessObservations = new Map([
  ...(fs.existsSync(manualAccessPath) ? JSON.parse(fs.readFileSync(manualAccessPath, 'utf8')).records : []),
  ...omhCohort.records,
  ...(fs.existsSync(hhHealthPageLinksPath) ? JSON.parse(fs.readFileSync(hhHealthPageLinksPath, 'utf8')).records : []),
  ...(fs.existsSync(communityTallasseePath) ? [JSON.parse(fs.readFileSync(communityTallasseePath, 'utf8'))] : []),
  ...(fs.existsSync(greeneCountyPath) ? [JSON.parse(fs.readFileSync(greeneCountyPath, 'utf8'))] : []),
].map(record => [record.ccn, record]));
const bethIsraelProof = JSON.parse(fs.readFileSync(path.join(dir, 'reconciliation-beth-israel-campus-status-proof.json'), 'utf8'));
const bethIsraelManual = manualAccessObservations.get(bethIsraelProof.ccn);
const bethIsraelPointer = fs.readFileSync(path.join(root, 'cms_data/hpt/pointer-corpus/raw/mountsinai.org-51a980dd173b.txt'), 'utf8');
if (bethIsraelProof.ccn !== '330169'
  || bethIsraelManual?.proof_file !== 'reconciliation-beth-israel-campus-status-proof.json'
  || bethIsraelManual.observed_at !== bethIsraelProof.observed_at
  || bethIsraelManual.pointer_sha256 !== bethIsraelProof.retained_pointer_sha256
  || bethIsraelManual.next_action !== bethIsraelProof.next_action
  || crypto.createHash('sha256').update(bethIsraelPointer).digest('hex') !== bethIsraelProof.retained_pointer_sha256
  || (bethIsraelPointer.match(/^location-name:/gm) || []).length !== bethIsraelProof.retained_pointer_location_count
  || /^location-name:.*(?:beth israel|downtown)/im.test(bethIsraelPointer))
  throw new Error('Beth Israel campus-status proof changed');
const herefordProof = JSON.parse(fs.readFileSync(path.join(dir, 'reconciliation-hereford-two-file-proof.json'), 'utf8'));
const herefordManual = manualAccessObservations.get(herefordProof.ccn);
const herefordPointer = fs.readFileSync(path.join(root, 'cms_data/hpt/pointer-corpus/raw/dschd.org-5c4e2db86eed.txt'), 'utf8');
if (herefordProof.ccn !== '450155'
  || herefordManual?.proof_file !== 'reconciliation-hereford-two-file-proof.json'
  || herefordManual.observed_at !== herefordProof.observed_at
  || herefordManual.pointer_sha256 !== herefordProof.pointer_sha256
  || herefordManual.next_action !== herefordProof.next_action
  || crypto.createHash('sha256').update(herefordPointer).digest('hex') !== herefordProof.pointer_sha256
  || !herefordPointer.includes(`location-name: ${herefordProof.pointer_location_name}`)
  || !herefordPointer.includes(`url: ${herefordProof.pointer_url_field_file_url}`)
  || /^mrf-url:/im.test(herefordPointer))
  throw new Error('Hereford two-file proof changed');
const scenicProof = JSON.parse(fs.readFileSync(path.join(dir, 'reconciliation-scenic-mountain-operator-transition-proof.json'), 'utf8'));
const scenicManual = manualAccessObservations.get(scenicProof.ccn);
const scenicPointer = fs.readFileSync(path.join(root, 'cms_data/hpt/pointer-corpus/raw/shannonhealth.com-01421c86970f.txt'), 'utf8');
const scenicPointerEntry = scenicPointer.split(/(?=^location-name:)/m)
  .find(entry => entry.startsWith(`location-name: ${scenicProof.current_pointer_location_name}`));
if (scenicProof.ccn !== '450653'
  || scenicManual?.proof_file !== 'reconciliation-scenic-mountain-operator-transition-proof.json'
  || scenicManual.observed_at !== scenicProof.observed_at
  || scenicManual.pointer_sha256 !== scenicProof.current_pointer_sha256
  || scenicManual.pointer_mrf_url !== scenicProof.current_pointer_file_url
  || scenicManual.next_action !== scenicProof.next_action
  || crypto.createHash('sha256').update(scenicPointer).digest('hex') !== scenicProof.current_pointer_sha256
  || !scenicPointerEntry?.includes(`mrf-url: ${scenicProof.current_pointer_file_url}`)
  || scenicProof.complete_file_validated !== false)
  throw new Error('Scenic Mountain operator-transition proof changed');
const southeasternProof = JSON.parse(fs.readFileSync(path.join(dir, 'reconciliation-unc-southeastern-alias-access-proof.json'), 'utf8'));
const southeasternManual = manualAccessObservations.get(southeasternProof.ccn);
const southeasternPointer = fs.readFileSync(path.join(root, 'cms_data/hpt/pointer-corpus/raw/unchealth.org-94610d032f4c.txt'), 'utf8');
const southeasternPointerEntry = southeasternPointer.split(/(?=^location-name:)/m)
  .find(entry => entry.startsWith(`location-name: ${southeasternProof.pointer_location_name}`));
const southeasternTarget = southeasternPointerEntry?.match(/^mrf-url:\s*(.+)$/m)?.[1]?.trim();
if (southeasternProof.ccn !== '340050'
  || southeasternManual?.proof_file !== 'reconciliation-unc-southeastern-alias-access-proof.json'
  || southeasternManual.observed_at !== southeasternProof.observed_at
  || southeasternManual.pointer_sha256 !== southeasternProof.retained_pointer_sha256
  || southeasternManual.pointer_mrf_url_sha256 !== southeasternProof.pointer_mrf_url_sha256
  || southeasternManual.page_file_url !== southeasternProof.official_pricing_page_file_url
  || southeasternManual.next_action !== southeasternProof.next_action
  || crypto.createHash('sha256').update(southeasternPointer).digest('hex') !== southeasternProof.retained_pointer_sha256
  || !southeasternTarget
  || crypto.createHash('sha256').update(southeasternTarget).digest('hex') !== southeasternProof.pointer_mrf_url_sha256
  || !southeasternProof.pointer_mrf_query_withheld
  || southeasternProof.file_metadata_verified !== false)
  throw new Error('UNC Southeastern alias/access proof changed');
const riversideDateProof = JSON.parse(fs.readFileSync(path.join(dir, 'reconciliation-riverside-manual-date-proof.json'), 'utf8'));
const riversideSample = fs.readFileSync(path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof',
  `${riversideDateProof.retained_sample_sha256}.bin`));
const riversideDigest = crypto.createHash('sha256').update(riversideSample).digest('hex');
const riversideParsed = extractDeclared(riversideSample, 'csv');
const riversideSource = JSON.parse(fs.readFileSync(path.join(dir, 'nationwide-file-byte-proof.json'), 'utf8')).records
  .find(record => record.url === riversideDateProof.mrf_url && record.ccns.includes(riversideDateProof.ccn));
const riversideRoster = roster.get(riversideDateProof.ccn);
const riversideStanding = after.compliance.find(record => record.ccn === riversideDateProof.ccn);
const riversideManual = manual[riversideDateProof.ccn]?.correction;
if (riversideDigest !== riversideDateProof.retained_sample_sha256
  || riversideSample.length !== riversideDateProof.retained_sample_bytes
  || riversideSource?.sha256 !== riversideDigest || riversideSource.http_status !== riversideDateProof.sample_http_status
  || riversideSource.checked_at !== riversideDateProof.observed_at
  || toISODate(riversideParsed.raw) !== riversideDateProof.later_declared_date
  || riversideParsed.version !== riversideDateProof.later_declared_version
  || riversideParsed.hospitalName !== riversideDateProof.later_declared_hospital_name
  || riversideParsed.address !== riversideDateProof.later_declared_address
  || riversideParsed.licenseState !== riversideDateProof.later_declared_license_state
  || !strongAddressAgreement(riversideRoster?.address, riversideParsed.address)
  || riversideRoster.state !== riversideParsed.licenseState
  || riversideStanding?.mrf_url !== riversideDateProof.mrf_url
  || riversideStanding.mrf_last_updated !== riversideDateProof.later_declared_date
  || riversideManual?.mrfUrl !== riversideDateProof.mrf_url
  || riversideManual.lastUpdatedOn !== riversideDateProof.manual_date
  || riversideManual.checkedOn !== riversideDateProof.manual_checked_at)
  throw new Error('Riverside later-file manual-date proof changed');
manualAccessObservations.set(riversideDateProof.ccn, riversideDateProof);
const supportedManualUncertainties = [
  ...[...uhsDirectFiles.values()].map(record => ({ ...record,
    disposition: 'direct-file-identity-corroborated-pointer-linkage-pending',
    next_action: 'Retrieve an exact first-party pointer or pricing-page link for this identity-matched file before promotion; do not repeat the file read unless its URL or bytes change.' })),
  ...[...officialPageFiles.values()].map(record => ({ ...record, observed_at: `${record.observed_on}T23:59:59Z`,
    disposition: 'official-page-file-corroborated-root-pointer-pending',
    next_action: record.next_action || officialPageFileArtifact.next_action }))
];
const chambersProofPath = path.join(dir, 'reconciliation-chambers-proof.json');
if (fs.existsSync(chambersProofPath)) {
  const record = JSON.parse(fs.readFileSync(chambersProofPath, 'utf8'));
  supportedManualUncertainties.push({ ccn: record.ccn, observed_at: record.observed_at,
    disposition: record.disposition, next_action: record.next_action });
}
const resolutions = JSON.parse(fs.readFileSync(path.join(dir, 'reviewed-resolutions.json'), 'utf8'));
const appliedResolutionCcns = new Set(after.applied || []);
manualReviews = require('./lib/manual-reconciliation').reconcileManual(after.compliance, manual,
  [...manualAccessObservations.values(), ...supportedManualUncertainties],
  resolutions.filter(record => appliedResolutionCcns.has(record.ccn)));
const manualByCcn = new Map(manualReviews.map(r => [r.ccn, r]));
const { addressObservationRequiresAction, dispositionNextAction, historicalChanges, isSupportedBrowserAddressConflict,
  isSupportedAutomatedChallenge, isSupportedIdentityUncertainty, laterManualObservationRequiresFollowUp,
  reconciliationStatus, reconciliationWorkstream, resolutionObservedAt, reviewedResolutionSupersedes,
  standingEvidenceRetained } = require('./lib/reconciliation-precedence');
const resolutionByCcn = new Map(resolutions.map(record => [record.ccn, record]));
const appliedResolutions = new Set(before.applied || []);
const records = after.compliance.map(row => {
  const old = prior.get(row.ccn), proposed = proposals.get(row.ccn);
  const desired = proposed && (effectiveVerifiedFinding(proposed) || finding(proposed.disposition));
  const issues = [];
  const changes = historicalChanges(row, old);
  const resolution = resolutionByCcn.get(row.ccn);
  const siteCorrectionPending = appliedResolutions.has(row.ccn) && resolution?.action === 'correct-site';
  const latestSuperseded = reviewedResolutionSupersedes(resolution, proposed?.observed_at, appliedResolutions.has(row.ccn));
  // A later transport-only retry may replace the presentation row with a
  // weaker unresolved observation. Preserve the prior reviewed finding as
  // standing evidence unless a dated resolution actually supersedes it.
  const standingRetained = !latestSuperseded
    && (standingEvidenceRetained(row.finding, proposed?.disposition)
      || standingEvidenceRetained(old.finding, proposed?.disposition)
      || standingEvidenceRetained(proposed?.prior_finding, proposed?.disposition));
  const supportedIdentityUncertainty = isSupportedIdentityUncertainty(resolution);
  const proofAudit = proofAudits.get(row.ccn);
  const browserByteProofRetry = browserByteProofRetries.get(row.ccn);
  const smallArchiveDisposition = smallArchiveDispositions.get(row.ccn);
  const currentPagePointerMismatch = troyPointerMismatch?.ccn === row.ccn ? troyPointerMismatch : null;
  const archiveReview = archiveReviews.get(row.ccn);
  const officialPageFile = officialPageFiles.get(row.ccn);
  const browserAddressConflict = browserAddressConflicts.get(row.ccn);
  const uhsDirectFile = uhsDirectFiles.get(row.ccn);
  const manualAccessObservation = manualAccessObservations.get(row.ccn);
  const laterManualFollowUp = laterManualObservationRequiresFollowUp(manualAccessObservation,
    proposed?.observed_at, resolution, appliedResolutions.has(row.ccn))
    && !(manualAccessObservation?.disposition === 'same-url-later-hash-bound-file-date-supersedes-manual-date'
      && manualByCcn.get(row.ccn)?.disposition === 'superseded-by-later-file-evidence');
  const candidateChallenge = challengeObservations.get(row.ccn);
  const automatedChallenge = isSupportedAutomatedChallenge(candidateChallenge, row, proposed) ? candidateChallenge : null;
  const supportedBrowserAddressConflict = isSupportedBrowserAddressConflict(browserAddressConflict, proposed,
    browserMrfReviews.get(browserAddressConflict?.mrf_url));
  if (officialPageFile && !latestSuperseded) issues.push('official-page-file-corroborated-root-pointer-pending');
  if (uhsDirectFile) issues.push('direct-file-identity-corroborated-pointer-linkage-pending');
  if (archiveReview && !archiveContent.has(row.ccn)) issues.push('official-archive-linkage-content-audit-pending');
  if (proofAudit?.issues.some(issue => issue.startsWith('source-field-disagreement:'))) issues.push('verification-source-field-disagreement');
  if (!latestSuperseded && proofAudit?.issues.some(issue => ['file-byte-proof-not-in-parsed-cache', 'browser-byte-proof-audit-required'].includes(issue)))
    issues.push('verification-file-byte-proof-audit-pending');
  const addressObservation = addressObservations.get(row.ccn);
  const reviewedHeaderDisposition = reviewedHeaderDispositions.get(row.ccn);
  if (addressObservationRequiresAction(addressObservation, proposed, resolution)) issues.push('documented-campus-address-reconciliation');
  if (!proposed) issues.push('nationwide-record-missing');
  if (!latestSuperseded && proposed?.browser_identity_gate && !['recorded-file-name-street-state-agree', 'reviewed-file-address-equivalence'].includes(proposed.browser_identity_gate)) issues.push('browser-file-identity-proof-insufficient');
  if (old.finding === 'not-assessed-identity-conflict') issues.push('quarantined-identity');
  if (standingRetained) issues.push('standing-evidence-retained-review-new-observation');
  if (appliedResolutions.has(row.ccn) && resolution?.action === 'replace-observation'
      && row.finding === 'pointer-http-client-error-page-file-found')
    issues.push('reviewed-pointer-target-client-follow-up');
  if (appliedResolutions.has(row.ccn) && resolution?.action === 'replace-observation'
      && row.finding === 'root-pointer-html-page-with-official-page-file')
    issues.push('reviewed-html-root-pointer-follow-up');
  if (appliedResolutions.has(row.ccn) && resolution?.action === 'replace-observation'
      && REVIEWED_POINTER_FOLLOWUP_FINDINGS.has(row.finding))
    issues.push('reviewed-pointer-or-page-linkage-follow-up');
  if (automatedChallenge) issues.push('automated-client-html-challenge');
  // A reproducible quarantine is the supported disposition for a conflicting
  // candidate, so its deliberately different proposed finding is not a second
  // standing-finding discrepancy. Keep the candidate and unresolved issue.
  if (!siteCorrectionPending && !supportedIdentityUncertainty && !latestSuperseded && !standingRetained && desired && desired !== row.finding)
    issues.push('proposed-finding-differs-from-standing');
  if (manualByCcn.get(row.ccn)?.disposition === 'evidence-review-required') issues.push('manual-correction-reconciliation');
  if (!latestSuperseded && proposed?.disposition.startsWith('verified-')) {
    const facility = roster.get(row.ccn);
    if (!proposed.declared_address) issues.push('verified-summary-missing-file-address');
    else if (facility && proposed.browser_identity_gate !== 'reviewed-file-address-equivalence'
      && !String(proposed.declared_address).split('|').some(address => strongAddressAgreement(facility.address, address))
      && !(proposed.header_identity_gate === 'exact-pointer-ccn-file-corroborated-street-city-zip-license-state-agree'
        && proposed.declared_license_state === facility.state
        && String(proposed.declared_address).split('|').some(address => corroboratedAddressAgreement(facility.address, address))))
      issues.push('verified-summary-street-needs-reconciliation');
    const stateEvidence = verificationStateEvidence(proposed.declared_license_state, row.state,
      proposed.header_identity_gate || proposed.browser_identity_gate);
    if (stateEvidence.status === 'missing') issues.push('verified-summary-missing-state-evidence');
    else if (stateEvidence.status === 'conflict') issues.push('verified-summary-license-state-conflict');
  }
  if (!latestSuperseded && !standingRetained && proposed && !/^verified-|^scope-exempt/.test(proposed.disposition)) issues.push('latest-check-unresolved');
  // Existing discrepancies already put the CCN in a work queue. Add a new
  // follow-up only when this later manual review would otherwise be hidden.
  if (laterManualFollowUp && issues.length === 0) issues.push('later-manual-observation-follow-up');
  const workstream = reconciliationWorkstream(issues, supportedIdentityUncertainty, supportedBrowserAddressConflict);
  const record = { ccn: row.ccn, hospital_name: row.hospital_name, state: row.state,
    prior_finding: old.finding, standing_finding: row.finding,
    proposed_disposition: proposed?.disposition || '',
    latest_observation_superseded: latestSuperseded,
    standing_evidence_retained: standingRetained,
    superseding_resolution: latestSuperseded ? { action: resolution.action, observed_at: resolutionObservedAt(resolution), evidence_run: resolution.evidence_run || resolution.evidence?.reconciliation_run || '' } : null,
    browser_identity_gate: proposed?.browser_identity_gate || '',
    prior_checked_at: old.checked_at, standing_checked_at: row.checked_at,
    latest_observed_at: manualAccessObservation?.latest_facility_access_recheck?.observed_at
      || manualAccessObservation?.latest_cms_reh_identity_recheck?.observed_at
      || manualAccessObservation?.latest_workbook_recheck?.observed_at
      || manualAccessObservation?.latest_cross_facility_portal_observation?.observed_at
      || manualAccessObservation?.latest_portal_download_recheck?.observed_at
      || manualAccessObservation?.latest_signed_url_recheck?.observed_at
      || manualAccessObservation?.latest_third_party_file_recheck?.observed_at
      || manualAccessObservation?.latest_browser_access_recheck?.observed_at
      || manualAccessObservation?.latest_current_file_recheck?.observed_at
      || manualAccessObservation?.latest_current_pointer_recheck?.observed_at
      || manualAccessObservation?.latest_pointer_recheck?.observed_at || proposed?.observed_at || '',
    prior_mrf_url: old.mrf_url, standing_mrf_url: row.mrf_url,
    candidate_mrf_url: proposed?.mrf_url || '',
    parser_correction: proposed?.parser_correction || null,
    prior_date: old.mrf_last_updated, standing_date: row.mrf_last_updated,
    issues, changes, workstream, priority: issues.includes('quarantined-identity') || issues.includes('verified-summary-license-state-conflict') ? 1
      : issues.includes('manual-correction-reconciliation') || issues.includes('standing-evidence-retained-review-new-observation')
        || issues.includes('reviewed-html-root-pointer-follow-up')
        || issues.includes('later-manual-observation-follow-up') ? 2 : 3,
    address_reconciliation: addressObservation || null,
    reviewed_header_disposition: reviewedHeaderDisposition || null,
    cms_enrollment_snapshot: cmsEnrollmentByCcn.get(row.ccn) || null,
    source_proof_audit: proofAudit || null,
    browser_byte_proof_retry: browserByteProofRetry || null,
    small_archive_disposition: smallArchiveDisposition || null,
    current_page_pointer_mismatch: currentPagePointerMismatch,
    state_evidence: proposed?.disposition.startsWith('verified-')
      ? verificationStateEvidence(proposed.declared_license_state, row.state, proposed.browser_identity_gate) : null,
    archive_review: archiveReview || null,
    archive_content_proof: archiveContent.get(row.ccn) || null,
    official_page_file_review: officialPageFile || null,
    browser_file_address_conflict: browserAddressConflict || null,
    direct_file_review: uhsDirectFile || null,
    manual_access_observation: manualAccessObservation || null,
    automation_challenge_observation: automatedChallenge,
    next_action: ((manualAccessObservation?.latest_facility_access_recheck?.disposition === 'facility-page-and-pointer-browser-access-denied-no-file-claim'
      || manualAccessObservation?.latest_browser_access_recheck?.disposition === 'official-domain-browser-access-denied-no-facility-file-claim'
      || manualAccessObservation?.latest_current_file_recheck?.disposition === 'official-page-linked-csv-retrieved-identity-metadata-incomplete-mrf-unresolved'
      || manualAccessObservation?.latest_pointer_recheck?.disposition === 'official-pointer-linked-file-transport-unresolved'
      || manualAccessObservation?.latest_current_pointer_recheck?.disposition === 'current-pointer-retrieved-target-unavailable')
      || manualAccessObservation?.latest_browser_access_recheck?.disposition === 'official-page-file-retained-root-pointer-transport-unresolved'
      || manualAccessObservation?.latest_signed_url_recheck?.disposition === 'signed-file-token-invalid-no-file-claim'
      || manualAccessObservation?.latest_third_party_file_recheck?.disposition === 'third-party-file-identity-corroborated-metadata-incomplete-no-promotion'
      || manualAccessObservation?.latest_portal_download_recheck?.disposition === 'official-portal-current-list-confirmed-download-bytes-unresolved-no-promotion'
      || manualAccessObservation?.latest_cross_facility_portal_observation?.disposition === 'cross-facility-portal-excluded-no-georgia-mrf-promotion'
      || manualAccessObservation?.latest_workbook_recheck?.disposition === 'official-custom-workbook-historical-current-link-no-cms-mrf-promotion'
      || manualAccessObservation?.latest_cms_reh_identity_recheck?.disposition === 'current-cms-reh-identity-corroborated-pointer-file-still-unresolved'
      ? manualAccessObservation.next_action : '')
      || (issues.includes('reviewed-pointer-or-page-linkage-follow-up')
      ? resolution.evidence?.next_action || reviewedPointerFollowUpAction(row.finding) : '')
      || (issues.includes('reviewed-pointer-target-client-follow-up') ? resolution.evidence?.next_action : '')
      || dispositionNextAction(issues, currentPagePointerMismatch) || dispositionNextAction(issues, smallArchiveDisposition) || reviewedHeaderDisposition?.next_action || addressObservation?.next_action || (issues.includes('verification-source-field-disagreement')
      ? 'Reconcile the nationwide fields against the exact header and browser observations; do not combine metadata from different observations silently.'
      : issues.includes('verification-file-byte-proof-audit-pending')
        ? proofAudit.identity_source === 'browser'
          ? browserByteProofRetry?.next_action || 'Retain and hash a bounded byte sample from the exact browser-observed file, bound to its URL and observation time; verify the recorded root identity fields against those bytes.'
          : 'Re-fetch a bounded byte sample from the exact pointer-linked file, record its digest and byte range, and verify the cached root identity fields against those retained bytes.'
      : automatedChallenge ? automatedChallenge.next_action
      : supportedBrowserAddressConflict ? browserAddressConflict.next_action
      : uhsDirectFile ? 'Confirm the exact file through the facility first-party pricing page or cms-hpt.txt; retain the current file identity and metadata while pointer linkage is blocked by the browser challenge.'
      : officialPageFile ? officialPageFile.next_action || officialPageFileArtifact.next_action : archiveReview?.next_action || (issues.includes('browser-file-identity-proof-insufficient')
        ? 'Reconcile recorded browser file name, street and state for this CCN. Gate: ' + proposed.browser_identity_gate + '. Preserve stronger standing evidence while this check remains pending.'
        : laterManualFollowUp ? manualAccessObservation.next_action
        : latestSuperseded ? resolution.action === 'quarantine'
          ? resolution.evidence?.next_action || 'Review the standing identity quarantine before assigning a facility pointer or file. ' + resolution.note
          : resolution.evidence?.next_action || 'No further action on the older nationwide observation; a later reviewed resolution supplies the standing evidence.'
          : manualAccessObservation?.next_action || proposed?.next_action || 'Reconcile source coverage.')),
    actionable: issues.length > 0 && !supportedIdentityUncertainty && !supportedBrowserAddressConflict,
    reconciliation_status: reconciliationStatus(issues, proofAudit, supportedIdentityUncertainty,
      supportedBrowserAddressConflict, latestSuperseded) };
  const completedArchive = archiveContent.get(row.ccn);
  if (issues.length === 0 && archiveReview && completedArchive?.mrf_url === row.mrf_url
    && completedArchive.decompressed_sha256) {
    record.next_action = 'Archive content proof for the exact standing file is complete: member identity, address, state, date and version were recorded. Recheck only after a publisher file change; this is not line-item validation.';
  }
  if (issues.length === 0 && addressObservation?.status === 'address-equivalence-reviewed-file-proof-pending'
    && proofAudit?.status === 'proof-audit-complete') {
    record.next_action = 'The saved pointer and bounded file-byte proof audit is complete for the reviewed address equivalence. Recheck only if the bound source changes; this is not full-file validation.';
  }
  if (issues.length === 0 && latestSuperseded && addressObservation?.status === 'roster-campus-relationship-unresolved'
    && resolution?.evidence?.rosterAddressException) {
    record.next_action = 'The later reviewed CCN resolution documents the roster-campus relationship and supersedes the older address question. Recheck only if the authoritative CCN or facility evidence changes.';
  }
  return record;
});
if (records.length !== 5419 || new Set(records.map(r => r.ccn)).size !== 5419) throw Error('Expected 5,419 unique CCNs');
const sources = ['compliance.csv', 'reviewed-resolutions.json', 'discovery-review.json', 'discovery-review-recoveries.json',
  'nationwide-verification.json', 'nationwide-browser-reviews.json', 'nationwide-search-reviews.json',
  'priority-one-cms-enrollment-snapshot-review.json',
  'reconciliation-address-observations.json', 'reconciliation-archive-browser-observations.json',
  'reconciliation-reviewed-header-dispositions.json',
  'reconciliation-archive-content-proof.json',
  'nationwide-source-proof-audit.json', 'reviewed-address-equivalences.json',
  'reconciliation-geisinger-challenge-observations.json',
  'reconciliation-asante-ashland-state-license-proof.json',
  'reconciliation-antelope-pointer-access-proof.json',
  'reconciliation-centra-lynchburg-pointer-proof.json',
  'reconciliation-south-oaks-root-pointer-proof.json',
  'reconciliation-redding-maryland-misattribution-proof.json',
  'reviewed-file-attribution-exclusions.json',
  'reconciliation-guaynabo-page-file-schema-proof.json',
  'reconciliation-version-parser-corrections.json',
  'reconciliation-riverside-manual-date-proof.json',
  'reconciliation-parkview-medical-center-pointer-page-proof.json',
  'reconciliation-caverna-redirect-linkage-proof.json',
  'reconciliation-camc-surgical-full-csv-zip-proof.json',
  'reconciliation-westborough-shared-pointer-exclusion-proof.json',
  'reconciliation-surgical-oklahoma-pointer-file-proof.json',
  'reconciliation-browser-byte-proof-retries.json',
  'nationwide-file-byte-proof.json',
  'reconciliation-byte-metadata-updates.json',
  'reconciliation-abrazo-pointer-proof.json',
  'reconciliation-quarantine-state-proof.json',
  'reconciliation-cameron-official-page-proof.json',
  'reconciliation-omh-shared-proof.json',
  'reconciliation-omh-unreviewed-cohort-proof.json',
  'reconciliation-remaining-quarantine-proof.json',
  'reconciliation-peacehealth-proof.json',
  'reconciliation-hopedale-proof.json',
  'reconciliation-harrison-proof.json',
  'reconciliation-plains-proof.json',
  'reconciliation-maniilaq-proof.json',
  'reconciliation-andalusia-proof.json',
  'reconciliation-vaughan-proof.json',
  'reconciliation-winchester-wadley-proof.json',
  'reconciliation-reviewed-address-proof.json',
  'reconciliation-claiborne-workbook-proof.json',
  'reconciliation-franciscan-nebraska-proof.json',
  'reconciliation-troy-pointer-mismatch-proof.json',
  'reconciliation-medical-arts-pointer-mismatch-proof.json',
  'reconciliation-evergreen-pointer-mismatch-proof.json',
  'reconciliation-hughston-pointer-mismatch-proof.json',
  'reconciliation-hh-health-official-page-links.json',
  'reconciliation-community-tallassee-file-observation.json',
  'reconciliation-greene-county-file-observation.json',
  'reconciliation-bibb-current-file-proof.json',
  'reconciliation-russell-official-page-file-proof.json',
  'reconciliation-whitfield-official-page-file-proof.json',
  'reconciliation-wth-page-file-proofs.json',
  'reconciliation-nmhs-pointer-mismatch-proofs.json',
  'reconciliation-burgess-pointer-mismatch-proof.json',
  'reconciliation-copley-grande-ronde-pointer-mismatch-proofs.json',
  'reconciliation-ozark-pointer-file-proof.json',
  'reconciliation-grand-lake-page-file-proof.json',
  'reconciliation-sheridan-page-file-proof.json',
  'reconciliation-lindsay-page-file-proof.json',
  'reconciliation-nor-lea-address-conflict-proof.json',
  'reconciliation-blythedale-williamson-pointer-mismatch-proofs.json',
  'reconciliation-core-institute-page-files-proof.json',
  'reconciliation-wth-milan-page-file-proof.json',
  'reconciliation-lincoln-pointer-dns-proof.json',
  'reconciliation-camc-greenbrier-pointer-mismatch-proof.json',
  'reconciliation-endeavor-swedish-pointer-file-proof.json',
  'reconciliation-covington-official-page-file-proof.json',
  'reconciliation-lexington-soft-root-proof.json',
  'reconciliation-chi-st-francis-identity-proof.json',
  'reconciliation-davis-medical-pointer-mismatch-proof.json',
  'reconciliation-crestwood-dns-override-proof.json',
  'reconciliation-arkansas-surgical-proof.json',
  'reconciliation-estes-valley-proof.json',
  'reconciliation-lawrence-memorial-official-page-proof.json',
  'reconciliation-webster-health-services-proof.json',
  'reconciliation-san-carlos-borromeo-proof.json',
  'reconciliation-kaleida-health-proof.json',
  'reconciliation-cullman-license-state-proof.json',
  'reconciliation-ardent-license-state-proofs.json',
  'reconciliation-wills-eye-license-state-proof.json',
  'reconciliation-williamson-license-state-proof.json',
  'reconciliation-cameron-license-state-proof.json',
  'reconciliation-atrium-stanly-current-proof.json',
  'reconciliation-baldwin-health-proof.json',
  'reconciliation-jackson-montgomery-proof.json',
  'reconciliation-small-unmatched-archives.json',
  'reconciliation-small-archive-dispositions.json',
  'reconciliation-st-francis-proof.json',
  'reconciliation-lbj-proof.json',
  'reconciliation-long-island-suffolk-proof.json',
  'reconciliation-long-island-suffolk-full-file-proof.json',
  'reconciliation-chambers-proof.json',
  'reconciliation-manual-pointer-file-proof.json',
  'reconciliation-manual-access-observations.json',
  'reconciliation-marshall-medical-centers-south-current-vendor-file-proof.json',
  'reconciliation-beth-israel-campus-status-proof.json',
  'reconciliation-hereford-two-file-proof.json',
  'reconciliation-scenic-mountain-operator-transition-proof.json',
  'reconciliation-unc-southeastern-alias-access-proof.json',
  'reconciliation-browser-file-address-conflicts.json',
  'reconciliation-uhs-direct-file-proof.json',
  'reconciliation-uvm-shared-pointer-attribution-proof.json',
  'reconciliation-uvm-medical-center-alias-proof.json',
  'reconciliation-guthrie-lourdes-transition-proof.json',
  'reconciliation-multicare-tacoma-allenmore-dual-file-proof.json',
  'reconciliation-multicare-deaconess-alias-proof.json',
  'reconciliation-generations-ohio-license-state-proof.json',
  'reconciliation-nyp-hospital-address-proof.json',
  'reconciliation-official-page-file-observations.json', '../../cms_data/hpt/roster.json', '../../cms_data/outreach.public.json'];
const summary = { hospitals: records.length, issues: {}, source_sha256: Object.fromEntries(sources.map(file =>
  [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, file))).digest('hex')])) };
summary.changes = records.reduce((out, record) => {
  for (const change of record.changes) out[change] = (out[change] || 0) + 1;
  return out;
}, {});
summary.reconciled_observations = { superseded_by_later_reviewed_resolution: records.filter(record => record.latest_observation_superseded).length };
summary.supported_uncertainties = { identity: records.filter(record => record.reconciliation_status === 'supported-identity-uncertainty').length };
summary.supported_uncertainties.browser_file_address_conflict = records
  .filter(record => record.reconciliation_status === 'supported-current-file-address-conflict').length;
summary.workstreams = records.reduce((out, record) => {
  out[record.workstream] = (out[record.workstream] || 0) + 1;
  return out;
}, {});
summary.actionable_workstreams = records.filter(record => record.actionable).reduce((out, record) => {
  out[record.workstream] = (out[record.workstream] || 0) + 1;
  return out;
}, {});
for (const record of records) for (const issue of record.issues) summary.issues[issue] = (summary.issues[issue] || 0) + 1;
summary.manual_dispositions = manualReviews.reduce((out, r) => { out[r.disposition] = (out[r.disposition] || 0) + 1; return out; }, {});
fs.writeFileSync(path.join(dir, 'manual-correction-reconciliation.json'), JSON.stringify({ records: manualReviews }, null, 2) + '\n');
fs.writeFileSync(path.join(dir, 'nationwide-reconciliation.json'), JSON.stringify({ summary, records }, null, 2) + '\n');
fs.writeFileSync(path.join(dir, 'nationwide-reconciliation-queue.json'), JSON.stringify(records.filter(r => r.actionable)
  .sort((a, b) => a.priority - b.priority || a.ccn.localeCompare(b.ccn)), null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
