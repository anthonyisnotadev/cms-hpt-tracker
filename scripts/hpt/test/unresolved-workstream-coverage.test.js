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

  assert.equal(latestUnresolved.some(row => row.ccn === '244015'), true,
    'Baxter remains unresolved until a CMS deemed-compliant exception is established');
  assert.equal(quarantineIds.has('244015'), false, 'Baxter is no longer in identity quarantine');

  const scopePending = JSON.parse(fs.readFileSync(path.join(auditDir, 'reviewed-resolutions.json')))
    .filter(row => row.action === 'scope-review-pending');
  assert.equal(scopePending.length, 13);
  for (const resolution of scopePending) {
    const queued = investigation.records.find(row => row.ccn === resolution.ccn);
    assert.ok(queued, `${resolution.ccn} remains in the investigation queue`);
    assert.equal(queued.evidence_gate, 'facility-specific-mrf-or-authoritative-exception-basis');
    assert.ok(queued.reviewed_sources.includes('state-hospital-scope-review'));
    if (['214002', '214004', '214012', '214018'].includes(resolution.ccn)) {
      assert.match(queued.next_action, /Keep the facility unresolved.*Locate and verify a current facility-specific CMS MRF/s);
    } else if (resolution.ccn === '244015') {
      assert.match(queued.next_action, /Baxter-specific.*pricing\/file/i);
    } else {
      assert.ok(queued.next_action, `${resolution.ccn} retains its facility-specific next action`);
    }
    assert.doesNotMatch(queued.next_action, /keep.*exempt|scope-exempt/i);
  }
});
