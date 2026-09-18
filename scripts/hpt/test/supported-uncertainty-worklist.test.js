'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { build } = require('../build-supported-uncertainty-worklist');

const audit = path.resolve(__dirname, '../../../data/hpt-audit');
const read = name => fs.readFileSync(path.join(audit, name));

test('every supported uncertainty has a source-bound, distinct follow-up', () => {
  const reconciliation = JSON.parse(read('nationwide-reconciliation.json'));
  const resolutions = JSON.parse(read('reviewed-resolutions.json'));
  const saved = JSON.parse(read('supported-uncertainty-followup-worklist.json'));
  const fresh = build(reconciliation, resolutions);
  assert.deepEqual(saved.summary, fresh.summary);
  assert.deepEqual(saved.records, fresh.records);
  const supportedCount = reconciliation.records.filter(row => row.workstream === 'supported-uncertainty-monitor').length;
  const reviewedConflictCount = reconciliation.records.filter(row => row.workstream === 'consistent'
    && ['mrf-address-field-conflicts-facility', 'mrf-license-state-field-conflicts-facility',
      'mrf-address-field-incomplete'].includes(row.standing_finding)).length;
  assert.equal(saved.summary.total, supportedCount + reviewedConflictCount);
  assert.equal(saved.summary.by_gate['reviewed-file-address-conflict'], 15);
  assert.equal(saved.summary.by_gate['reviewed-file-license-state-conflict'], 43);
  assert.equal(saved.summary.by_gate['reviewed-file-address-incomplete'], 3);
  assert.equal(saved.summary.total, Object.values(saved.summary.by_gate).reduce((sum, count) => sum + count, 0));
  assert.equal(new Set(saved.records.map(row => row.ccn)).size, saved.records.length);
  assert.ok(saved.records.every(row => row.next_action && row.latest_observed_at && row.reviewed_at));
  const unresolved = new Set(JSON.parse(read('unresolved-investigation-worklist.json')).records.map(row => row.ccn));
  assert.ok(saved.records.every(row => !unresolved.has(row.ccn)));
  for (const name of ['nationwide-reconciliation.json', 'reviewed-resolutions.json',
    'reconciliation-browser-file-address-conflicts.json'])
    assert.equal(saved.source_sha256[name], crypto.createHash('sha256').update(read(name)).digest('hex'));
  const murray = saved.records.find(row => row.ccn === '241319');
  assert.equal(murray.reconciliation_status, 'supported-identity-uncertainty');
  assert.match(murray.next_action, /current plain-text murraycountymed\.org root pointer/);
  assert.equal(murray.reviewed_resolution_action, 'quarantine');
  const conejos = saved.records.find(row => row.ccn === '061308');
  assert.equal(conejos.evidence_gate, 'reviewed-file-address-conflict');
  assert.match(conejos.next_action, /81101/);
  assert.match(conejos.next_action, /81140/);
  assert.match(conejos.mrf_url, /slvconejos/);
  for (const ccn of ['251316', '251322', '251323', '251335']) {
    const row = saved.records.find(item => item.ccn === ccn);
    assert.equal(row.evidence_gate, 'reviewed-file-license-state-conflict');
    assert.match(row.next_action, /Declared license state: LA; facility state: MS/);
  }
  const choctaw = saved.records.find(row => row.ccn === '011304');
  assert.equal(choctaw.evidence_gate, 'reviewed-file-license-state-conflict');
  assert.match(choctaw.next_action, /license_number\|LA/);
  assert.match(choctaw.next_action, /Ave.*Lane/);
});
