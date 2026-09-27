const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-redfield-current-avera-pricing-page-link-proof-2026-09-27.json'), 'utf8'));
const browser = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-browser-reviews.json'), 'utf8'));
const manual = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-manual-access-observations.json'), 'utf8'));
const reconciliation = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-reconciliation.json'), 'utf8'));
const worklist = JSON.parse(fs.readFileSync(path.join(audit, 'unresolved-investigation-worklist.json'), 'utf8'));

test('Redfield current Avera link is recorded without converting access denial into a finding', () => {
  const review = browser.records.find((row) => row.ccn === proof.ccn && row.proof_file === 'reconciliation-redfield-current-avera-pricing-page-link-proof-2026-09-27.json');
  const access = manual.records.find((row) => row.ccn === proof.ccn);
  const current = reconciliation.records.find((row) => row.ccn === proof.ccn);
  const queued = worklist.records.find((row) => row.ccn === proof.ccn);

  assert.ok(review);
  assert.equal(review.mrf_url, proof.mrf_url);
  assert.equal(review.http_status, 403);
  assert.equal(review.file_sha256, '');
  assert.equal(access.latest_current_pricing_page_link_2026_09_27.matches_prior_pointer_target, true);
  assert.equal(access.observed_at, proof.observed_at);
  assert.equal(current.manual_access_observation.latest_current_pricing_page_link_2026_09_27.proof_file, review.proof_file);
  assert.equal(current.proposed_disposition, 'mrf-request-unsuccessful');
  assert.equal(queued.current_disposition, 'mrf-request-unsuccessful');
  assert.equal(queued.latest_review_at, proof.observed_at);
  assert.equal(proof.count_effect, 0);
});
