'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { csvToObjects } = require('../lib/util');
const {
  metadataState, effectiveDispositionCategory, completeFullFileObservation, selectedFileEvidence, headerEvidenceForSelection, qualifyBrowserIdentity, choose, buildTargetIndexes, indexedPointerObservation, pointerRetainedBytesStatus, pointerCorpusProvenance, applyBrowserPointerObservation, manualPageFileRecheck, disposition
} = require('../build-nationwide-verification');
const { applyNationwideVerification } = require('../lib/nationwide-verification-view');

test('a fully captured hash-matched 206 is complete only when Content-Range covers the entire object', () => {
  const proof = { full_file_validated: true, file_range_status: 206, file_bytes: 20553, full_file_bytes: 20553,
    file_sha256: 'a'.repeat(64), full_file_sha256: 'a'.repeat(64), file_content_range: 'bytes 0-20552/20553',
    parsed_data_rows: 94, data_rows_with_description: 94, data_rows_with_gross_charge: 94,
    data_rows_with_payer: 94, data_rows_with_usable_negotiated_charge: 94, csv_data_row_widths: [23], csv_header_columns: 23 };
  assert.equal(completeFullFileObservation(proof), true);
  assert.equal(completeFullFileObservation({ ...proof, file_content_range: 'bytes 0-65535/20553' }), false);
  assert.equal(completeFullFileObservation({ ...proof, file_bytes: 65536 }), false);
  assert.equal(completeFullFileObservation({ ...proof, file_sha256: 'b'.repeat(64) }), false);
  assert.equal(completeFullFileObservation({ ...proof, data_rows_with_usable_negotiated_charge: 93 }), false);
});

test('a complete hash-matched CSV accepted by CMS v3 validator is complete even when sparse rows omit optional charge fields', () => {
  const proof = { full_file_validated: true, file_range_status: 200, file_bytes: 93493711,
    full_file_bytes: 93493711, file_sha256: 'c'.repeat(64), full_file_sha256: 'c'.repeat(64),
    parsed_data_rows: 266930, csv_header_columns: 29, csv_data_row_widths: [29],
    cms_validator: { package: '@cmsgov/hpt-validator-cli', version: '1.10.8',
      requirements: 'v3.0', format: 'csv', valid: true, error_count: 0, alert_count: 0 } };
  assert.equal(completeFullFileObservation(proof), true);
  assert.equal(completeFullFileObservation({ ...proof,
    cms_validator: { ...proof.cms_validator, error_count: 1 } }), false);
  assert.equal(completeFullFileObservation({ ...proof, file_bytes: 93493710 }), false);
});

test('a complete JSON v3 file accepts only zero validator errors and the documented 3.0 literal alert', () => {
  const proof = { full_file_validated: true, file_kind: 'application/json', file_range_status: 200,
    file_bytes: 45927333, full_file_bytes: 45927333, file_sha256: 'd'.repeat(64),
    full_file_sha256: 'd'.repeat(64), cms_template_version: '3.0', json_schema_version: '3.0.0',
    json_data_rows: 5189, json_usable_charge_rows: 5189,
    cms_validator: { package: '@cmsgov/hpt-validator-cli', version: '1.10.8',
      requirements: 'v3.0', format: 'json', valid: true, error_count: 0, alert_count: 1,
      alert: "The value in this MRF's version data element \"3.0\" does not match expected \"3.0.0\"." } };
  assert.equal(completeFullFileObservation(proof), true);
  assert.equal(completeFullFileObservation({ ...proof,
    cms_validator: { ...proof.cms_validator, error_count: 1 } }), false);
  assert.equal(completeFullFileObservation({ ...proof,
    cms_validator: { ...proof.cms_validator, alert: 'unrelated warning' } }), false);
  assert.equal(completeFullFileObservation({ ...proof, cms_template_version: '3.0.0' }), false);
});

test('Covington full-file v3 validation resolves only CCN 251325 and preserves Smith County as unresolved', () => {
  const root = path.resolve(__dirname, '../../..');
  const proof = JSON.parse(fs.readFileSync(path.join(root,
    'data/hpt-audit/reconciliation-covington-smith-current-pointer-file-proof-2026-09-30.json'), 'utf8'));
  const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/nationwide-verification.json'), 'utf8'));
  const byteAudit = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/nationwide-source-proof-audit.json'), 'utf8'))
    .records.find(row => row.ccn === '251325');
  const covington = snapshot.records.find(row => row.ccn === '251325');
  const smith = snapshot.records.find(row => row.ccn === '250786');
  const elCampo = snapshot.records.find(row => row.ccn === '450694');
  assert.equal(proof.current_mrf_full_file_review.sha256,
    '962080aef2ea163adfe3c9b9005cb35dcea20e801ab031b9495e3bcea8c74886');
  assert.equal(proof.current_mrf_full_file_review.cms_validator.requirements, 'v3.0');
  assert.equal(proof.current_mrf_full_file_review.cms_validator.valid, true);
  assert.equal(proof.current_mrf_full_file_review.cms_validator.error_count, 0);
  assert.equal(proof.current_mrf_full_file_review.cms_validator.alert_count, 0);
  assert.equal(byteAudit.status, 'proof-audit-complete');
  assert.equal(byteAudit.file_byte_proof.sha256, proof.current_mrf_full_file_review.sha256);
  assert.match(byteAudit.file_byte_proof.raw_artifact, /^private-proof-cache:/);
  assert.equal(covington.disposition, 'verified-current-mrf');
  assert.equal(covington.cms_template_version, '3.0.0');
  assert.equal(covington.declared_location_name, 'covington_county_hospital_.1');
  assert.equal(smith.disposition, 'pointer-facility-match-unresolved');
  assert.equal(smith.mrf_url, '');
  assert.equal(elCampo.pointer_state, 'retrieved-facility-linked');
  assert.equal(elCampo.pointer_corpus_sha256, 'fcf800c84155c508f7a41663a3480a4d728d75295b5e75cf9f571b90b35e14c8');
  assert.equal(elCampo.mrf_url, 'https://app.box.com/shared/static/vucltv6rqwl6olqb1bdktazi7mep60wa.csv');
  assert.equal(elCampo.disposition, 'pointer-linked-file-not-probed');
  assert.equal(elCampo.standing_evidence_retained, true);
  assert.equal(snapshot.summary.reviewed_view_unresolved, 582);
});

test('Harsha CMS v3 proof is bound to retained bytes, exact identity and parsed rows', () => {
  const root = path.resolve(__dirname, '../../..');
  const proof = JSON.parse(fs.readFileSync(path.join(root,
    'data/hpt-audit/reconciliation-harsha-v3-current-pointer-proof-2026-09-30.json'), 'utf8'));
  const bytes = fs.readFileSync(path.join(root, proof.retained_file));
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  const rows = require('../lib/util').parseCSV(bytes.toString('utf8'));
  assert.equal(proof.ccn, '154054');
  assert.equal(proof.cms_template_version, '3.0.0');
  assert.equal(proof.declared_license_state, 'IN');
  assert.equal(proof.attestation, true);
  assert.equal(proof.full_file_bytes, 20553);
  assert.equal(proof.file_content_range, 'bytes 0-20552/20553');
  assert.equal(proof.pointer_declared_file_url.endsWith('/261091197_harsha-behavioral-center_standardcharges.csv'), true);
  assert.equal(proof.alias_check.same_bytes, true);
  assert.equal(digest, proof.full_file_sha256);
  assert.equal(rows[1][0], 'Harsha Behavioral Center');
  assert.equal(rows[1][2], '3.0.0');
  assert.equal(rows[1][7], '1891966065');
  assert.equal(rows.slice(3).filter(row => row.some(Boolean)).length, 94);
  assert.equal(new Set(rows.slice(3).filter(row => row.some(Boolean)).map(row => row.length)).size, 1);
  const algorithmRows = rows.slice(3).filter(row => row[13] || row[14]);
  assert.equal(algorithmRows.length, 4);
  assert.equal(algorithmRows.filter(row => row[15] && row[16] && row[17] && row[18]).length, 4);
  assert.deepEqual(proof.cms_v3_allowed_amount_check, {
    columns: ['median_amount', '10th_percentile', '90th_percentile', 'count'], applicable_rows: 4, complete_rows: 4
  });
  assert.equal(proof.raw_pointer_contact_fields_omitted, true);
});

