'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('Alpena keeps the affiliate file separate from its first-party publisher lead', () => {
  const observation = require(path.join(audit, 'reconciliation-manual-access-observations.json')).records
    .find(row => row.ccn === '230036');
  assert.ok(observation);
  assert.match(observation.official_pricing_page_file_url, /mymichigan-medical-center-alpena_standardcharges\.csv$/);
  assert.equal(observation.pointer_direct_status, 403);
  assert.equal(observation.page_file_direct_status, 403);
  assert.match(observation.next_action, /Do not promote the U-M Health Ann Arbor file/);
  const row = loadReviewedView(audit).compliance.find(item => item.ccn === '230036');
  assert.equal(row.mrf_url, '');
  assert.notEqual(row.finding, 'compliant-observed');
  const work = require(path.join(audit, 'unresolved-investigation-worklist.json')).records
    .find(item => item.ccn === '230036');
  assert.equal(work.reviewed_follow_up, true);
  assert.equal(work.publisher_domain_lead, 'mymichigan.org');
  assert.equal(work.candidate_file_recorded, true);
  assert.ok(work.reviewed_sources.includes('manual-access'));
  assert.match(work.next_action, /MyMichigan root pointer/);
});

test('three former Ascension Michigan CCNs retain distinct current-publisher leads without file promotion', () => {
  const observations = require(path.join(audit, 'reconciliation-manual-access-observations.json')).records;
  const worklist = require(path.join(audit, 'unresolved-investigation-worklist.json')).records;
  const standing = loadReviewedView(audit).compliance;
  for (const [ccn, campus] of [['230077', 'saginaw'], ['230100', 'tawas'], ['231305', 'standish']]) {
    const observation = observations.find(row => row.ccn === ccn);
    const work = worklist.find(row => row.ccn === ccn);
    const row = standing.find(item => item.ccn === ccn);
    assert.ok(observation, ccn);
    assert.equal(observation.publisher_domain_lead, 'mymichigan.org');
    assert.match(observation.official_pricing_page_file_url, new RegExp(`mymichigan-medical-center-${campus}_standardcharges\\.csv$`));
    assert.equal(observation.pointer_direct_status, 403);
    assert.equal(observation.page_file_direct_status, 403);
    assert.equal(work.reviewed_follow_up, true);
    assert.equal(work.publisher_domain_lead, 'mymichigan.org');
    assert.equal(work.candidate_file_recorded, true);
    assert.match(work.next_action, /authorized content-bearing route/);
    assert.equal(row.mrf_url, '');
    assert.notEqual(row.finding, 'compliant-observed');
  }
  assert.match(observations.find(row => row.ccn === '230100').roster_address_note, /differ on ZIP/);
});
