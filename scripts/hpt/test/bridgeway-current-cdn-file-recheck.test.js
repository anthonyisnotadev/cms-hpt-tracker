'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { parseCSV } = require('../lib/util');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const read = name => JSON.parse(fs.readFileSync(path.join(audit, name), 'utf8'));

test('BridgeWay CDN bytes add candidate evidence without resolving the 891 cohort member', () => {
  const proof = read('reconciliation-bridgeway-current-cdn-file-recheck-2026-09-29.json');
  assert.equal(proof.ccn, '044005');
  assert.equal(proof.observed_at, '2026-09-29T09:02:05Z');
  assert.equal(proof.timestamp_correction.prior_value, '2026-09-29T12:00:00Z');
  assert.equal(proof.timestamp_correction.corrected_value, proof.observed_at);
  assert.equal(proof.source_recheck_and_retention.observed_at, proof.observed_at);
  assert.equal(proof.source_recheck_and_retention.third_party_page_http_status, 200);
  assert.equal(proof.source_recheck_and_retention.third_party_page_links_exact_candidate_url, true);
  assert.equal(proof.http_status, 200);
  assert.equal(proof.content_length, 48919);
  assert.match(proof.sha256, /^[a-f0-9]{64}$/);
  assert.equal(proof.declared_version, '3.0.0');
  assert.equal(proof.declared_attestation, true);
  assert.equal(proof.declared_npi, '1962473306');
  assert.equal(proof.price_record_count, 332);
  const retained = path.join(audit, proof.source_recheck_and_retention.retained_source_file);
  const bytes = fs.readFileSync(retained);
  assert.equal(bytes.length, proof.content_length);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), proof.sha256);
  assert.equal(proof.source_recheck_and_retention.candidate_sha256, proof.sha256);
  const csvRows = parseCSV(bytes.toString('utf8'));
  assert.equal(csvRows.length, proof.csv_record_count_including_two_metadata_rows);
  assert.equal(csvRows.length - 3, proof.price_record_count);
  assert.equal(proof.count_effect, 0);
  assert.match(proof.interpretation, /remains unverified|Do not promote/i);

  const reconciliation = read('nationwide-reconciliation.json').records.find(row => row.ccn === proof.ccn);
  assert.equal(reconciliation.workstream, 'genuinely-unresolved-investigation');
  assert.equal(reconciliation.direct_file_review.sha256, proof.sha256);
  assert.equal(reconciliation.manual_access_observation.proof_file,
    'reconciliation-bridgeway-current-cdn-file-recheck-2026-09-29.json');
  assert.equal(reconciliation.manual_access_observation.observed_at, proof.observed_at);
  assert.equal(reconciliation.manual_access_observation.latest_recheck_action_observed_at, proof.observed_at);
  assert.equal(reconciliation.manual_access_observation.timestamp_correction.prior_value, '2026-09-29T12:00:00Z');
  assert.match(reconciliation.next_action, /first-party page or root-pointer evidence/);

  const worklist = read('unresolved-investigation-worklist.json');
  const queueRecord = worklist.records.find(row => row.ccn === proof.ccn);
  assert.equal(queueRecord.next_action, reconciliation.next_action);
  assert.equal(queueRecord.latest_review_at, proof.observed_at);

  const roster = read('reconciliation-891-baseline-member-roster-2026-09-27.json');
  assert.ok(roster.baseline_unresolved_ccns.includes(proof.ccn));
  const crosswalk = read('reconciliation-891-worklist-membership-crosscheck-2026-09-28.json');
  assert.equal(crosswalk.comparison.cohort_genuinely_unresolved_ccns, 541);
  assert.equal(crosswalk.comparison.historical_cohort_memberships, 891);
});