test('incomplete retries preserve stronger findings while newer pointer evidence corrects a stale route finding', () => {
  const root = path.resolve(__dirname, '../../..');
  const audit = path.join(root, 'data/hpt-audit');
  const { loadReviewedView } = require('../lib/reviewed-resolutions');
  const withoutNationwide = loadReviewedView(audit, { nationwide: false }).compliance;
  const effective = loadReviewedView(audit).compliance;
  const report = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-verification.json'), 'utf8'));
  assert.equal(withoutNationwide.length, 5419);
  assert.equal(effective.length, 5419);
  assert.equal(report.records.length, 5419);
  const before = new Map(withoutNationwide.map(row => [row.ccn, row]));
  const after = new Map(effective.map(row => [row.ccn, row]));
  const retained = report.records.filter(row => row.standing_evidence_retained);
  // Incomplete retries remain queued alongside retained evidence; exact
  // byte-identical retries no longer reopen reviewed source chains.
  // Formerly incomplete pointer retries with newer complete hash-bound
  // first-party pointer/file evidence are no longer retained as unresolved
  // retries. Additional exact-CCN reviewed resolutions supersede
  // stale cache-derived observations; a retry timestamp must not be reconstructed
  // from the derived index.
  assert.equal(retained.length, 889);
  const pennHup = report.records.find(row => row.ccn === '390111');
  assert.equal(pennHup.disposition, 'verified-template-review');
  assert.equal(pennHup.mrf_state, 'page-linked-file-retrieved');
  assert.equal(pennHup.pointer_state, 'not-assessed-page-file-only');
  assert.equal(pennHup.pointer_result, '');
  assert.equal(pennHup.metadata_source, 'manual-page-file-recheck');
  assert.equal(pennHup.cms_template_version, '3.0.0');
  assert.equal(pennHup.file_sample_bytes, 65536);
  const harsha = report.records.find(row => row.ccn === '154054');
  assert.equal(harsha.disposition, 'verified-current-mrf');
  assert.equal(harsha.mrf_state, 'verified-current-v3');
  assert.equal(harsha.cms_template_version, '3.0.0');
  assert.equal(harsha.mrf_http_status, '206');
  assert.equal(harsha.pointer_corpus_sha256, '222dcb74372039e9547d1eb6ffd1878dba4ab3b7844538a14c15abdc945a33e4');
  assert.equal(after.get('154054').finding, 'compliant-observed');
  assert.equal(after.get('154054').checked_at, '2026-09-30T17:58:31.495Z');
  const smith = report.records.find(row => row.ccn === '250786');
  assert.equal(smith.disposition, 'pointer-facility-match-unresolved');
  assert.equal(smith.mrf_url, '');
  assert.match(smith.next_action, /Do not assign the Covington County Hospital pointer entry or Collins CSV/);
  assert.equal(after.get('250786').finding, 'not-assessed-nationwide-pointer-facility-match-unresolved');
  assert.equal(after.get('250786').domain, 'covingtoncountyhospital.com');
  assert.equal(after.get('250786').pointer_url, '', 'the sibling pointer is not presented as facility-linked');
  assert.equal(after.get('250786').checked_at, smith.observed_at);
  assert.match(after.get('250786').evidence, /its hash is unchanged/);
  const covington = report.records.find(row => row.ccn === '251325');
  assert.equal(covington.disposition, 'verified-current-mrf');
  assert.equal(covington.cms_template_version, '3.0.0');
  assert.equal(covington.file_sample_bytes, 262144);
  assert.equal(covington.complete_file_validated, true);
  assert.equal(covington.full_file_bytes, 93493711);
  assert.equal(covington.full_file_sha256, '962080aef2ea163adfe3c9b9005cb35dcea20e801ab031b9495e3bcea8c74886');
  assert.equal(covington.cms_validator.requirements, 'v3.0');
  assert.equal(covington.cms_validator.valid, true);
  assert.equal(before.get('251325').finding, 'compliant-observed',
    'the full-file reviewed resolution applies independently of the nationwide overlay');
  assert.equal(after.get('251325').finding, 'compliant-observed');
  assert.equal(after.get('251325').assessable, 'yes');
  assert.equal(after.get('251325').mrf_url, covington.mrf_url);
  assert.equal(after.get('251325').cms_template_version, '3.0.0');
  assert.equal(after.get('251325').checked_at, covington.observed_at);
  assert.match(after.get('251325').evidence, /completely retrieved and structurally validated MRF/);
  assert.equal(covington.cms_validator.version, '1.10.8');
  const retainedCovington = retained.find(row => row.ccn === '251325');
  assert.equal(retainedCovington, undefined, 'the newly hash-bound complete-file evidence is the active observation');
  const unm = report.records.find(row => row.ccn === '320001');
  assert.equal(unm.disposition, 'verified-current-mrf');
  assert.equal(unm.observed_at, '2026-09-15T04:37:50.471Z');
  assert.equal(unm.standing_evidence_retained, false);
  for (const observation of retained) {
    if (observation.ccn === '251325') {
      assert.equal(after.get(observation.ccn).finding, 'compliant-observed');
      assert.equal(after.get(observation.ccn).assessable, 'yes');
      assert.equal(after.get(observation.ccn).mrf_url, observation.mrf_url);
      assert.equal(after.get(observation.ccn).cms_template_version, '3.0.0');
      assert.notDeepEqual(after.get(observation.ccn), before.get(observation.ccn),
        'new hash-bound full-file evidence corrects the stale pointer-unavailable label and supports current MRF verification');
      continue;
    }
    if (observation.ccn === '021310') {
      const restored = after.get(observation.ccn);
      assert.equal(restored.finding, 'compliant-observed');
      assert.equal(restored.checked_at, '2026-09-17T22:46:18.139Z');
      assert.equal(restored.mrf_url, observation.mrf_url);
      assert.equal(restored.cms_template_version, '3.0.0');
      assert.match(restored.evidence, /reconciliation-maniilaq-browser-byte-identity-proof-2026-09-17/);
      assert.notDeepEqual(restored, before.get(observation.ccn),
        'validated reviewed pointer/file proof must restore the newer effective observation');
      const auditRecord = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-effective-audit.json'), 'utf8'))
        .records.find(row => row.ccn === observation.ccn);
      assert.equal(auditRecord.effective_reviewed_observation.latest_retry_observation
        ?.superseded_by_reviewed_pointer_file_identity, true);
      continue;
    }
    if (observation.ccn === '050007') {
      const restored = after.get(observation.ccn);
      assert.equal(restored.finding, 'compliant-observed');
      assert.equal(restored.checked_at, '2026-09-30T12:18:27Z');
      assert.equal(restored.mrf_url, observation.mrf_url);
      assert.equal(restored.cms_template_version, '3.0.0');
      assert.notDeepEqual(restored, before.get(observation.ccn),
        'fresh hash-matched pointer bytes and the exact bounded file header resolve the misattributed retry');
      const auditRecord = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-effective-audit.json'), 'utf8'))
        .records.find(row => row.ccn === observation.ccn);
      assert.equal(auditRecord.effective_reviewed_observation.disposition, 'verified-current-mrf');
      assert.equal(auditRecord.effective_reviewed_observation.overlay_source_proof_file,
        'reconciliation-sutter-050007-current-pointer-proof-2026-09-26.json');
      assert.equal(auditRecord.effective_reviewed_observation.latest_retry_observation
        ?.superseded_by_reviewed_current_pointer_file_identity, true);
      continue;
    }
    if (observation.ccn === '050008') {
      const restored = after.get(observation.ccn);
      assert.equal(restored.finding, 'compliant-observed');
      assert.equal(restored.checked_at, '2026-09-30T19:18:24.836Z');
      assert.equal(restored.mrf_url, observation.mrf_url);
      assert.equal(restored.cms_template_version, '3.0.0');
      assert.notDeepEqual(restored, before.get(observation.ccn),
        'the current full-file CMS v3 proof resolves the retained pointer/facility mismatch');
      const current = report.records.find(row => row.ccn === observation.ccn);
      assert.equal(current.disposition, 'verified-current-mrf');
      assert.equal(current.pointer_state, 'retrieved-facility-linked-manual-review');
      assert.equal(current.mrf_state, 'linked-file-retrieved-metadata-limited');
      assert.equal(current.file_sample_bytes, 18701332);
      assert.equal(current.file_sample_sha256,
        '9bd05245c6f66cb578e611e0ffa0a898c612fbe69d7ea422595448f685f33001');
      assert.equal(current.cms_template_version, '3.0.0');
      assert.match(current.next_action, /does not establish pricing-row usability or compliance/);
      continue;
    }
    if (observation.ccn === '051315') {
      const restored = after.get(observation.ccn);
      assert.equal(restored.finding, 'compliant-observed');
      assert.equal(restored.checked_at, '2026-09-30T13:15:40Z');
      assert.equal(restored.mrf_url, observation.mrf_url);
      assert.equal(restored.cms_template_version, '3.0.0');
      assert.notDeepEqual(restored, before.get(observation.ccn),
        'the complete hash-bound operator-alias pointer/file proof resolves the older incomplete retry');
      const auditRecord = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-effective-audit.json'), 'utf8'))
        .records.find(row => row.ccn === observation.ccn);
      assert.equal(auditRecord.effective_reviewed_observation.disposition, 'verified-current-mrf');
      assert.equal(auditRecord.effective_reviewed_observation.overlay_source_proof_file,
        'reconciliation-trinity-hospital-ccn-051315-pointer-alias-full-file-proof-2026-09-30.json');
      assert.equal(auditRecord.effective_reviewed_observation.latest_retry_observation
        ?.superseded_by_reviewed_operator_alias_pointer_file_identity, true);
      assert.equal(auditRecord.reconciliation.workstream, 'consistent');
      continue;
    }
    assert.deepEqual(after.get(observation.ccn), before.get(observation.ccn),
      `incomplete ${observation.disposition} observation must not alter retained tracker row ${observation.ccn}`);
    assert.equal(after.get(observation.ccn).finding, observation.prior_finding,
      `retained finding must remain visible for ${observation.ccn}`);
  }
});

