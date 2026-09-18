'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { build } = require('../build-standing-evidence-followup-worklist');

const audit = path.resolve(__dirname, '../../../data/hpt-audit');
const read = name => fs.readFileSync(path.join(audit, name));

test('standing follow-up worklist is complete, distinct and hash-bound', () => {
  const reconciliation = JSON.parse(read('nationwide-reconciliation.json'));
  const verification = JSON.parse(read('nationwide-verification.json'));
  const saved = JSON.parse(read('standing-evidence-followup-worklist.json'));
  const fresh = build(reconciliation, verification);
  assert.deepEqual(saved.summary, fresh.summary);
  assert.deepEqual(saved.records, fresh.records);
  assert.equal(saved.records.length, reconciliation.records.filter(row => row.workstream === 'standing-evidence-follow-up').length);
  assert.equal(new Set(saved.records.map(row => row.ccn)).size, saved.records.length);
  assert.ok(saved.records.every(row => row.standing_finding && row.next_action && row.latest_observed_at));
  assert.ok(!/https?:\/\//i.test(JSON.stringify(saved.records)));
  const lourdes = saved.records.find(row => row.ccn === '330011');
  assert.equal(lourdes.standing_finding, 'pointer-http-client-error-page-file-found');
  assert.equal(lourdes.reviewed_follow_up, true);
  assert.match(lourdes.next_action, /tested HTTPS mrf-url/);
  for (const name of ['nationwide-reconciliation.json', 'nationwide-verification.json'])
    assert.equal(saved.source_sha256[name], crypto.createHash('sha256').update(read(name)).digest('hex'));
});

test('later manual file-scope reviews remain queued without demoting standing findings', () => {
  const reconciliation = JSON.parse(read('nationwide-reconciliation.json'));
  const worklist = JSON.parse(read('standing-evidence-followup-worklist.json'));
  for (const ccn of ['170187', '351319', '520109']) {
    const row = reconciliation.records.find(item => item.ccn === ccn);
    const queued = worklist.records.find(item => item.ccn === ccn);
    assert.ok(row.issues.includes('later-manual-observation-follow-up'), ccn);
    assert.equal(row.standing_finding, 'compliant-observed');
    assert.equal(queued.next_action, row.manual_access_observation.next_action);
  }
  for (const ccn of ['640001', '500031']) {
    const row = reconciliation.records.find(item => item.ccn === ccn);
    assert.ok(!row.issues.includes('later-manual-observation-follow-up'), ccn);
  }
});

test('prior browser result changes only a generic retry, preserving standing evidence and reviewed instructions', () => {
  const reconciliation = { records: [
    { ccn: '000001', hospital_name: 'A', state: 'NY', priority: 1,
      workstream: 'standing-evidence-follow-up', standing_finding: 'compliant-observed',
      proposed_disposition: 'mrf-request-unsuccessful', next_action: 'Retry the exact pointer-declared MRF in a browser/download-capable client.',
      standing_checked_at: '2026-09-01', latest_observed_at: '2026-09-15' },
    { ccn: '000002', hospital_name: 'B', state: 'NY', priority: 1,
      workstream: 'standing-evidence-follow-up', standing_finding: 'mrf-stale-over-365-days',
      proposed_disposition: 'mrf-request-unsuccessful', next_action: 'Retry the exact pointer-declared MRF in a browser/download-capable client.',
      manual_access_observation: { next_action: 'Wait for publisher correction.' },
      standing_checked_at: '2026-09-01', latest_observed_at: '2026-09-15' },
  ] };
  const verification = { records: [
    { ccn: '000001', browser_mrf_status: 'http-denied', browser_mrf_observed_at: '2026-09-15' },
    { ccn: '000002', browser_mrf_status: 'http-denied', browser_mrf_observed_at: '2026-09-15' },
  ] };
  const result = build(reconciliation, verification);
  assert.equal(result.summary.browser_retry_replaced, 1);
  assert.equal(result.records[0].standing_finding, 'compliant-observed');
  assert.match(result.records[0].next_action, /materially different permitted route/);
  assert.equal(result.records[1].next_action, 'Wait for publisher correction.');
});
