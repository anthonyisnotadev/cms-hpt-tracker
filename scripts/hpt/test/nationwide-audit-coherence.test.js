'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const auditDir = path.resolve(__dirname, '../../../data/hpt-audit');
const read = name => JSON.parse(fs.readFileSync(path.join(auditDir, name), 'utf8'));
const { applyReviewedVerificationOverlays } = require('../lib/reviewed-verification-overlays');
const { resolutionObservedAt } = require('../lib/reconciliation-precedence');
const { requiresDispositionAction, stages } = require('../lib/unresolved-investigation-stages');

test('generated verification, source-proof audit and reconciliation agree per CCN on supersession', () => {
  const verification = read('nationwide-verification.json');
  const proof = read('nationwide-source-proof-audit.json');
  const reconciliation = read('nationwide-reconciliation.json');
  const proofByCcn = new Map(proof.records.map(row => [row.ccn, row]));
  const reconciliationByCcn = new Map(reconciliation.records.map(row => [row.ccn, row]));
  assert.equal(verification.records.length, 5419);
  assert.equal(proofByCcn.size, 5419);
  assert.equal(reconciliationByCcn.size, 5419);
  let superseded = 0;
  for (const row of verification.records) {
    const isSuperseded = !!row.latest_observation_superseded;
    assert.equal(proofByCcn.get(row.ccn)?.status === 'superseded-by-reviewed-resolution', isSuperseded,
      `source-proof status disagrees for ${row.ccn}`);
    assert.equal(!!reconciliationByCcn.get(row.ccn)?.latest_observation_superseded, isSuperseded,
      `reconciliation status disagrees for ${row.ccn}`);
    if (isSuperseded) superseded++;
  }
  assert.equal(verification.summary.superseded_observations, superseded);
  assert.equal(proof.summary.superseded_observations, superseded);
  assert.equal(reconciliation.summary.reconciled_observations.superseded_by_later_reviewed_resolution, superseded);
});

test('every nationwide supersession has one exact-CCN, dated, supported reviewed-resolution ledger match', () => {
  const verification = read('nationwide-verification.json');
  const resolutions = read('reviewed-resolutions.json');
  const superseded = verification.records.filter(row => row.latest_observation_superseded);
  let joined = 0;
  for (const row of superseded) {
    const matches = resolutions.filter(resolution => resolution.ccn === row.ccn
      && resolutionObservedAt(resolution) === row.superseding_resolution_observed_at);
    assert.equal(matches.length, 1, `supersession for ${row.ccn} must join to exactly one dated ledger row`);
    const resolution = matches[0];
    assert.ok(!['correct-site', 'scope-review-pending'].includes(resolution.action),
      `non-dispositive ${resolution.action} action cannot supersede ${row.ccn}`);
    assert.ok(resolution.evidence || resolution.proof || resolution.note,
      `supersession for ${row.ccn} must retain evidence, proof or a review note`);
    assert.equal(row.superseding_resolution_run,
      resolution.evidence_run || resolution.evidence?.reconciliation_run || '',
      `supersession run reference disagrees with the exact-CCN ledger row for ${row.ccn}`);
    joined += 1;
  }
  assert.equal(joined, verification.summary.superseded_observations);
});

