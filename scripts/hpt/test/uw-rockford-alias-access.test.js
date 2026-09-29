'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const audit = path.resolve(__dirname, '../../../data/hpt-audit');

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
  assert.match(queue.next_action, /full-file or publisher validation/);
  const verification = require(path.join(audit, 'nationwide-verification.json')).records
    .find(row => row.ccn === '140228');
  assert.equal(verification.mrf_url || '', '');
});