test('Mary Greeley exact pointer linkage and failed range remain separate from file identity', () => {
  const root = path.resolve(__dirname, '../../..');
  const audit = path.join(root, 'data/hpt-audit');
  const corpus = csvToObjects(fs.readFileSync(path.join(root,
    'cms_data/hpt/pointer-corpus/cms_hpt_entries.csv'), 'utf8'));
  const proof = JSON.parse(fs.readFileSync(path.join(audit,
    'reconciliation-mary-greeley-current-pointer-recheck-2026-09-30.json'), 'utf8'));
  const row = corpus.find(item => item.pointer_sha256 === proof.root_pointer_observation.sha256
    && item.mrf_url === proof.root_pointer_observation.normalized_entry.mrf_url
    && item.matched_ccns.split('|').includes('160030'));
  assert.ok(row);
  assert.equal(row.location_name, 'Mary Greeley Medical Center');
  assert.equal(row.source_page_url,
    'https://www.mgmc.org/patients-visitors/billing-financial/estimates-charges/');
  const report = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-verification.json'), 'utf8'));
  const current = report.records.find(item => item.ccn === '160030');
  assert.equal(current.disposition, 'mrf-request-unsuccessful');
  assert.equal(current.mrf_http_status, '200');
  assert.equal(current.mrf_range_status ?? '', '');
  assert.equal(current.standing_evidence_retained, true);
  assert.notEqual(current.disposition, 'linked-mrf-header-unmatched');
  const priorFile = JSON.parse(fs.readFileSync(path.join(audit,
    'reconciliation-mary-greeley-current-file-proof.json'), 'utf8'));
  assert.equal(priorFile.page_file_sha256, proof.prior_complete_file_proof.sha256);
  assert.equal(priorFile.page_file_url, row.mrf_url);
  assert.equal(proof.bounded_mrf_recheck.body_bytes_read, 0);
});

test('UCSD Hillcrest page-linked proof keeps its exact bounded file evidence in nationwide review', () => {
  const manual = JSON.parse(fs.readFileSync(path.resolve(__dirname,
    '../../../data/hpt-audit/reconciliation-manual-access-observations.json'), 'utf8'));
  const proof = manual.records.find(row => row.ccn === '050025');
  const review = manualPageFileRecheck(proof);
  assert.ok(review);
  assert.equal(review.pointer_declared_mrf_url, proof.publisher_file_url);
  assert.equal(review.file_bytes, proof.publisher_file_sample_bytes);
  assert.equal(review.file_sha256, proof.publisher_file_sample_sha256);
  assert.equal(review.pointer_url, '');
  assert.equal(review.source_page_url, proof.official_pricing_page);
  assert.equal(review.manual_file_only, true);
  assert.equal(review.declared_address.split('|')[0], '200 West Arbor Dr, San Diego, CA 92103');
  assert.equal(review.declared_license_state, 'CA');
  assert.equal(review.declared_last_updated, '2026-04-01');
  assert.equal(review.cms_template_version, '3.0');
  assert.equal(review.manual_file_only, true);
  assert.equal(manualPageFileRecheck({ ...proof, publisher_file_sample_sha256: '' }), null);
  assert.equal(manualPageFileRecheck({ ...proof, publisher_file_sample_bytes: 0 }), null);
});

test('UHS page-file proofs preserve declared_version/date aliases for the CMS v3 currentness gate', () => {
  const root = path.resolve(__dirname, '../../..');
  const manual = JSON.parse(fs.readFileSync(path.join(root,
    'data/hpt-audit/reconciliation-manual-access-observations.json'), 'utf8'));
  const snapshot = JSON.parse(fs.readFileSync(path.join(root,
    'data/hpt-audit/nationwide-verification.json'), 'utf8'));
  for (const [ccn, expectedName] of [['154024', 'Valle Vista Health System'],
    ['154041', 'Bloomington Meadows Hospital']]) {
    const proof = manual.records.find(row => row.ccn === ccn && row.disposition === 'verified-current-mrf');
    const review = manualPageFileRecheck(proof);
    assert.ok(review);
    assert.equal(review.cms_template_version, '3.0.0');
    assert.equal(review.declared_last_updated, '2026-05-12');
    assert.equal(review.declared_hospital_name, expectedName);
    assert.equal(review.manual_file_only, true);
    const row = snapshot.records.find(item => item.ccn === ccn);
    assert.equal(row.disposition, 'verified-current-mrf');
    assert.equal(row.cms_template_version, '3.0.0');
    assert.equal(row.declared_last_updated, '2026-05-12');
  }
});

