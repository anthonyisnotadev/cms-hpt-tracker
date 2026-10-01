'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const audit = path.resolve(__dirname, '../../../data/hpt-audit');
const read = name => JSON.parse(fs.readFileSync(path.join(audit, name), 'utf8'));

test('dated Oregon state-license proof distinguishes satellite relationship from Medicare CCN status', () => {
  const proof = read('reconciliation-asante-ashland-state-license-proof.json');
  assert.deepEqual(proof.ccns, ['380005', '380018']);
  for (const document of [proof.licensed_hospitals, proof.licensed_satellites]) {
    assert.equal(document.file_updated_on, '2026-07-30');
    assert.match(document.sha256, /^[a-f0-9]{64}$/);
    assert.ok(document.bytes > 0 && document.bytes < 1000000);
    assert.match(document.url, /^https:\/\/www\.oregon\.gov\/.*\.pdf$/);
  }
  assert.match(proof.licensed_satellites.satellite, /14-0451-8.*280 Maple Street/);
  assert.match(proof.licensed_hospitals.observation, /not a Medicare CCN termination record/);
  const rows = new Map(read('nationwide-reconciliation.json').records.map(row => [row.ccn, row]));
  const former = rows.get('380005'), parent = rows.get('380018');
  assert.equal(former.workstream, 'genuinely-unresolved-investigation');
  assert.equal(parent.standing_finding, 'compliant-observed');
  assert.equal(parent.workstream, 'standing-evidence-follow-up');
  assert.match(former.next_action, /Q2 2026 QIES record is the later status evidence/);
  assert.match(former.next_action, /unresolved only for HPT file coverage/);
  assert.match(parent.next_action, /Asante Ashland satellite coverage/);
  assert.notEqual(former.standing_mrf_url, parent.standing_mrf_url);
  assert.equal(proof.cms_live_api_pair_recheck.records.length, 2);
  const api = new Map(proof.cms_live_api_pair_recheck.records.map(row => [row.ccn, row]));
  assert.equal(api.get('380005').practice_location_type, 'OTHER HOSPITAL PRACTICE LOCATION');
  assert.equal(api.get('380018').practice_location_type, 'MAIN/PRIMARY HOSPITAL LOCATION');
  assert.match(proof.cms_live_api_pair_recheck.interpretation, /no effective termination date/);
  const standing = read('standing-evidence-followup-worklist.json').records.find(row => row.ccn === '380018');
  assert.equal(standing.next_action, parent.manual_access_observation.next_action);
});

test('third-party Asante MRF index lead is retained without importing prices or changing CCN scope', () => {
  const proof = read('reconciliation-asante-ashland-third-party-mrf-index-recheck-2026-09-28.json');
  const manual = read('reconciliation-manual-access-observations.json').records.find(row => row.ccn === '380005');
  const newest = manual.latest_third_party_mrf_index_recheck_2026_09_28;
  assert.equal(newest.proof_file, 'reconciliation-asante-ashland-third-party-mrf-index-recheck-2026-09-28.json');
  assert.equal(proof.third_party_index_observation.raw_file_link_target, newest.download_link_target);
  assert.equal(proof.third_party_index_observation.link_target_is_publisher_hosted, true);
  assert.match(proof.retrieval_attempts[0].content_type_limitation, /unsupported content-type/);
  assert.equal(proof.retrieval_attempts[1].result, 'net::ERR_BLOCKED_BY_CLIENT');
  assert.equal(proof.disposition_effect, 'none; preserve CCN 380005 as unresolved for post-transition CMS status and shared-file content/scope; do not import third-party prices or infer closure, compliance, or MRF identity.');
  const reconciled = read('nationwide-reconciliation.json').records.find(row => row.ccn === '380005');
  assert.equal(reconciled.workstream, 'genuinely-unresolved-investigation');
  assert.match(reconciled.next_action, /unresolved only for HPT file coverage/);
  assert.match(reconciled.next_action, /combined Asante ZIP/);
  assert.match(proof.next_action, /genuinely separate byte-serving source/);
});

test('third-party 340B termination date does not substitute for CMS hospital status or MRF proof', () => {
  const triage = read('reconciliation-asante-ashland-cms-termination-notice-triage-2026-09-29.json');
  assert.equal(triage.ccn, '380005');
  assert.equal(triage.trigger.claimed_340b_termination_date, '2026-07-01');
  assert.equal(triage.cms_hospital_enrollment_exact_ccn_recheck.exact_ccn_rows, 1);
  assert.equal(triage.cms_hospital_enrollment_exact_ccn_recheck.response_sha256,
    '4e39e5eb60ac3e3f168518ce7a5f7298dec645606db8b00e75e3b12fca639a57');
  assert.equal(triage.cms_public_termination_notices.exact_matches, 0);
  const qies = triage.cms_qies_q2_2026_exact_ccn_record;
  assert.equal(qies.exact_provider_rows, 1);
  assert.equal(qies.dataset_temporal_coverage_end, '2026-06-30');
  assert.equal(qies.record.program_termination_code, '00');
  assert.equal(qies.record.termination_or_expiration_date, '');
  assert.match(qies.code_interpretation, /ACTIVE PROVIDER/);
  assert.equal(triage.evidence_accounting.new_primary_mrf_bytes, 0);
  assert.equal(triage.evidence_accounting.hpt_disposition_effect, 'none');
  assert.equal(triage.evidence_accounting.cohort_count_effect, 0);

  const manual = read('reconciliation-manual-access-observations.json').records.find(row => row.ccn === '380005');
  assert.equal(manual.latest_cms_termination_notice_triage_2026_09_29.disposition_effect, 'none');
  const reconciliation = read('nationwide-reconciliation.json').records.find(row => row.ccn === '380005');
  assert.equal(reconciliation.workstream, 'genuinely-unresolved-investigation');
});