test('nationwide unresolved summary and prioritized investigation worklist agree on exact CCNs', () => {
  const verification = read('nationwide-verification.json');
  const reconciliation = read('nationwide-reconciliation.json');
  const worklist = read('unresolved-investigation-worklist.json');
  const isOpenDisposition = row => !row.latest_observation_superseded
    && (!row.standing_evidence_retained || row.disposition === 'pointer-facility-match-unresolved')
    && !row.supported_identity_uncertainty
    && !/^verified-|^scope-exempt/.test(row.disposition);
  const rawUnresolved = verification.records.filter(isOpenDisposition).map(row => row.ccn).sort();
  const effectiveRecords = applyReviewedVerificationOverlays(verification.records, auditDir);
  const unresolved = effectiveRecords.filter(isOpenDisposition).map(row => row.ccn).sort();
  const investigation = reconciliation.records.filter(row => row.workstream === 'genuinely-unresolved-investigation')
    .map(row => row.ccn).sort();
  const quarantine = reconciliation.records.filter(row => row.workstream === 'identity-quarantine')
    .map(row => row.ccn).sort();
  const quarantineWork = quarantine.filter(ccn => unresolved.includes(ccn));
  const expectedInvestigations = unresolved.filter(ccn => !quarantineWork.includes(ccn));
  assert.deepEqual(investigation.filter(ccn => !expectedInvestigations.includes(ccn)), []);
  assert.ok(investigation.every(ccn => worklist.records.some(row => row.ccn === ccn)));
  assert.deepEqual(worklist.records.map(row => row.ccn).filter(ccn => !investigation.includes(ccn)).sort(), []);
  assert.ok(!unresolved.includes('370244'));
  assert.equal(verification.summary.unresolved, rawUnresolved.length);
  assert.equal(verification.summary.source_observation_effective_counts['genuinely-unresolved'], rawUnresolved.length);
  assert.equal(verification.summary.source_observation_effective_counts['active-verification-claim'],
    verification.summary.effective_counts['active-verification-claim'] - 4);
  assert.equal(verification.summary.reviewed_view_unresolved, unresolved.length);
  assert.equal(verification.summary.reviewed_view_effective_counts['genuinely-unresolved'], unresolved.length);
  assert.equal(verification.summary.effective_counts['genuinely-unresolved'], unresolved.length,
    'effective category summary matches the effective reviewed view');
  assert.ok(rawUnresolved.includes('440161'));
  assert.ok(!unresolved.includes('370244'));
  assert.ok(!unresolved.includes('440161'));
  assert.equal(verification.records.find(row => row.ccn === '440161').disposition, 'mrf-request-unsuccessful');
  assert.equal(effectiveRecords.find(row => row.ccn === '440161').disposition, 'verified-current-mrf');
});

test('current closed-hospital scope dispositions survive historical crawl supersession in the tracker', () => {
  const verification = read('nationwide-verification.json');
  const { loadReviewedView } = require('../lib/reviewed-resolutions');
  const effectiveRows = loadReviewedView(auditDir).compliance;
  const overlaps = verification.records.filter(row => row.latest_observation_superseded
    && row.disposition === 'scope-exempt-closed');
  const expectedClosedCcns = ['040132', '220017', '220098', '220126'];
  assert.deepEqual(overlaps.map(row => row.ccn).sort(), expectedClosedCcns);
  for (const row of overlaps) {
    const effective = effectiveRows.find(item => item.ccn === row.ccn);
    assert.equal(effective?.finding, 'not-applicable-closed',
      `current closure disposition was hidden by historical supersession for ${row.ccn}`);
  }
});

test('every genuinely unresolved CCN retains a dated evidence gate and concrete next action', () => {
  const verification = read('nationwide-verification.json');
  const unresolved = verification.records.filter(row => !row.latest_observation_superseded
    && (!row.standing_evidence_retained || row.disposition === 'pointer-facility-match-unresolved')
    && !row.supported_identity_uncertainty
    && !/^verified-|^scope-exempt/.test(row.disposition));
  assert.equal(unresolved.length, verification.summary.unresolved);
  for (const row of unresolved) {
    assert.match(row.observed_at || row.standing_checked_at || row.website_observed_at || '', /^20\d{2}-\d{2}-\d{2}T/, `missing dated observation for ${row.ccn}`);
    assert.ok(row.next_action && row.next_action.length > 20, `missing next action for ${row.ccn}`);
    assert.ok(row.official_domain || row.pointer_url || row.mrf_url || row.standing_pointer_url || row.standing_mrf_url
      || row.website_name_evidence || row.website_address_evidence || row.evidence?.pointer_location_names?.length
      || row.website_state === 'not-identified-after-completed-search',
      `missing source lead for ${row.ccn}`);
  }
});

