'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const audit = path.resolve(__dirname, '../../../data/hpt-audit');
const campusProof = require(path.join(audit,
  'reconciliation-uw-swedishamerican-campus-scope-crosscheck-2026-09-29.json'));

test('Rockford exact pointer and page-file linkage are retained without overclaiming full-file or campus verification', () => {
  const observations = require(path.join(audit, 'reconciliation-manual-access-observations.json')).records;
  const observation = observations.find(row => row.ccn === '140228' && row.pointer_corpus_entry);
  const pageFileReview = observations.find(row => row.ccn === '140228'
    && row.latest_official_page_file_recheck_2026_09_25);
  assert.ok(observation);
  assert.equal(observation.pointer_corpus_entry.facility_entry, 'SwedishAmerican Hospital');
  assert.match(observation.official_identity_observation, /1401 East State Street, Rockford, IL/);
  assert.equal(observation.pointer_corpus_entry.sha256, 'b1024eaebfa285feb003c15fdf092ea881601f8e0a984925cf3da9b3e3b16363');
  assert.equal(observation.pointer_corpus_entry.facility_entry, 'SwedishAmerican Hospital');
  assert.equal(observation.pointer_corpus_entry.mrf_url,
    'https://bynder.uwhealth.org/m/1d39d4b3bd3ce8bb/original/362222696_SwedishAmerican-Hospital_standardcharges.csv');
  assert.equal(observation.pointer_corpus_entry.bynder_object_id, '1d39d4b3bd3ce8bb');
  assert.match(observation.pointer_corpus_entry.official_page_file_url_alias,
    /\/m\/1d39d4b3bd3ce8bb\/original\/UW-Health-SwedishAmerican-Hospital-Standard-Charges\.csv$/);
  assert.match(observation.pointer_corpus_entry.url_relationship, /Different filename aliases/);
  assert.equal(observation.pointer_browser_observation.byte_count_recorded, false);
  assert.match(observation.interpretation, /pointer\/page-file object linkage is supported/);
  assert.match(pageFileReview.latest_official_page_file_recheck_2026_09_25.result, /Belvidere is not assigned/);
  assert.match(observation.next_action, /do not assign Belvidere to this CCN/);
  assert.match(observation.next_action, /full-file or publisher validation/);
  assert.doesNotMatch(observation.next_action, /Recover fresh pointer and file bytes/);
  const queue = require(path.join(audit, 'unresolved-investigation-worklist.json')).records
    .find(row => row.ccn === '140228');
  assert.ok(queue.reviewed_sources.includes('manual-access'));
  assert.match(queue.next_action, /full-file\/schema\/usability validation/);
  const verification = require(path.join(audit, 'nationwide-verification.json')).records
    .find(row => row.ccn === '140228');
  assert.equal(verification.mrf_url || '', '');
  assert.equal(campusProof.ccn, '140228');
  assert.equal(campusProof.current_cms_hospital_general_information.row.address, '1401 EAST STATE STREET');
  assert.equal(campusProof.current_cms_hospital_general_information.row.citytown, 'ROCKFORD');
  assert.equal(campusProof.illinois_hospital_report_card_legacy_entity.row.closed_date, '2023-04-20');
  assert.equal(campusProof.illinois_hospital_report_card_legacy_entity.row.mpn_id, null);
  assert.equal(campusProof.illinois_hfsrb_2026_facility_inventory.facility_rows[1].name,
    'SwedishAmerican Hospital - DBA UW Health Belvidere Hospital');
  assert.equal(campusProof.illinois_hfsrb_2026_facility_inventory.facility_rows[1].authorized_beds, 34);
  assert.equal(campusProof.count_effect, 0);
  assert.match(campusProof.next_action, /current CMS enrollment or certification crosswalk/);
  const newest = observations.filter(row => row.ccn === '140228' && row.proof_file ===
    'reconciliation-uw-swedishamerican-campus-scope-crosscheck-2026-09-29.json');
  assert.equal(newest.length, 1);
  assert.match(newest[0].interpretation, /No evidence here links Belvidere to CCN 140228/);
  const browserReview = require(path.join(audit, 'nationwide-browser-reviews.json')).records
    .find(row => row.kind === 'official-current-operator-and-state-campus-scope-crosscheck' && row.ccn === '140228');
  assert.ok(browserReview);
  assert.match(browserReview.status, /successor-scope-unresolved/);
  assert.equal(browserReview.proof_file, campusProof.audit_id + '.json');
});

test('Bakersfield public directory crosscheck is retained as corroboration, not MRF attribution', () => {
  const proof = require(path.join(audit,
    'reconciliation-adventist-bakersfield-public-directory-crosscheck-2026-09-29.json'));
  assert.equal(proof.disposition_changed, false);
  assert.equal(proof.count_effect, 0);
  assert.match(proof.evidence_classification, /third-party directory corroboration/);
  assert.match(proof.next_action, /authoritative written publisher documentation/);
  const observations = require(path.join(audit, 'reconciliation-manual-access-observations.json')).records;
  const bakersfield = observations.find(row => row.ccn === '050455'
    && row.latest_public_directory_crosscheck_2026_09_29);
  assert.equal(bakersfield.latest_public_directory_crosscheck_2026_09_29.proof_file,
    proof.audit_id + '.json');
  const browser = require(path.join(audit, 'nationwide-browser-reviews.json')).records
    .find(row => row.proof_file === proof.audit_id + '.json');
  assert.ok(browser);
  assert.equal(browser.file_sha256, proof.comparison_to_retained_mrf.complete_file_sha256);
  assert.match(browser.status, /third-party-directory/);
});