test('complete hash-bound 206 Sutter pointer evidence reconciles both distinct Alta Bates CCNs', () => {
  const root = path.resolve(__dirname, '../../..');
  const audit = path.join(root, 'data/hpt-audit');
  const manual = JSON.parse(fs.readFileSync(path.join(audit,
    'reconciliation-manual-access-observations.json'), 'utf8'));
  const snapshot = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-verification.json'), 'utf8'));
  for (const [ccn, address, city] of [['050043', '350 Hawthorne Avenue, Oakland, CA 94609', 'OAKLAND'],
    ['050305', '2450 Ashby Avenue, Berkeley, CA 94705', 'BERKELEY']]) {
    const proofFile = `reconciliation-sutter-${ccn}-current-pointer-file-proof-2026-09-29.json`;
    const proof = JSON.parse(fs.readFileSync(path.join(audit, proofFile), 'utf8'));
    const observation = manual.records.find(row => row.ccn === ccn && row.proof_file === proofFile);
    assert.ok(observation);
    assert.equal(observation.latest_pointer_recheck.pointer_http_status, 206);
    assert.equal(observation.latest_pointer_recheck.pointer_bytes,
      observation.latest_pointer_recheck.pointer_content_range.split('/')[1] * 1);
    assert.match(observation.latest_pointer_recheck.pointer_sha256, /^[a-f0-9]{64}$/);
    assert.equal(proof.primary_mrf.cms_template_version, '3.0.0');
    assert.equal(proof.primary_mrf.declared_address, address);
    assert.equal(proof.primary_mrf.declared_license_state, 'CA');
    assert.equal(proof.primary_mrf.declared_last_updated, '2026-04-01');
    const row = snapshot.records.find(item => item.ccn === ccn);
    assert.equal(row.disposition, 'verified-current-mrf');
    assert.equal(row.pointer_state, 'retrieved-facility-linked-manual-review');
    assert.equal(row.pointer_corpus_sha256, proof.pointer.sha256);
    assert.equal(row.cms_template_version, '3.0.0');
    assert.equal(row.declared_address, address);
    assert.equal(row.city, city);
  }
  const oakland = snapshot.records.find(item => item.ccn === '050043');
  const berkeley = snapshot.records.find(item => item.ccn === '050305');
  assert.notEqual(oakland.mrf_url, berkeley.mrf_url);
});

test('Athens-Limestone full page-linked MRF remains separate from its unresolved root-pointer link', () => {
  const root = path.resolve(__dirname, '../../..');
  const manual = JSON.parse(fs.readFileSync(path.join(root,
    'data/hpt-audit/reconciliation-manual-access-observations.json'), 'utf8'));
  const proof = manual.records.find(row => row.proof_file
    === 'reconciliation-athens-limestone-current-full-mrf-proof-2026-09-28.json');
  const review = manualPageFileRecheck(proof);
  assert.ok(review);
  assert.equal(review.manual_file_only, true);
  assert.equal(review.pointer_declared_mrf_url, proof.facility_file_url);
  assert.equal(review.file_bytes, 40443636);
  assert.equal(review.file_sha256, 'fdbfc862a544b51e5c72b75803ebddc9dce18441524fca105defd6481370b437');
  assert.equal(review.declared_hospital_name, 'HH HEALTH SYSTEM ATHENS LIMESTONE');
  assert.equal(review.declared_license_state, 'AL');
  assert.equal(review.cms_template_version, '3.0.0');
  assert.equal(review.attestation, true);

  const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/nationwide-verification.json'), 'utf8'));
  const row = snapshot.records.find(item => item.ccn === '010079');
  assert.equal(row.disposition, 'verified-current-mrf');
  assert.equal(row.mrf_state, 'page-linked-file-retrieved');
  assert.equal(row.mrf_url, proof.facility_file_url);
  assert.equal(row.pointer_state, 'request-or-tool-failure');
  assert.notEqual(row.pointer_state, 'retrieved-facility-linked');
  assert.match(row.next_action, /root pointer and alternate current CSV/);

  const crosswalk = JSON.parse(fs.readFileSync(path.join(root,
    'data/hpt-audit/reconciliation-891-baseline-member-roster-2026-09-27.json'), 'utf8'));
  assert.ok(crosswalk.current_crosswalk_ccns['active-verification-claim'].includes('010079'));
  assert.ok(!crosswalk.current_crosswalk_ccns['genuinely-unresolved'].includes('010079'));
});

test('Decatur Morgan current enrollment and full campus-file comparison corroborate only the Decatur CCN file', () => {
  const root = path.resolve(__dirname, '../../..');
  const manual = JSON.parse(fs.readFileSync(path.join(root,
    'data/hpt-audit/reconciliation-manual-access-observations.json'), 'utf8'));
  const proof = manual.records.find(row => row.ccn === '010085'
    && row.proof_file === 'reconciliation-decatur-morgan-current-enrollment-and-campus-file-proof-2026-09-28.json');
  const review = manualPageFileRecheck(proof);
  assert.ok(review);
  assert.equal(review.manual_file_only, true);
  assert.equal(review.manual_identity, 'corroborated');
  assert.equal(review.manual_disposition, 'verified-current-mrf');
  assert.equal(review.pointer_declared_mrf_url, proof.facility_file_url);
  assert.equal(review.file_bytes, 23746132);
  assert.equal(review.file_sha256, '618922e927d70b329765a00421fcc9fa25abf46522e1a1adddcf05de8a2f86d2');
  assert.equal(review.declared_location_name, 'DECATUR MORGAN HOSPITAL (ACU)|PARKWAY CAMPUS');
  assert.equal(review.declared_license_state, 'AL');
  assert.equal(review.cms_template_version, '3.0.0');

  const priorProof = manual.records.find(row => row.ccn === '010085'
    && row.proof_file === 'reconciliation-decatur-morgan-main-file-full-retrieval-scope-review-2026-09-28.json');
  assert.equal(manualPageFileRecheck(priorProof).manual_disposition, 'mrf-facility-identity-unresolved');
  assert.ok(Date.parse(proof.observed_at) > Date.parse(priorProof.observed_at));

  const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/nationwide-verification.json'), 'utf8'));
  const row = snapshot.records.find(item => item.ccn === '010085');
  assert.equal(row.disposition, 'verified-current-mrf');
  assert.equal(row.mrf_state, 'page-linked-file-retrieved');
  assert.equal(row.mrf_url, proof.facility_file_url);
  assert.equal(row.file_sample_bytes, 23746132);
  assert.equal(row.file_sample_sha256, '618922e927d70b329765a00421fcc9fa25abf46522e1a1adddcf05de8a2f86d2');
  assert.equal(row.facility_identity, 'corroborated-by-reviewed-browser-read');
  assert.equal(row.pointer_state, 'request-or-tool-failure');
  assert.match(row.next_action, /Parkway/);
  assert.ok(!snapshot.records.find(item => item.ccn === '010054'));

  const crosswalk = JSON.parse(fs.readFileSync(path.join(root,
    'data/hpt-audit/reconciliation-891-baseline-member-roster-2026-09-27.json'), 'utf8'));
  assert.ok(!crosswalk.current_crosswalk_ccns['genuinely-unresolved'].includes('010085'));
  assert.ok(crosswalk.current_crosswalk_ccns['active-verification-claim'].includes('010085'));
});

