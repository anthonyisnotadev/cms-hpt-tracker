'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('Joint Commission domain lead is separated from blocked site content and Oklahoma MRF', () => {
  const proof = require(path.join(audit, 'reconciliation-rolling-hills-tennessee-domain-lead-2026-09-28.json'));
  const manual = require(path.join(audit, 'reconciliation-manual-access-observations.json')).records
    .find(row => row.ccn === '444007');
  const work = require(path.join(audit, 'unresolved-investigation-worklist.json')).records
    .find(row => row.ccn === '444007');
  const compliance = loadReviewedView(audit).compliance.find(row => row.ccn === '444007');

  assert.equal(proof.roster_identity.address, '2014 Quail Hollow Circle, Franklin, TN 37067');
  assert.equal(proof.corroborated_domain_lead, 'https://rollinghillshospital.org/');
  assert.match(proof.browser_observation.visible_state, /Cloudflare security verification challenge/);
  assert.equal(proof.browser_observation.challenge_bypassed, false);
  assert.match(proof.separate_wrong_facility_file_exclusion.declared_facility, /Ada, OK/);
  assert.equal(manual.latest_tennessee_domain_lead_review_2026_09_28.pointer_or_file_bytes_recovered, false);
  assert.match(work.next_action, /rollinghillshospital\.org/);
  assert.equal(compliance.mrf_url, '');
  assert.notEqual(compliance.finding, 'compliant-observed');
});