test('reviewed page-file overlay carries TriStar current evidence without rewriting the raw crawl', () => {
  const raw = read('nationwide-verification.json').records.find(row => row.ccn === '440161');
  const proof = read('nationwide-source-proof-audit.json').records.find(row => row.ccn === '440161');
  const reconciliation = read('nationwide-reconciliation.json').records.find(row => row.ccn === '440161');
  const { loadReviewedView } = require('../lib/reviewed-resolutions');
  const effective = loadReviewedView(auditDir).compliance.find(row => row.ccn === '440161');
  const trackerSource = fs.readFileSync(path.resolve(__dirname, '../../../tracker.html'), 'utf8');

  assert.equal(raw.mrf_http_status, '403');
  assert.equal(raw.declared_address, '');
  assert.equal(proof.status, 'proof-audit-complete');
  assert.deepEqual(proof.issues, []);
  assert.equal(proof.file_byte_proof.sha256,
    '8c754bebb73b8ba7cd6ad6f6b726537351c14370217864d96b102c3711d88480');
  const overlay = read('reconciliation-nationwide-verification-overlays.json').records.find(row => row.ccn === '440161');
  const byteProof = read('nationwide-file-byte-proof.json').records.find(row => row.ccns?.includes('440161')
    && row.url === overlay.page_linked_mrf_url);
  assert.equal(byteProof.sha256, proof.file_byte_proof.sha256);
  assert.equal(overlay.tracker_link_url, 'https://www.tristarhealth.com/patient-resources/patient-financial-resources/pricing-transparency-cms-required-file-of-standard-charges');
  assert.equal(proof.state_evidence.status, 'corroborated');
  assert.ok(proof.pointer_proof.length > 0);
  assert.ok(proof.pointer_proof.every(pointer => pointer.status === 'hash-corroborated'));
  assert.equal(reconciliation.proposed_disposition, 'verified-current-mrf');
  assert.equal(reconciliation.workstream, 'consistent');
  assert.equal(reconciliation.latest_observed_at, '2026-09-26T06:32:44.210Z');
  assert.equal(reconciliation.issues.includes('verification-source-field-disagreement'), false);
  assert.equal(reconciliation.issues.includes('verified-summary-missing-file-address'), false);
  assert.equal(reconciliation.issues.includes('verified-summary-missing-state-evidence'), false);
  assert.equal(effective.finding, 'compliant-observed');
  assert.match(effective.evidence, /Nationwide verification/);
  assert.equal(effective.mrf_url, overlay.tracker_link_url);
  assert.equal(effective.mrf_last_updated, '2026-09-01');
  assert.equal(effective.mrf_last_updated, '2026-09-01');
  assert.match(trackerSource, /tristarhealth\.com\/patient-resources\/patient-financial-resources\/pricing-transparency-cms-required-file-of-standard-charges/);
  assert.doesNotMatch(trackerSource, /hcadam\.com\/api\/public\/content\/0947329859ac44d4aee0f06e1cda2eb9\?download=true/);
});

test('UHS direct-file proof survives a newer pointer challenge without promotion', () => {
  const row = read('nationwide-verification.json').records.find(item => item.ccn === '024001');
  assert.equal(row.mrf_url, 'https://uhsfilecdn.eskycity.net/bh/721539530_northstar_standardcharges.csv');
  assert.equal(row.mrf_state, 'page-linked-file-retrieved');
  assert.equal(row.declared_address, '2530 DEBARR ROAD, ANCHORAGE, AK 99508');
  assert.equal(row.declared_license_state, 'AK');
  assert.equal(row.cms_template_version, '3.0.0');
  // The newer facility-specific pointer challenge is retained as an access
  // observation; it must not promote or erase the independently recovered
  // page-linked file metadata.
  assert.equal(row.disposition, 'pointer-access-denied-to-client');
  assert.match(row.next_action, /pointer/);
});

test('manual operator-domain corroboration is retained in the nationwide overlay', () => {
  const manual = read('reconciliation-manual-access-observations.json').records;
  const verification = new Map(read('nationwide-verification.json').records.map(row => [row.ccn, row]));
  for (const observation of manual) {
    const domainUrl = observation.current_operator_domain || observation.current_operator_domain_lead;
    if (!domainUrl) continue;
    const hostname = new URL(domainUrl).hostname;
    const row = verification.get(observation.ccn);
    assert.equal(row?.official_domain, hostname, `operator domain was lost for ${observation.ccn}`);
  }
});

test('page-linked manual proofs stay page-linked and publisher-file schema aliases are retained', () => {
  const verification = new Map(read('nationwide-verification.json').records.map(row => [row.ccn, row]));
  const mountainview = verification.get('314027');
  assert.equal(mountainview?.mrf_state, 'page-linked-file-retrieved');
  assert.match(mountainview?.mrf_url || '', /MountainView-Behavioral-Hospital_sta\.csv/);
  const sierra = verification.get('450668');
  assert.equal(sierra?.mrf_state, 'page-linked-file-retrieved');
  assert.equal(sierra?.declared_hospital_name, 'TENET HOSPITALS LIMITED');
  assert.equal(sierra?.cms_template_version, '3.0.0');
  assert.match(sierra?.mrf_url || '', /954537720-1215969787_tenet-hospitals-limited_standardcharges\.json/);
});