test('generic not-assessed crawl rows receive exact-CCN nationwide observations', () => {
  const row = { ccn: '370244', hospital_name: 'COUNCIL OAK COMPREHENSIVE HEALTHCARE', city: 'TULSA', state: 'OK', finding: 'not-assessed-domain-unknown', checked_at: '' };
  const record = { ccn: '370244', hospital_name: row.hospital_name, city: row.city, state: row.state,
    prior_finding: 'not-assessed-pointer-review', disposition: 'pointer-facility-match-unresolved',
    observed_at: '2026-09-15T09:15:40.3Z', latest_observation_superseded: false, standing_evidence_retained: false,
    pointer_reason: 'The exact CCN pointer/file identity remains unresolved.', next_action: 'Keep the sibling file excluded.' };
  const [result] = applyNationwideVerification([row], [record]);
  assert.equal(result.finding, 'not-assessed-nationwide-pointer-facility-match-unresolved');
  assert.equal(result.assessable, 'no');
  assert.match(result.evidence, /sibling file excluded/);
});

test('retained pointer bytes are checked against both crawl hash and length', () => {
  const state = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../cms_data/hpt/pointer-corpus/crawl-state.json')));
  const target = Object.values(state.targets).find(item => item.status === 'ok' && item.rawFile && item.sha256);
  const root = path.resolve(__dirname, '../../..');
  assert.equal(pointerRetainedBytesStatus(target, root, new Map()), 'hash-corroborated');
  assert.equal(pointerRetainedBytesStatus({ ...target, sha256: '0'.repeat(64) }, root, new Map()), 'hash-conflict');
  assert.equal(pointerRetainedBytesStatus({ ...target, bytes: Number(target.bytes) + 1 }, root, new Map()), 'hash-conflict');
  assert.equal(pointerRetainedBytesStatus({ ...target, rawFile: '../outside.txt' }, root, new Map()), 'raw-file-unavailable');
});

test('failed retry retains prior pointer bytes only as dated historical provenance', () => {
  const state = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../cms_data/hpt/pointer-corpus/crawl-state.json')));
  const target = state.targets['url:https://cvrmc.org/cms-hpt.txt'];
  const provenance = pointerCorpusProvenance(target);
  assert.equal(target.status, 'failed');
  assert.equal(provenance.corpus_sha256, undefined);
  assert.equal(provenance.historical_sha256, target.sha256);
  assert.equal(provenance.historical_observed_at, '2026-09-07T00:03:06.067Z');
  assert.equal(provenance.historical_raw_integrity, 'hash-corroborated');
  const versioned = pointerCorpusProvenance({ status: 'failed', input: target.input,
    lastSuccessful: { rawFile: target.rawFile, sha256: target.sha256, bytes: target.bytes,
      acceptedUrl: target.acceptedUrl, finalUrl: target.finalUrl,
      fetchedAt: '2026-09-07T00:03:06.067Z' } });
  assert.equal(versioned.historical_sha256, target.sha256);
  assert.equal(versioned.historical_raw_integrity, 'hash-corroborated');
});

test('effective disposition categories are exclusive and precedence-aware', () => {
  assert.equal(effectiveDispositionCategory({ disposition: 'verified-current-mrf', latest_observation_superseded: true }), 'superseded-by-reviewed-resolution');
  assert.equal(effectiveDispositionCategory({ disposition: 'mrf-verification-pending', standing_evidence_retained: true }), 'standing-evidence-retained');
  assert.equal(effectiveDispositionCategory({ disposition: 'linked-mrf-header-unmatched', supported_identity_uncertainty: true }), 'supported-identity-uncertainty');
  assert.equal(effectiveDispositionCategory({ disposition: 'verified-stale-mrf' }), 'active-verification-claim');
  assert.equal(effectiveDispositionCategory({ disposition: 'scope-exempt-federal' }), 'scope-exempt');
  assert.equal(effectiveDispositionCategory({ disposition: 'scope-exempt-indian-health-program' }), 'scope-exempt');
  assert.equal(effectiveDispositionCategory({ disposition: 'pointer-not-retrieved' }), 'genuinely-unresolved');
});

test('browser-rendered HTML does not supersede retained HTML pointer bytes', () => {
  const url = 'https://hospital.test/cms-hpt.txt';
  const pointer = { state: 'not-retrieved-from-checked-locations', reason: 'html-body-not-pointer', result: 'invalid' };
  const review = { status: 'retrieved', detail: 'Rendered pointer labels', observed_at: '2026-01-02T00:00:00Z' };
  const result = applyBrowserPointerObservation(pointer, { pointer_url: url }, new Map([[url, review]]));
  assert.equal(result.state, pointer.state);
  assert.equal(result.browser, review);
  assert.match(result.reason, /HTML page/);
});

test('unassigned retrieved pointers retain source provenance without becoming facility links', () => {
  const report = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../data/hpt-audit/nationwide-verification.json')));
  const rows = report.records.filter(row => row.pointer_state === 'retrieved-facility-match-unresolved'
    && !row.pointer_url && row.pointer_corpus_checked_url);
  assert.ok(rows.length > 0);
  assert.ok(rows.every(row => /^https?:\/\//.test(row.pointer_corpus_checked_url)
    && /^[a-f0-9]{64}$/.test(row.pointer_corpus_sha256) && row.pointer_corpus_observed_at));
  for (const ccn of ['214002', '214004', '214012', '214018']) {
    const row = rows.find(item => item.ccn === ccn);
    assert.equal(row.pointer_corpus_final_url, 'https://health.maryland.gov/wmhc/Pages/cms-hpt.txt');
    assert.equal(row.pointer_corpus_sha256, '459258c8920912eff1380ca2b337fe705a22dcb40095e995dc75a3d97c5e2e50');
  }
});

test('a dated manual pointer recheck is displayed without promoting exact-file usability', () => {
  const report = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../data/hpt-audit/nationwide-verification.json')));
  const row = report.records.find(item => item.ccn === '070006');
  assert.equal(row.pointer_state, 'retrieved-facility-linked-manual-review');
  assert.equal(row.pointer_url, 'https://www.stamfordhealth.org/cms-hpt.txt');
  assert.equal(row.pointer_url, row.pointer_corpus_checked_url);
  assert.equal(row.mrf_state, 'linked-file-transport-unresolved');
  assert.equal(row.disposition, 'pointer-linked-file-review-pending');
  assert.equal(row.declared_location_name, 'Stamford Hospital');
  assert.equal(row.declared_last_updated, '2026-04-01');
});

