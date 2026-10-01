'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('Tawas rejects stale third-party domain without promoting inaccessible page-linked CSV', () => {
  const proof = require(path.join(audit, 'reconciliation-mymichigan-tawas-third-party-link-revalidation-2026-09-28.json'));
  const observations = require(path.join(audit, 'reconciliation-manual-access-observations.json')).records;
  const observation = observations.find(row => row.ccn === '230100');
  const compliance = loadReviewedView(audit).compliance.find(row => row.ccn === '230100');
  const work = require(path.join(audit, 'unresolved-investigation-worklist.json')).records
    .find(row => row.ccn === '230100');

  assert.equal(proof.ccn, '230100');
  assert.equal(proof.linked_domain_browser_observation.facility_or_hospital_content_found, false);
  assert.match(proof.linked_domain_browser_observation.page_title, /Care & Everyday Wellness/);
  assert.equal(observation.latest_third_party_link_revalidation_2026_09_28.browser_landing_is_unrelated, true);
  assert.match(observation.next_action, /Ignore the stale CareRanks/);
  assert.ok(work.next_action.includes('Ignore the stale CareRanks'));
  assert.equal(compliance.mrf_url, '');
  assert.notEqual(compliance.finding, 'compliant-observed');
});