test('superseded CHRISTUS Babcock retry is separate from standing Westover Hills evidence', () => {
  const row = read('nationwide-verification.json').records.find(record => record.ccn === '450237');
  assert.equal(row.observation_role, 'superseded-retry');
  assert.equal(row.latest_observation_superseded, true);
  assert.match(row.mrf_url, /santarosahospitalmedicalcenter_standardcharges\.json$/);
  assert.match(row.standing_mrf_url, /santarosahospitalwestoverhills_standardcharges\.json$/);
  assert.notEqual(row.mrf_url, row.standing_mrf_url);
  assert.equal(row.standing_finding, 'compliant-observed');
  assert.equal(row.standing_pointer_url, 'https://christushealth.org/cms-hpt.txt');
});

test('Taylor Regional never inherits the mislabeled South Carolina page file', () => {
  const observation = read('reconciliation-manual-access-observations.json').records
    .find(record => record.ccn === '110256');
  const verification = read('nationwide-verification.json').records
    .find(record => record.ccn === '110256');
  const work = read('unresolved-investigation-worklist.json').records
    .find(record => record.ccn === '110256');
  assert.equal(observation.source_page_file_declared_state, 'SC');
  assert.equal(observation.source_page_file_declared_location_name, 'Edgefield County Healthcare');
  assert.equal(verification.state, 'GA');
  assert.notEqual(verification.standing_mrf_url, observation.source_page_linked_file_url);
  assert.ok(work);
  assert.match(work.next_action,
    /(?:Do not associate the current EZCOST download with Taylor Regional|do not treat the SB505 page as MRF attribution)/i);
});

test('Petersburg transport-only pointer retry preserves the reviewed page-file finding', () => {
  const row = read('nationwide-reconciliation.json').records.find(record => record.ccn === '021304');
  assert.equal(row.standing_finding, 'official-page-mrf-root-pointer-unavailable');
  assert.equal(row.standing_evidence_retained, true);
  assert.equal(row.workstream, 'standing-evidence-follow-up');
  assert.ok(row.issues.includes('standing-evidence-retained-review-new-observation'));
  assert.ok(!row.issues.includes('latest-check-unresolved'));
});

test('Cameron unmatched retry cannot supersede its own reviewed license-state conflict', () => {
  const row = read('nationwide-verification.json').records.find(record => record.ccn === '260057');
  const resolution = read('reviewed-resolutions.json').find(record => record.ccn === '260057');
  const reconciliation = read('nationwide-reconciliation.json').records.find(record => record.ccn === '260057');
  assert.equal(resolution.evidence.observedFinding, 'mrf-license-state-field-conflicts-facility');
  assert.equal(row.prior_finding, resolution.evidence.observedFinding);
  assert.equal(row.latest_observation_superseded, false);
  assert.equal(row.standing_evidence_retained, true);
  assert.equal(reconciliation.latest_observation_superseded, false);
  assert.equal(reconciliation.standing_evidence_retained, true);
  assert.ok(reconciliation.issues.includes('standing-evidence-retained-review-new-observation'));
  assert.ok(!reconciliation.issues.includes('latest-check-unresolved'));
});

test('generic manual pointer/file observations reach nationwide verification', () => {
  const row = read('nationwide-verification.json').records.find(record => record.ccn === '281314');
  assert.equal(row.disposition, 'verified-template-review');
  assert.equal(row.pointer_state, 'retrieved-facility-linked-manual-review');
  assert.equal(row.pointer_url, 'http://www.ajhc.org/cms-hpt.txt');
  assert.equal(row.mrf_url, 'http://www.ajhc.org/476000710_annie-jeffrey-memorial-county-health-center_standardcharges.csv');
  assert.equal(row.declared_license_state, 'NE');
  assert.equal(row.cms_template_version, '2.0.0');
  assert.equal(row.facility_identity, 'corroborated-by-reviewed-browser-read');
  assert.equal(row.latest_observation_superseded, false);
});