test('Las Encinas pointer-linked legacy CSV is imported without inventing missing CMS metadata', () => {
  const report = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../data/hpt-audit/nationwide-verification.json')));
  const manual = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../data/hpt-audit/reconciliation-manual-access-observations.json')))
    .records.find(item => item.ccn === '054078');
  const browserProof = JSON.parse(fs.readFileSync(path.resolve(__dirname,
    '../../../data/hpt-audit/reconciliation-aurora-las-encinas-current-price-page-browser-recheck-2026-09-30.json')));
  const row = report.records.find(item => item.ccn === '054078');
  assert.equal(row.pointer_state, 'retrieved-facility-linked-manual-review');
  assert.equal(row.pointer_url, 'https://www.lasencinashospital.com/cms-hpt.txt');
  assert.equal(row.pointer_result, '200');
  assert.equal(row.pointer_corpus_sha256, 'b32a0008f89c85d83ffde3a547392b2fd0a83701fc8ce96302ac167a4fcd268c');
  assert.equal(row.mrf_url, 'https://www.lasencinashospital.com/wp-content/uploads/2026/07/32-0039155_Aurora-Las-Encinas-LLC_standardcharges_1.csv');
  assert.equal(row.mrf_state, 'linked-file-retrieved-metadata-limited');
  assert.equal(row.mrf_http_status, '200');
  assert.equal(row.file_sample_bytes, 8394);
  assert.equal(row.file_sample_sha256, 'f83776cf9bb279af34c8e820fe1a5e10b6a5c4192b2521f02bdc02793f8e3402');
  assert.equal(row.disposition, 'pointer-linked-file-review-pending');
  assert.equal(row.declared_hospital_name, 'Aurora Las Encinas, LLC; dba Aurora Las Encinas Hospital');
  assert.equal(row.declared_address, '');
  assert.equal(row.declared_license_state, '');
  assert.equal(row.cms_template_version, '');
  assert.equal(browserProof.official_price_page.browser_result, 'rendered');
  assert.equal(browserProof.official_price_page.standard_charges_target, row.mrf_url);
  assert.equal(browserProof.linked_file_browser_attempt.browser_result, 'net::ERR_BLOCKED_BY_CLIENT');
  assert.equal(browserProof.linked_file_browser_attempt.new_bytes_recovered, false);
  assert.equal(browserProof.disposition_effect, 'none');
  assert.equal(manual.latest_official_page_browser_recheck_2026_09_30.observed_at, browserProof.observed_at);
  assert.match(manual.next_action, /Do not repeat the same current price page or linked CSV browser route/);
  assert.match(manual.next_action, /CMS 3\.0\.0/);

  const schemaReview = JSON.parse(fs.readFileSync(path.resolve(__dirname,
    '../../../data/hpt-audit/reconciliation-las-encinas-schema-review-access-2026-09-28.json')));
  assert.equal(schemaReview.alternate_route_retrieval.matches_prior_successful_full_file, true);
  assert.equal(schemaReview.alternate_route_retrieval.bytes, 8394);
  assert.equal(schemaReview.alternate_route_retrieval.sha256, row.file_sample_sha256);
  assert.equal(schemaReview.alternate_route_retrieval.csv_review.header_columns, 23);
  assert.equal(schemaReview.alternate_route_retrieval.csv_review.data_rows, 57);
  assert.equal(schemaReview.alternate_route_retrieval.csv_review.rows_with_price_values, 51);
  assert.equal(schemaReview.alternate_route_retrieval.csv_review.cms_3_0_metadata_present, false);
  assert.equal(schemaReview.disposition, row.disposition);
  assert.equal(schemaReview.unresolved_count_change, 0);
});

test('browser identity claims require per-facility file evidence rather than archive filenames', () => {
  const hospital = { name: 'THE MEDICAL CENTER AT FRANKLIN', address: '1100 BROOKHAVEN ROAD', state: 'KY' };
  const review = { identity: 'corroborated', status: 'retrieved', declared_hospital_name: 'The Medical Center at Franklin' };
  assert.equal(qualifyBrowserIdentity(review, hospital).identity_gate, 'file-address-not-recorded');
  assert.equal(qualifyBrowserIdentity({ ...review, declared_address: '1100 Brookhaven Rd Franklin KY 42134' }, hospital).identity, 'corroborated');
  assert.equal(qualifyBrowserIdentity({ ...review, declared_address: '1100_Brookhaven_Rd_Franklin_KY_42134' }, hospital).identity, 'corroborated');
  assert.equal(qualifyBrowserIdentity({ ...review, declared_address: '1501 S Dixie St Horse Cave KY 42749' }, hospital).identity, 'unverified');
  assert.equal(qualifyBrowserIdentity({ ...review, declared_address: '1100 Brookhaven Rd Franklin TN 42134' }, hospital).identity, 'unverified');
  assert.equal(qualifyBrowserIdentity(review, undefined).identity, 'unverified');
  assert.equal(review.identity, 'corroborated');
});

test('unsuccessful browser retrievals do not acquire file identity gates', () => {
  const review = { status: 'navigation-failed', identity: 'unresolved', observed_at: '2026-09-15T00:00:00Z' };
  const result = qualifyBrowserIdentity(review, { ccn: '010001', name: 'EXAMPLE HOSPITAL', address: '1 MAIN ST', state: 'AL' });
  assert.equal(result.identity_gate, undefined);
  assert.equal(result.status, 'navigation-failed');
  assert.equal(result.identity, 'unresolved');
});

test('a matched header keeps coherent metadata and date despite a browser observation', () => {
  const header = { mrf_address: '1009 W Green St, Hastings, MI 49058', mrf_last_updated: '2026-04-01', checked_at: '2026-09-15T09:29:56Z' };
  const selected = { best: header, review: [], linked: [header] };
  const result = selectedFileEvidence(selected, header, { status: 'retrieved', identity: 'corroborated',
    declared_address: 'different browser text', declared_last_updated: '2025-01-01', observed_at: '2026-09-16' });
  assert.equal(result.declared_address, header.mrf_address);
  assert.equal(result.declared_last_updated, header.mrf_last_updated);
  assert.equal(result.observed_at, header.checked_at);
});

test('reviewed address equivalence is bound to exact CCN, roster, file and observation', () => {
  const hospital = { ccn: '330100', name: 'NEW YORK EYE AND EAR INFIRMARY', address: '230 SECOND AVE', state: 'NY' };
  const review = { status: 'retrieved', identity: 'unresolved', declared_hospital_name: hospital.name, declared_address: '310 East 14th Street New York NY 10003',
    target: 'https://example.org/file.json', observed_at: '2026-09-15T09:00:00Z' };
  const address = { ccn: hospital.ccn, state: 'NY', roster_address: hospital.address, file_address: review.declared_address,
    mrf_url: review.target, browser_observed_at: review.observed_at, reviewed_on: '2026-09-15', source_url: 'https://example.org/contact', basis: 'Official mailing address and lobby.' };
  assert.equal(qualifyBrowserIdentity(review, hospital, address).identity, 'corroborated');
  assert.equal(qualifyBrowserIdentity(review, hospital, address).identity_gate, 'reviewed-file-address-equivalence');
  assert.equal(qualifyBrowserIdentity({ ...review, identity: 'conflicting' }, hospital, address).identity, 'conflicting');
  for (const change of [{ ccn: '330101' }, { state: 'NJ' }, { roster_address: 'OTHER' }, { file_address: 'OTHER' },
    { mrf_url: 'https://example.org/other.json' }, { browser_observed_at: '2026-09-14' }, { reviewed_on: '2026-09-14' }]) {
    assert.equal(qualifyBrowserIdentity(review, hospital, { ...address, ...change }).identity, 'unverified');
  }
});

test('browser-backed metadata cannot borrow missing fields from an unsuccessful header', () => {
  const header = { mrf_license_state: 'NY', mrf_last_updated: '2024-01-01' };
  const result = selectedFileEvidence({ best: null, review: [], linked: [header] }, header,
    { status: 'retrieved', identity: 'corroborated', declared_last_updated: '2026-04-01', observed_at: '2026-09-15' });
  assert.equal(result.metadata_source, 'reviewed-browser');
  assert.equal(result.declared_license_state, '');
  assert.equal(result.declared_last_updated, '2026-04-01');
});

