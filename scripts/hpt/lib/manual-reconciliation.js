'use strict';

const VERIFIED = new Set(['compliant-observed', 'mrf-stale-over-365-days', 'old-template-version']);
const FACTUAL_ACCESS_OBSERVATIONS = new Set([
  'current-official-page-links-dead-pricing-resource',
  'current-official-page-links-file-with-bounded-metadata-gap',
  'current-official-page-links-unsupported-workbook-with-missing-root-pointer',
  'current-operator-file-does-not-identify-former-campus',
  'current-official-page-exposes-pdf-and-pointer-paths-return-404',
  'current-official-page-confirms-relocated-identity-with-no-visible-mrf-and-pointer-404s',
  'current-official-pricing-page-says-machine-readable-file-not-yet-posted-and-pointer-404s'
]);
const SOURCE_PAGE_ROLE_OBSERVATIONS = new Set([
  'current-official-source-page-confirms-standing-file-and-manual-field-role'
]);
const SUPPORTED_UNCERTAINTY_OBSERVATIONS = new Set([
  'direct-file-identity-corroborated-pointer-linkage-pending',
  'official-page-file-corroborated-root-pointer-pending',
  'quarantine-wrong-domain-and-state-retain-first-party-page-file-candidate'
]);
function authoritativeDates(rows) {
  return Object.fromEntries(rows.filter(r => (VERIFIED.has(r.finding) || r.finding === 'pointer-lists-no-mrf-url')
    && r.mrf_url && r.mrf_last_updated
    && Number.isFinite(Date.parse(r.checked_at))).map(r => [r.ccn, r.checked_at]));
}