test('page-linked manual file evidence stays separate from unresolved root pointer', () => {
  const row = read('nationwide-verification.json').records.find(record => record.ccn === '281352');
  assert.equal(row.disposition, 'verified-current-mrf');
  assert.equal(row.mrf_state, 'page-linked-file-retrieved');
  assert.equal(row.pointer_state, 'request-or-tool-failure');
  assert.match(row.mrf_url, /secure\.claraprice\.net\/price-transparency/);
  assert.equal(row.declared_license_state, 'NE');
  assert.equal(row.cms_template_version, '3.0.0');
  assert.equal(row.facility_identity, 'corroborated-by-reviewed-browser-read');
  assert.equal(row.declared_last_updated, '2026-06-22');
});

test('Lakewood URL bytes remain identity-bound while the complete Orange MRF supersedes the old assignment', () => {
  const proof = read('nationwide-source-proof-audit.json').records.find(record => record.ccn === '050348');
  assert.equal(proof.status, 'superseded-by-reviewed-resolution');
  assert.deepEqual(proof.issues, []);
  const verification = read('nationwide-verification.json').records.find(record => record.ccn === '050348');
  assert.equal(verification.latest_observation_superseded, true);
  const resolution = read('reviewed-resolutions.json').find(record => record.ccn === '050348');
  assert.equal(resolution.evidence.url,
    'https://www.ucihealth.org/pricetransparency/952226406_regents-of-the-university-of-california-at-irvine-hospital_standardcharges.json');
  const ledger = read('nationwide-file-byte-proof.json').records
    .filter(record => record.url === 'https://www.ucihealth.org/pricetransparency/952226406_uci-health-lakewood_standardcharges.json');
  assert.equal(ledger.length, 1);
  assert.deepEqual(ledger[0].ccns, ['050581'], 'Lakewood evidence remains attached only to its exact facility');
});

test('template-only page evidence does not create an MRF byte-proof gap', () => {
  const proof = read('nationwide-source-proof-audit.json').records.find(record => record.ccn === '400135');
  const reconciliation = read('nationwide-reconciliation.json').records.find(record => record.ccn === '400135');
  assert.equal(proof.status, 'not-a-verification-claim');
  assert.equal(proof.reason, 'template-review-page-file-only');
  assert.ok(!reconciliation.issues.includes('verification-file-byte-proof-audit-pending'));
  assert.notEqual(reconciliation.workstream, 'verification-proof-gap');
});

test('template-review rows with no declared version are not mislabeled old and remain follow-ups', () => {
  const verification = read('nationwide-verification.json');
  const reconciliation = read('nationwide-reconciliation.json');
  const byCcn = new Map(reconciliation.records.map(row => [row.ccn, row]));
  const unknownVersion = verification.records.filter(row => row.disposition === 'verified-template-review'
    && !String(row.cms_template_version || '').trim());
  assert.ok(unknownVersion.length > 0);
  for (const row of unknownVersion) {
    const reconciled = byCcn.get(row.ccn);
    assert.doesNotMatch(reconciled.standing_finding, /old-template-version|mrf-template-version-noncanonical/);
    assert.ok(reconciled.issues.includes('verified-template-version-unobserved-follow-up'));
    assert.ok(!reconciled.issues.includes('proposed-finding-differs-from-standing'));
    assert.equal(reconciled.workstream, 'standing-evidence-follow-up');
  }
});

test('stale manual verified instructions yield to a newer unresolved disposition in both queues', () => {
  const reconciliation = read('nationwide-reconciliation.json').records;
  const worklist = read('unresolved-investigation-worklist.json').records;
  const workByCcn = new Map(worklist.map(row => [row.ccn, row]));
  const affected = reconciliation.filter(row => row.workstream === 'genuinely-unresolved-investigation'
    && requiresDispositionAction(row.manual_access_observation, row.proposed_disposition));
  assert.ok(affected.length > 0);
  for (const row of affected) {
    const current = workByCcn.get(row.ccn);
    assert.ok(current, `${row.ccn} must remain in the actionable unresolved queue`);
    assert.equal(row.next_action, stages[row.proposed_disposition]?.action, row.ccn);
    assert.equal(current.next_action, row.next_action, row.ccn);
    assert.notEqual(row.proposed_disposition, 'verified-current-mrf', row.ccn);
  }
});

test('remaining manual-access instruction difference is explicitly inventoried', () => {
  const effective = read('nationwide-effective-audit.json');
  assert.equal(effective.investigation_worklist.next_action_differences_from_reconciliation, 1);
  assert.deepEqual(effective.investigation_worklist.next_action_difference_ccns, ['230030']);
});