test('target indexes reconcile accepted URLs, domains, and exact CCNs', () => {
  const target = {
    input: 'https://www.example.org/cms-hpt.txt',
    acceptedUrl: 'https://example.org/.well-known/cms-hpt.txt',
    finalUrl: 'https://example.org/other-hospital/cms-hpt.txt',
    sha256: 'a'.repeat(64),
    sourceDomains: ['www.example.org'], relatedCcns: ['010001'], status: 'ok', fetchedAt: '2026-09-15T00:00:00Z'
  };
  const indexes = buildTargetIndexes({ targets: { 'url:https://www.example.org/cms-hpt.txt': target } });
  assert.equal(indexes.urls.get('https://example.org/.well-known/cms-hpt.txt'), target);
  assert.equal(indexes.domains.get('example.org'), target);
  assert.equal(indexes.ccns.get('010001'), target);
  const observed = indexedPointerObservation({ ccn: '010001', domain: 'example.org', pointer_url: '' }, indexes, []);
  assert.equal(observed.state, 'retrieved-facility-match-unresolved');
  assert.equal(observed.corpus_checked_url, target.input);
  assert.equal(observed.corpus_final_url, target.finalUrl);
  assert.equal(observed.corpus_sha256, target.sha256);
  assert.equal(observed.corpus_observed_at, target.fetchedAt);
  const laterBrowser = applyBrowserPointerObservation(observed, { domain: 'example.org', pointer_url: target.input },
    new Map([[target.input, { status: 'retrieved', observed_at: '2026-09-16T00:00:00Z' }]]));
  assert.equal(laterBrowser.observed_at, '2026-09-16T00:00:00Z');
  assert.equal(laterBrowser.corpus_observed_at, target.fetchedAt);
  assert.equal(laterBrowser.corpus_sha256, target.sha256);
  const domainTarget = { ...target, input: 'example.org', acceptedUrl: 'https://example.org/cms-hpt.txt' };
  const domainIndexes = buildTargetIndexes({ targets: { 'domain:example.org': domainTarget } });
  assert.equal(indexedPointerObservation({ ccn: '010001', domain: 'example.org' }, domainIndexes, [])
    .corpus_checked_url, domainTarget.acceptedUrl);
});

test('selected file pointer provenance comes from its exact CCN entry, not a standing sibling pointer', () => {
  const wrongUrl = 'https://washington.example/cms-hpt.txt';
  const rightUrl = 'https://missouri.example/cms-hpt.txt';
  const fileUrl = 'https://missouri.example/current.json';
  const wrong = { input: wrongUrl, acceptedUrl: wrongUrl, finalUrl: wrongUrl,
    status: 'ok', fetchedAt: '2026-09-16', sha256: 'a'.repeat(64), relatedCcns: ['260085'] };
  const right = { input: rightUrl, acceptedUrl: rightUrl, finalUrl: rightUrl,
    status: 'ok', fetchedAt: '2026-09-15', sha256: 'b'.repeat(64), relatedCcns: ['260085'] };
  const indexes = buildTargetIndexes({ targets: { [`url:${wrongUrl}`]: wrong, [`url:${rightUrl}`]: right } });
  const row = { ccn: '260085', domain: 'washington.example', pointer_url: wrongUrl };
  const entries = [{ matched_ccns: '260085', pointer_url: rightUrl, mrf_url: fileUrl,
    pointer_sha256: right.sha256, record_status: 'ok' }];
  const observed = indexedPointerObservation(row, indexes, entries, fileUrl);
  assert.equal(observed.state, 'retrieved-facility-linked');
  assert.equal(observed.corpus_checked_url, rightUrl);
  assert.equal(observed.corpus_sha256, right.sha256);
  assert.equal(indexedPointerObservation(row, indexes, entries, 'https://other.example/file.json').state,
    'retrieved-facility-match-unresolved');
});

test('target indexes select newer successful pointer bytes, not insertion order or a later failed retry', () => {
  const url = 'https://example.org/cms-hpt.txt';
  const newer = { input: url, acceptedUrl: url, status: 'ok', fetchedAt: '2026-09-15T09:00:00Z',
    sha256: 'b'.repeat(64), sourceDomains: ['example.org'], relatedCcns: ['010001'] };
  const older = { ...newer, fetchedAt: '2026-09-07T09:00:00Z', sha256: 'a'.repeat(64) };
  const failed = { ...newer, status: 'failed', fetchedAt: '2026-09-16T09:00:00Z', sha256: '' };
  const indexes = buildTargetIndexes({ targets: {
    [`url:${url}`]: newer,
    'domain:example.org': older,
    'url:https://example.org/alternate-check': failed,
  } });
  for (const index of [indexes.urls.get(url), indexes.domains.get('example.org'), indexes.ccns.get('010001')]) {
    assert.equal(index.sha256, newer.sha256);
    assert.equal(index.fetchedAt, newer.fetchedAt);
  }
});

test('same-byte pointer aliases retain exact CCN attribution', () => {
  const root = 'https://providence.org/cms-hpt.txt';
  const alias = 'https://www.swedish.org/cms-hpt.txt';
  const file = 'https://files.example/st-mary.json';
  const hash = 'a'.repeat(64);
  const target = url => ({ input: url, acceptedUrl: url, finalUrl: url, status: 'ok', sha256: hash,
    fetchedAt: '2026-09-15T09:00:00Z' });
  const indexes = buildTargetIndexes({ targets: { [`url:${root}`]: target(root), [`url:${alias}`]: target(alias) } });
  const rows = [root, alias].map(pointer_url => ({ matched_ccns: '050300', pointer_url,
    pointer_sha256: hash, mrf_url: file, record_status: 'ok' }));
  const result = indexedPointerObservation({ ccn: '050300', domain: 'providence.org', pointer_url: root }, indexes, rows, file);
  assert.equal(result.state, 'retrieved-facility-linked');
  assert.equal(result.corpus_checked_url, root);
  assert.equal(result.corpus_sha256, hash);
});

test('browser observations keep rendered absence distinct from client blocking', () => {
  const row = { pointer_url: 'https://example.org/cms-hpt.txt' };
  const base = { state: 'request-or-tool-failure', observed_at: '2026-09-14', result: 'failed', reason: 'neterr' };
  const missing = applyBrowserPointerObservation(base, row, new Map([['https://example.org/cms-hpt.txt', {
    status: 'http-not-found', observed_at: '2026-09-15', title: '404 Not Found'
  }]]));
  assert.equal(missing.state, 'not-retrieved-from-checked-locations');
  assert.equal(missing.browser.status, 'http-not-found');
  const blocked = applyBrowserPointerObservation(base, row, new Map([['https://example.org/cms-hpt.txt', {
    status: 'browser-client-blocked', observed_at: '2026-09-15'
  }]]));
  assert.equal(blocked.state, 'request-or-tool-failure');
});

test('later browser blocking cannot erase hash-corroborated structured pointer bytes', () => {
  const url = 'https://example.org/cms-hpt.txt';
  const pointer = { state: 'retrieved-facility-match-unresolved', observed_at: '2026-09-15T09:00:00Z',
    result: 'ok', corpus_raw_integrity: 'hash-corroborated', corpus_sha256: 'a'.repeat(64) };
  const blocked = applyBrowserPointerObservation(pointer, { pointer_url: url }, new Map([[url, {
    status: 'browser-client-blocked', observed_at: '2026-09-15T12:00:00Z'
  }]]));
  assert.equal(blocked.state, pointer.state);
  assert.equal(blocked.observed_at, pointer.observed_at);
  assert.equal(blocked.corpus_sha256, pointer.corpus_sha256);
  assert.equal(blocked.browser.status, 'browser-client-blocked');
});

