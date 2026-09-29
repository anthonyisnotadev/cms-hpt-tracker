'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const audit = path.resolve(__dirname, '../../../data/hpt-audit');
const read = name => JSON.parse(fs.readFileSync(path.join(audit, name), 'utf8'));

test('Little Colorado HTML pointer chain retains reviewed direct-file evidence and pointer follow-up', () => {
  const observation = read('reconciliation-manual-access-observations.json').records.find(row => row.ccn === '031311');
  const work = read('standing-evidence-followup-worklist.json').records.find(row => row.ccn === '031311');
  const verification = read('nationwide-verification.json').records.find(row => row.ccn === '031311');
  assert.equal(observation.root_pointer_response_kind, 'html-page-with-pointer-style-text');
  assert.equal(observation.rendered_mrf_url_response_kind, 'html-interactive-pricing-page');
  assert.equal(observation.rendered_mrf_url, observation.first_party_pricing_link_target);
  assert.match(observation.root_pointer_sha256, /^[a-f0-9]{64}$/);
  assert.match(observation.rendered_mrf_url_sample_sha256, /^[a-f0-9]{64}$/);
  assert.equal(verification.observation_role, 'superseded-retry');
  assert.equal(verification.latest_observation_superseded, true);
  assert.equal(verification.browser_pointer_status, 'retrieved');
  assert.equal(verification.pointer_corpus_sha256, '');
  assert.equal(work.reviewed_follow_up, true);
  assert.equal(work.current_disposition, 'pointer-not-retrieved');
  assert.equal(work.standing_finding, 'root-pointer-html-page-with-official-page-file');
  assert.match(work.next_action, /plain-text root cms-hpt\.txt pointing/);
});
