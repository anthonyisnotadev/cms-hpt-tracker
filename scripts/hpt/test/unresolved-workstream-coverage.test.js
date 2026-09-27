'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const auditDir = path.resolve(__dirname, '../../../data/hpt-audit');
const read = name => fs.readFileSync(path.join(auditDir, name));
const sourceBytes = read('nationwide-reconciliation.json');
const source = JSON.parse(sourceBytes);
const report = JSON.parse(read('unresolved-support-audit.json'));
const investigation = JSON.parse(read('unresolved-investigation-worklist.json'));
const quarantine = JSON.parse(read('identity-quarantine-worklist.json'));

test('current unresolved set is completely and disjointly covered by investigation and identity-quarantine queues', () => {
  const latestUnresolved = source.records.filter(row => (row.issues || []).includes('latest-check-unresolved'));
  const investigationIds = new Set(investigation.records.map(row => row.ccn));
  const quarantineIds = new Set(quarantine.records.map(row => row.ccn));
  const union = new Set([...investigationIds, ...quarantineIds]);
  const unresolvedInQuarantine = latestUnresolved.filter(row => quarantineIds.has(row.ccn));

  assert.equal(report.source_sha256, crypto.createHash('sha256').update(sourceBytes).digest('hex'));
  assert.equal(report.workstream_coverage.latest_check_unresolved_ccns, latestUnresolved.length);
  assert.equal(report.workstream_coverage.investigation_worklist_ccns, investigationIds.size);
  assert.equal(report.workstream_coverage.identity_quarantine_worklist_ccns, quarantineIds.size);
  assert.equal(report.workstream_coverage.covered_latest_check_unresolved_ccns, latestUnresolved.length);
  assert.equal(report.workstream_coverage.missing_queue_coverage_count, 0);
  assert.deepEqual(report.workstream_coverage.missing_queue_coverage_ccns, []);
  assert.equal(report.workstream_coverage.cross_queue_overlap_count, 0);
  assert.equal(report.workstream_coverage.complete, true);
  assert.ok(latestUnresolved.every(row => union.has(row.ccn)), 'every unresolved CCN belongs to at least one actionable queue');
  assert.deepEqual(
    report.workstream_coverage.separately_routed_latest_check_unresolved.map(row => row.ccn),
    unresolvedInQuarantine.map(row => row.ccn)
  );

  const baxter = latestUnresolved.find(row => row.ccn === '244015');
  assert.ok(baxter, 'Baxter remains in the unresolved snapshot');
  assert.equal(baxter.workstream, 'identity-quarantine');
  assert.ok(quarantineIds.has('244015'), 'Baxter is routed to the identity-quarantine queue');
  assert.match(quarantine.records.find(row => row.ccn === '244015').next_action,
    /Baxter-specific first-party cms-hpt\.txt or pricing\/file route/);
});