test('verified metadata states remain distinct from access and identity states', () => {
  const selected = { best: { pointer_sha256s: 'a'.repeat(64), mrf_last_updated: '2026-03-04',
    mrf_days_since_update: '197', mrf_cms_version: '3.0.0' }, review: [], linked: [] };
  const newerPointer = { corpus_raw_integrity: 'hash-corroborated', corpus_sha256: 'b'.repeat(64) };
  assert.equal(disposition({}, newerPointer, selected)[0], 'selected-file-only-in-earlier-pointer-version');
  assert.equal(disposition({}, newerPointer, selected, null, true)[0], 'verified-current-mrf');
  assert.equal(metadataState({ mrf_last_updated: '2026-01-01', mrf_days_since_update: '20', mrf_cms_version: '3.0.0' }), 'verified-current-v3');
  assert.equal(metadataState({ mrf_last_updated: '2026-01-01', mrf_days_since_update: '20', mrf_cms_version: '3.0' }), 'verified-current-v3');
  for (const version of ['3.0,0', '3.0.1', '3.0.2', '4.0.0']) {
    assert.equal(metadataState({ mrf_last_updated: '2026-01-01', mrf_days_since_update: '20', mrf_cms_version: version }), 'verified-older-or-unresolved-template');
  }
  for (const version of ['3', '3.00']) assert.equal(metadataState({ mrf_last_updated: '2026-01-01', mrf_days_since_update: '20', mrf_cms_version: version }), 'verified-older-or-unresolved-template');
  assert.equal(metadataState({ mrf_last_updated: '2024-01-01', mrf_days_since_update: '600', mrf_cms_version: '3.0' }), 'verified-stale-date');
  assert.equal(metadataState({ mrf_last_updated: '2026-01-01', mrf_days_since_update: '20', mrf_cms_version: '2.0' }), 'verified-older-or-unresolved-template');
  assert.equal(metadataState({ mrf_last_updated: '', mrf_days_since_update: '', mrf_cms_version: '2' }), 'verified-older-or-unresolved-template');
  assert.equal(metadataState({ mrf_last_updated: '', mrf_days_since_update: '', mrf_cms_version: '' }), 'metadata-unresolved');
  assert.equal(disposition({}, { state: 'access-denied-or-rate-limited-to-client' }, { best: null, review: [], linked: [] })[0],
    'pointer-access-denied-to-client');
  assert.equal(disposition({ website_review: 'candidate' }, { state: 'not-assessed-no-official-domain' }, { best: null, review: [], linked: [] })[0],
    'candidate-website-identity-unverified');
  assert.equal(disposition({ website_review: 'completed-no-official' }, { state: 'not-assessed-no-official-domain' }, { best: null, review: [], linked: [] })[0],
    'official-website-not-identified-completed-search');
  assert.equal(disposition({}, { state: 'retrieved-facility-linked' }, {
    best: null, review: [], linked: [{ mrf_range_status: '' }]
  }, { status: 'retrieved' })[0], 'mrf-verification-pending');
  assert.equal(disposition({}, { state: 'retrieved-facility-linked' }, {
    best: null, review: [], linked: [{ mrf_range_status: '' }]
  }, {
    status: 'retrieved', identity: 'corroborated',
    declared_last_updated: '2026-07-20', cms_template_version: '3.0.0'
  })[0], 'verified-current-mrf');
  assert.equal(disposition({}, { state: 'retrieved-facility-linked' }, {
    best: null, review: [], linked: [{ mrf_range_status: '' }]
  }, { status: 'navigation-failed', identity: 'conflicting' })[0], 'mrf-facility-identity-unresolved');
  assert.equal(disposition({}, { state: 'retrieved-facility-linked' }, {
    best: null, review: [], linked: [{ mrf_http_status: '200', mrf_range_status: '',
      match_reason: 'mrf-header-unreachable', range_error: 'socket hang up' }]
  })[0], 'mrf-request-unsuccessful',
  'a successful HEAD without bounded body bytes cannot be called a header identity mismatch');
});

test('dated closed-facility status remains a distinct scope exemption', () => {
  assert.deepEqual(disposition({ finding: 'not-applicable-closed' }, {}, { best: null, review: [], linked: [] }), [
    'scope-exempt-closed',
    'Hospital closure is supported by dated official evidence; recheck only if hospital operations resume.'
  ]);
});

test('Indian Health Program scope exception maps separately from federal ownership', () => {
  assert.deepEqual(disposition({ finding: 'not-applicable-indian-health-program' }, {}, { best: null, review: [], linked: [] }), [
    'scope-exempt-indian-health-program',
    'Current evidence identifies an Indian Health Program-operated hospital; retain the 45 CFR 180.30(b)(2) scope classification unless operator or program status changes.'
  ]);
});

test('state-hospital scope maps to a distinct non-MRF exemption', () => {
  assert.deepEqual(disposition({ finding: 'not-applicable-state-hospital' }, {}, { best: null, review: [], linked: [] }), [
    'scope-exempt-state-hospital',
    'Current exact-facility state-hospital evidence supports the federal deemed-compliant scope classification under 45 CFR 180.30(b); revisit if the CCN, operator, or legal status changes.'
  ]);
});

test('choose never promotes a merely linked or review candidate to verified', () => {
  const linked = { existing_matched_ccns: '010001', review_ccns: '', header_matched_ccns: '', checked_at: '2026-09-15' };
  const review = { existing_matched_ccns: '010001', review_ccns: '010001', header_matched_ccns: '', checked_at: '2026-09-15' };
  const selected = choose([linked, review], '010001');
  assert.equal(selected.best, null);
  assert.equal(selected.review.length, 1);
  assert.equal(selected.linked.length, 2);
});

test('same-date exact facility name beats a later-probed address-only sibling', () => {
  const henderson = { header_matched_ccns: '440008', mrf_hospital_name: 'Henderson County Community Hospital',
    mrf_last_updated: '2026-06-30', mrf_days_since_update: '77', mrf_cms_version: '3.0.0',
    checked_at: '2026-09-15T04:35:30Z' };
  const houston = { ...henderson, mrf_hospital_name: 'Houston County Community Hospital',
    checked_at: '2026-09-15T04:37:20Z' };
  assert.equal(choose([houston, henderson], '440008', 'HENDERSON COUNTY COMMUNITY HOSPITAL').best, henderson);
  assert.equal(choose([houston, henderson], '440008').best, houston);
});

test('linked files cannot lend another facility identity gate to the current CCN', () => {
  const linked = { existing_matched_ccns: '010001', header_matched_ccns: '010002',
    identity_gate: 'exact-pointer-ccn-file-address-agree', match_reason: 'mrf-header-identity-and-location-agree' };
  assert.deepEqual(headerEvidenceForSelection({ best: null, review: [], linked: [linked] }, linked, '010001'), {
    identity_gate: '', match_reason: 'linked-file-matched-different-facility'
  });
  const unreachable = { existing_matched_ccns: '010001', header_matched_ccns: '', match_reason: 'mrf-header-unreachable' };
  assert.deepEqual(headerEvidenceForSelection({ best: null, review: [], linked: [unreachable] }, unreachable, '010001'), {
    identity_gate: '', match_reason: 'mrf-header-unreachable'
  });
  assert.deepEqual(headerEvidenceForSelection({ best: linked, review: [], linked: [linked] }, linked, '010002'), {
    identity_gate: 'exact-pointer-ccn-file-address-agree', match_reason: 'mrf-header-identity-and-location-agree'
  });
});
