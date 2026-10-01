'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const read = name => JSON.parse(fs.readFileSync(path.join(audit, name), 'utf8'));

test('current CMS location/address rule strengthens shared UCI discrepancy without resolving campus CCNs', () => {
  const proof = read('reconciliation-uci-shared-orange-address-current-rule-crosscheck-2026-09-29.json');
  assert.deepEqual(proof.scope.ccns, ['050570', '050551', '050581']);
  assert.equal(proof.evidence_classification.new_mrf_bytes, false);
  assert.equal(proof.evidence_classification.new_rule_or_schema_semantics_checked, true);
  assert.equal(proof.observed_at, '2026-09-29T08:53:34Z');
  assert.equal(proof.timestamp_correction.prior_value, '2026-09-29T14:00:00Z');
  assert.equal(proof.timestamp_correction.corrected_value, proof.observed_at);
  assert.equal(proof.live_source_recheck.observed_at, proof.observed_at);
  assert.equal(proof.live_source_recheck.sources.length, 3);
  assert.equal(proof.count_effect, 0);
  assert.match(proof.finding, /not evidence that the files belong to Orange/);
  assert.equal(proof.retained_file_evidence.files.length, 3);
  const sourceProof = read('reconciliation-uci-shared-orange-address-metadata-cohort-2026-09-27.json');
  const sourceSamples = new Map(sourceProof.latest_exact_file_bounded_rechecks_2026_09_27
    .map(row => [row.ccn, row.sample_sha256]));
  for (const row of proof.retained_file_evidence.files) {
    assert.equal(row.http_status, 206);
    assert.equal(row.sample_bytes, 131072);
    assert.match(row.sha256, /^[a-f0-9]{64}$/, 'retained source SHA-256 must be complete');
    assert.equal(row.sha256, sourceSamples.get(row.ccn), 'copied digest must match its exact-CCN source proof');
    assert.equal(row.declared_hospital_address, '101 City Drive South, Orange, CA 92868');
    assert.equal(proof.scope.ccns.includes(row.ccn), true);
  }

  const manual = read('reconciliation-manual-access-observations.json').records
    .find(row => row.ccn === '050581');
  assert.equal(manual.latest_current_rule_crosscheck_2026_09_29.observed_at, proof.observed_at);
  assert.equal(manual.latest_current_rule_crosscheck_2026_09_29.timestamp_correction.prior_value,
    proof.timestamp_correction.prior_value);

  const resolution = read('nationwide-reconciliation.json');
  for (const ccn of proof.scope.ccns) {
    const row = resolution.records.find(item => item.ccn === ccn);
    if (ccn === '050581') {
      assert.equal(row.workstream, 'genuinely-unresolved-investigation');
      assert.match(row.next_action, /publisher correction or explanation covering the repeated hospital_address/);
    } else {
      assert.equal(row.workstream, 'standing-evidence-follow-up',
        `${ccn} is not a member of the frozen 891 unresolved set and must keep its stronger standing finding`);
    }
  }

  const cohort = read('reconciliation-891-baseline-member-roster-2026-09-27.json');
  assert.equal(proof.scope.ccns.filter(ccn => cohort.baseline_unresolved_ccns.includes(ccn)).join(','), '050581');
  assert.ok(cohort.baseline_unresolved_ccns.includes('050581'));
  const crosswalk = read('reconciliation-891-worklist-membership-crosscheck-2026-09-28.json');
  assert.equal(crosswalk.comparison.cohort_genuinely_unresolved_ccns, 541);
});
