'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseSections } = require('../audit-omh-multisection-file');

const root = path.resolve(__dirname, '../../..');
const auditDir = path.join(root, 'data/hpt-audit');
const read = name => JSON.parse(fs.readFileSync(path.join(auditDir, name), 'utf8'));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const proofFile = 'reconciliation-creedmoor-current-enrollment-address-proof-2026-09-27.json';
const resolutionRun = 'creedmoor-current-cms-enrollment-address-crosswalk-2026-09-27';

test('current CMS enrollment, OMH main campus and named shared-MRF section reconcile Creedmoor CCN 334004', () => {
  const proof = read(proofFile);
  const cms = proof.current_cms_hospital_enrollment;
  const enrollment = JSON.parse(cms.response_body)[0];
  assert.equal(hash(Buffer.from(cms.response_body, 'utf8')), cms.response_sha256);
  assert.equal(Buffer.byteLength(cms.response_body, 'utf8'), cms.response_bytes);
  assert.equal(enrollment.CCN, proof.ccn);
  assert.equal(enrollment.NPI, '1194889097');
  assert.equal(enrollment['DOING BUSINESS AS NAME'], 'CREEDMOOR PSYCHIATRIC CENTER');
  assert.equal(enrollment['ADDRESS LINE 1'], '79-25 WINCHESTER BOULEVARD');
  assert.equal(enrollment.STATE, 'NY');
  assert.equal(enrollment['SUBGROUP - PSYCHIATRIC'], 'Y');

  const pointerPath = path.join(root, 'cms_data/hpt/pointer-corpus/raw/omh.ny.gov-5b73748273a2.txt');
  const pointer = fs.readFileSync(pointerPath);
  const expected = proof.retained_pointer_and_mrf;
  assert.equal(hash(pointer), expected.pointer_sha256);
  assert.match(pointer.toString('utf8'), /location-name: Creedmoor/);
  assert.ok(pointer.toString('utf8').includes(`mrf-url: ${expected.pointer_mrf_url}`));
  const fullFile = fs.readFileSync(path.join(auditDir, '.domain-discovery/reconciliation/omh-shared/file.bin'));
  assert.equal(hash(fullFile), expected.mrf_full_file_sha256);
  const section = parseSections(fullFile).find(item => item.section_name === expected.mrf_section_name);
  assert.ok(section);
  assert.equal(section.address, expected.mrf_section_address);
  assert.equal(section.version, expected.mrf_version);
  assert.equal(section.license_state, 'NY');
  assert.equal(section.attestation, true);
  assert.equal(section.data_rows, 88);
  assert.equal(section.usable_gross_charge_rows, 88);
  assert.ok(section.declared_npis.includes(enrollment.NPI));

  assert.match(proof.official_omh_browser_observations[0].observation, /79-25 Winchester.*inpatient hospitalization is at its main campus/);
  assert.match(proof.official_omh_browser_observations[1].observation, /80-45 Winchester Boulevard, Building 73.*outpatient site/);
  assert.match(proof.resolution.scope_limit, /not a legal compliance conclusion/);
  assert.match(proof.resolution.scope_limit, /source-record variation/);
});
test('Creedmoor reviewed resolution is applied without losing the historical address-conflict provenance', () => {
  const proof = read(proofFile);
  const resolutions = read('reviewed-resolutions.json');
  const resolution = resolutions.find(item => item.ccn === '334004');
  assert.ok(resolution);
  assert.equal(resolution.evidence_run, resolutionRun);
  assert.equal(resolution.action, 'replace');
  assert.equal(resolution.finding, 'verified-current-mrf');
  assert.equal(resolution.evidence.url, proof.retained_pointer_and_mrf.pointer_mrf_url);
  assert.equal(resolution.evidence.fileSha256, proof.retained_pointer_and_mrf.mrf_full_file_sha256);
  assert.equal(resolution.evidence.cmsRosterResponseSha256, proof.current_cms_hospital_enrollment.response_sha256);
  assert.equal(resolution.evidence.cmsGeneralInformationAddressVariation,
    proof.prior_conflict.cms_hospital_general_information_address);

  const manual = read('reconciliation-manual-access-observations.json').records
    .filter(item => item.ccn === '334004')
    .sort((a, b) => Date.parse(b.observed_at || '') - Date.parse(a.observed_at || ''));
  assert.equal(manual[0].proof_file, proofFile);
  assert.equal(manual[0].disposition, 'verified-current-mrf-cms-enrollment-main-campus-crosswalk');
  assert.equal(manual[1].proof_file, 'reconciliation-omh-multisection-file-audit-2026-09-27.json');
  assert.equal(manual[1].disposition, 'file-address-conflict-cms-roster');

  const current = read('nationwide-reconciliation.json').records.find(item => item.ccn === '334004');
  assert.equal(current.workstream, 'consistent');
  assert.deepEqual(current.issues, []);
  assert.equal(current.latest_observation_superseded, true);
  assert.equal(current.standing_mrf_url, proof.retained_pointer_and_mrf.pointer_mrf_url);
  assert.equal(current.superseding_resolution.evidence_run, resolutionRun);

  const html = fs.readFileSync(path.join(root, 'tracker.html'), 'utf8');
  const marker = '<script id="tracker-data" type="application/json">';
  const start = html.indexOf(marker);
  const end = html.indexOf('</script>', start + marker.length);
  const tracker = JSON.parse(html.slice(start + marker.length, end));
  const trackerRow = tracker.rows.find(row => row[0] === '334004');
  assert.equal(trackerRow[8], proof.retained_pointer_and_mrf.pointer_mrf_url);
  assert.equal(trackerRow[13], '2026-05-28');
  assert.match(trackerRow[10], /79-25 main-campus address/);

  const worklist = read('unresolved-investigation-worklist.json');
  assert.ok(!worklist.records.some(item => item.ccn === '334004'));
  const roster = read('reconciliation-891-baseline-member-roster-2026-09-27.json');
  assert.ok(!roster.current_crosswalk_ccns['genuinely-unresolved'].includes('334004'));
  assert.ok(roster.current_crosswalk_ccns['superseded-by-reviewed-resolution'].includes('334004'));
  assert.equal(roster.summary.current_effective_categories['genuinely-unresolved'], 541);
  assert.equal(roster.summary.current_effective_categories['superseded-by-reviewed-resolution'], 70);
  assert.equal(roster.summary.category_membership_sum, 891);
  assert.equal(roster.summary.unique_ccns, 720);
  assert.equal(roster.summary.overlap_ccns, 171);
});
