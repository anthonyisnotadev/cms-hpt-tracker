'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '../../..');
const bridgePath = path.join(root, 'data/hpt-audit/nationwide-snapshot-bridge.json');
const effectiveAuditPath = path.join(root, 'data/hpt-audit/nationwide-effective-audit.json');
const currentPath = path.join(root, 'data/hpt-audit/nationwide-verification.json');
const buildScript = path.join(root, 'scripts/hpt/build-nationwide-snapshot-bridge.js');

test('nationwide snapshot bridge deterministically covers the exact 5,419-CCN join', () => {
  const before = fs.readFileSync(bridgePath);
  execFileSync(process.execPath, [buildScript], { cwd: root, stdio: 'ignore' });
  const after = fs.readFileSync(bridgePath);
  const bridge = JSON.parse(after.toString('utf8'));
  const effectiveAudit = JSON.parse(fs.readFileSync(effectiveAuditPath, 'utf8'));
  const currentBytes = fs.readFileSync(currentPath);
  const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  assert.equal(bridge.current_snapshot.sha256, hash(currentBytes));
  assert.equal(bridge.current_snapshot.generated_at, JSON.parse(currentBytes).summary.generated_at);

  const current = JSON.parse(currentBytes.toString('utf8'));
  assert.equal(bridge.coverage.exact_ccn_join, true);
  assert.equal(bridge.coverage.base_ccns, 5419);
  assert.equal(bridge.coverage.current_ccns, 5419);
  assert.equal(bridge.coverage.added_ccns, 0);
  assert.equal(bridge.coverage.removed_ccns, 0);
  assert.equal(bridge.records.length, 5419);
  assert.equal(effectiveAudit.coverage.exact_ccn_join, true);
  assert.equal(effectiveAudit.coverage.nationwide_ccns, 5419);
  assert.equal(effectiveAudit.coverage.historical_891_memberships, 891);
  assert.equal(effectiveAudit.coverage.historical_891_unique_ccns, 720);
  assert.equal(effectiveAudit.coverage.historical_891_overlap_memberships, 171);
  assert.equal(effectiveAudit.records.length, 5419);
  assert.equal(new Set(effectiveAudit.records.map(record => record.ccn)).size, 5419);
  assert.equal(effectiveAudit.inputs.nationwide_verification.sha256, hash(currentBytes));
  assert.equal(effectiveAudit.counts.historical_891_category['genuinely-unresolved'], 543);
  assert.equal(effectiveAudit.records.find(record => record.ccn === '440161')
    .raw_observation.mrf_http_status, '403');
  assert.equal(effectiveAudit.records.find(record => record.ccn === '440161')
    .raw_observation.browser_mrf_observed_at, '2026-09-15T09:37:01.432Z');
  assert.equal(effectiveAudit.records.find(record => record.ccn === '440161')
    .effective_reviewed_observation.overlay_root_pointer_observation.http_status, 404);
  assert.equal(effectiveAudit.records.find(record => record.ccn === '440161')
    .effective_reviewed_observation.overlay_root_pointer_observation.observed_at, '2026-09-26T00:00:00Z');
  assert.equal(effectiveAudit.records.find(record => record.ccn === '440161')
    .effective_reviewed_observation.overlay_source_proof_file,
    'reconciliation-tristar-centennial-current-page-file-promotion-proof-2026-09-26.json');
  assert.equal(effectiveAudit.records.find(record => record.ccn === '440161')
    .effective_reviewed_observation.disposition, 'verified-current-mrf');
  assert.equal(effectiveAudit.records.find(record => record.ccn === '440161')
    .effective_reviewed_observation.latest_retry_observation, null);
  assert.equal(new Set(bridge.records.map(record => record.ccn)).size, 5419);
  assert.equal(Object.values(bridge.transition_counts).reduce((sum, count) => sum + count, 0), 5419);
  assert.equal(bridge.base_snapshot.counts['genuinely-unresolved'], 787);
  assert.equal(bridge.current_snapshot.counts['genuinely-unresolved'], 545);
  assert.equal(bridge.current_snapshot.sha256, hash(currentBytes));
  assert.equal(current.summary.unresolved, 545);
  const cohort = bridge.historical_891_membership_cohort;
  assert.equal(cohort.exact_member_set_recovered, true);
  assert.deepEqual(cohort.historical_membership_counts, {
    unresolved_category_memberships: 593,
    pointer_access_denied_memberships: 298,
    overlap_memberships: 171,
    total_category_memberships: 891,
    unique_ccns: 720
  });
  assert.equal(cohort.current_snapshot_sha256, hash(currentBytes));
  assert.equal(cohort.current_category_counts['genuinely-unresolved'], 543);
  assert.equal(Object.values(cohort.current_category_counts).reduce((sum, count) => sum + count, 0), 720);
  const cohortCcnSets = Object.values(cohort.current_category_ccns).flat();
  assert.equal(cohortCcnSets.length, 720);
  assert.equal(new Set(cohortCcnSets).size, 720);
  assert.ok(bridge.limitations.some(note => note.includes('2026-09-17 all-CCN figure of 898')));
  assert.ok(!bridge.limitations.some(note => note.includes('no matching dated per-CCN snapshot') && note.includes('2026-09-25')));
});