function reconcileManual(rows, outreach, accessObservations = [], appliedResolutions = []) {
  const by = new Map(rows.map(r => [r.ccn, r]));
  const accessBy = new Map(accessObservations.map(r => [r.ccn, r]));
  const resolutionBy = new Map(appliedResolutions.map(r => [r.ccn, r]));
  const dates = authoritativeDates(rows);
  return Object.entries(outreach).filter(([, value]) => value.correction).map(([ccn, value]) => {
    const manual = value.correction, standing = by.get(ccn);
    const checked = manual.checkedOn || value.updatedAt || '';
    const differences = [];
    if (manual.mrfUrl && manual.mrfUrl !== standing?.mrf_url) differences.push('mrf-url');
    if (manual.pointerUrl && manual.pointerUrl !== standing?.pointer_url) differences.push('pointer-url');
    if (manual.lastUpdatedOn && manual.lastUpdatedOn !== standing?.mrf_last_updated) differences.push('declared-date');
    if (manual.templateVersion && manual.templateVersion !== standing?.cms_template_version) differences.push('template-version');
    const tier = standing?.finding === 'compliant-observed' ? 'compliant'
      : ['mrf-stale-over-365-days', 'old-template-version'].includes(standing?.finding) ? 'failing'
        : standing?.finding === 'not-applicable-closed' ? 'exempt' : null;
    if (manual.verdict && manual.verdict !== tier) differences.push('verdict');
    const superseded = !!(dates[ccn] && checked && Number.isFinite(Date.parse(checked))
      && checked.slice(0, 10) < dates[ccn].slice(0, 10));
    const access = accessBy.get(ccn);
    const factualAccessCorroborated = FACTUAL_ACCESS_OBSERVATIONS.has(access?.disposition)
      && Number.isFinite(Date.parse(access.observed_at)) && Number.isFinite(Date.parse(checked))
      && Date.parse(access.observed_at) > Date.parse(checked);
    const explicitUncertaintySupported = SUPPORTED_UNCERTAINTY_OBSERVATIONS.has(access?.disposition)
      && Number.isFinite(Date.parse(access.observed_at)) && Number.isFinite(Date.parse(checked))
      && Date.parse(access.observed_at) > Date.parse(checked);
    const sourcePageRoleResolved = SOURCE_PAGE_ROLE_OBSERVATIONS.has(access?.disposition)
      && differences.length === 1 && differences[0] === 'pointer-url'
      && access.pricing_resource_url === standing?.mrf_url
      && Number.isFinite(Date.parse(access.observed_at)) && Number.isFinite(Date.parse(checked))
      && Date.parse(access.observed_at) > Date.parse(checked);
    const reviewed = resolutionBy.get(ccn);
    const reviewedPointerFileRoleResolved = reviewed?.action === 'replace-observation'
      && differences.length === 1 && differences[0] === 'mrf-url'
      && reviewed.finding === standing?.finding
      && reviewed.evidence?.observedFinding === standing.finding
      && reviewed.evidence.pointerMrfUrl === manual.mrfUrl
      && reviewed.evidence.url === standing.mrf_url
      && reviewed.evidence.pointerUrl === standing.pointer_url
      && reviewed.evidence.pointerMrfSha256 && reviewed.evidence.fileSha256
      && (reviewed.evidence.pointerMrfDeclaredAddress !== reviewed.evidence.declared_address
        || reviewed.evidence.pointerMrfDeclaredLocationName !== reviewed.evidence.location_name)
      && Number.isFinite(Date.parse(reviewed.reviewed_at)) && Number.isFinite(Date.parse(checked))
      && Date.parse(reviewed.reviewed_at) > Date.parse(checked);
    const laterFileDateSupersedes = access?.disposition === 'same-url-later-hash-bound-file-date-supersedes-manual-date'
      && differences.length === 1 && differences[0] === 'declared-date'
      && manual.mrfUrl === standing?.mrf_url && access.mrf_url === standing.mrf_url
      && manual.lastUpdatedOn === access.manual_date && standing.mrf_last_updated === access.later_declared_date
      && Number.isFinite(Date.parse(access.observed_at)) && Number.isFinite(Date.parse(checked))
      && Date.parse(access.observed_at) > Date.parse(checked);
    return { ccn, hospital_name: standing?.hospital_name || '',
      manual_checked_at: checked, standing_checked_at: standing?.checked_at || '',
      manual_mrf_url: manual.mrfUrl || '', standing_mrf_url: standing?.mrf_url || '',
      manual_date: manual.lastUpdatedOn || '', standing_date: standing?.mrf_last_updated || '',
      differences,
      ...(reviewedPointerFileRoleResolved ? { reviewed_resolution_run: reviewed.evidence_run,
        manual_url_role: 'pointer-declared file with different facility identity',
        standing_url_role: 'separately first-party-page-linked file for this campus' } : {}),
      disposition: !standing ? 'roster-record-missing' : superseded || laterFileDateSupersedes ? 'superseded-by-later-file-evidence'
        : reviewedPointerFileRoleResolved ? 'reviewed-pointer-file-role-reconciled'
        : sourcePageRoleResolved ? 'source-page-field-role-reconciled'
        : factualAccessCorroborated ? 'later-observation-corroborates-factual-access-issue'
        : explicitUncertaintySupported ? 'later-observation-supports-explicit-uncertainty'
        : differences.length ? 'evidence-review-required' : 'agrees-with-standing-fields',
      next_action: laterFileDateSupersedes ? access.next_action
        : superseded ? 'Retain manual history; display the later dated file finding.'
        : reviewedPointerFileRoleResolved ? reviewed.evidence.next_action
        : sourcePageRoleResolved ? access.next_action
        : factualAccessCorroborated ? access.next_action
        : explicitUncertaintySupported ? access.next_action
        : differences.length ? 'Verify manual source links and reconcile identity and metadata with the standing evidence.'
          : 'Retain manual provenance; include supporting retrieval proof in the overall evidence audit.' };
  });
}
module.exports = { FACTUAL_ACCESS_OBSERVATIONS, SOURCE_PAGE_ROLE_OBSERVATIONS, SUPPORTED_UNCERTAINTY_OBSERVATIONS, authoritativeDates, reconcileManual };
