'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '../../..');

test('tracker exposes current manual follow-ups separately from standing findings', () => {
  const html = fs.readFileSync(path.join(root, 'tracker.html'), 'utf8');
  const open = '<script id="tracker-data" type="application/json">';
  const start = html.indexOf(open);
  assert.ok(start >= 0);
  const end = html.indexOf('</script>', start);
  const data = JSON.parse(html.slice(start + open.length, end));
  assert.ok(html.includes('id="oc-reviewed-followup"'));
  assert.ok(html.includes('id="oc-investigation-next-step"'));
  assert.match(data.reviewedFollowups['010125'].nextAction, /acute-care certification period|historical accountability baseline/);
  assert.match(data.reviewedFollowups['011311'].nextAction, /critical-access certification period|current first-party pointer\/MRF/);
  assert.equal(data.reviewedFollowups['010779'], undefined);
  assert.equal(data.investigationNextSteps['010779'].stream, 'same-campus-ccn-review');
  assert.deepEqual(data.investigationNextSteps['010779'].sameCampusCcns, ['010110', '010779']);
  assert.match(data.investigationNextSteps['010779'].nextAction, /CMS QIES Q1 2026 records acute-care CCN 010110 terminated 2024-04-30/);
  assert.equal(data.reviewedFollowups['420073'], undefined);
  assert.equal(data.investigationNextSteps['330270'].browserFileStatus, 'official-page-linked-large-json-access-denied');
  assert.match(data.investigationNextSteps['330270'].nextAction, /materially different authorized download route/);
  assert.equal(data.investigationNextSteps['010005'].stream, 'standing-evidence-follow-up');
  assert.match(data.investigationNextSteps['010005'].nextAction, /alternate client/);
  const worklist = JSON.parse(fs.readFileSync(path.join(root,
    'data/hpt-audit/unresolved-investigation-worklist.json'), 'utf8'));
  const standingWorklist = JSON.parse(fs.readFileSync(path.join(root,
    'data/hpt-audit/standing-evidence-followup-worklist.json'), 'utf8'));
  const supportedWorklist = JSON.parse(fs.readFileSync(path.join(root,
    'data/hpt-audit/supported-uncertainty-followup-worklist.json'), 'utf8'));
  const sameCampusWorklist = JSON.parse(fs.readFileSync(path.join(root,
    'data/hpt-audit/same-campus-ccn-transition-worklist.json'), 'utf8'));
  const reconciliation = JSON.parse(fs.readFileSync(path.join(root,
    'data/hpt-audit/nationwide-reconciliation.json'), 'utf8'));
  const identityWorklist = JSON.parse(fs.readFileSync(path.join(root,
    'data/hpt-audit/identity-quarantine-worklist.json'), 'utf8'));
  const sameCampusOnlyCcns = sameCampusWorklist.groups.flatMap(group => group.ccns)
    .filter(ccn => !worklist.records.some(row => row.ccn === ccn)
      && !standingWorklist.records.some(row => row.ccn === ccn)
      && !supportedWorklist.records.some(row => row.ccn === ccn));
  const knownCcns = new Set([...worklist.records, ...standingWorklist.records,
    ...supportedWorklist.records].map(row => row.ccn));
  sameCampusWorklist.groups.flatMap(group => group.ccns).forEach(ccn => knownCcns.add(ccn));
  const trackerOnlyCcns = Object.keys(data.investigationNextSteps)
    .filter(ccn => !knownCcns.has(ccn));
  assert.equal(Object.keys(data.investigationNextSteps).length, worklist.records.length
    + standingWorklist.records.length + supportedWorklist.records.length
    + sameCampusOnlyCcns.length + trackerOnlyCcns.length);
  assert.equal(data.investigationNextSteps['010062'].stream, 'same-campus-ccn-review');
  assert.equal(data.investigationNextSteps['241319'].stream, 'supported-uncertainty-monitor');
  assert.match(data.investigationNextSteps['241319'].nextAction, /current plain-text murraycountymed\.org root pointer/);
  assert.equal(data.investigationNextSteps['061308'].stream, 'standing-evidence-follow-up');
  assert.match(data.investigationNextSteps['061308'].nextAction, /81101/);
  const browserRetry = standingWorklist.records.find(row => row.ccn === '050145');
  assert.equal(data.investigationNextSteps[browserRetry.ccn].nextAction, browserRetry.next_action);
  assert.match(browserRetry.next_action, /materially different permitted route/);
  const reconciliationByCcn = new Map(reconciliation.records.map(row => [row.ccn, row]));
  const intentionalSameCampusOverrides = new Set(['010062', '010779', '011309', '040153', '370784']);
  const intentionalSupportedOverrides = new Set(supportedWorklist.records.map(row => row.ccn));
  for (const [ccn, item] of Object.entries(data.investigationNextSteps)) {
    const current = reconciliationByCcn.get(ccn);
    if (!current) continue;
    if (item.stream === 'same-campus-ccn-review') assert.ok(intentionalSameCampusOverrides.has(ccn));
    else if (item.stream === 'supported-uncertainty-monitor') assert.ok(intentionalSupportedOverrides.has(ccn));
    else assert.equal(item.stream, current.workstream);
  }
  for (const row of reconciliation.records) {
    if (row.workstream !== 'consistent' && row.workstream !== 'verification-proof-gap')
      assert.ok(data.investigationNextSteps[row.ccn], row.ccn);
  }
  assert.deepEqual([...intentionalSameCampusOverrides].sort(),
    [...new Set(Object.entries(data.investigationNextSteps)
      .filter(([, item]) => item.stream === 'same-campus-ccn-review')
      .map(([ccn]) => ccn))].sort());
  assert.deepEqual(
    reconciliation.records.filter(row => row.workstream === 'identity-quarantine').map(row => row.ccn).sort(),
    Object.entries(data.investigationNextSteps)
      .filter(([, item]) => item.stream === 'identity-quarantine').map(([ccn]) => ccn).sort(),
  );
  assert.equal(identityWorklist.source_sha256['nationwide-reconciliation.json'],
    crypto.createHash('sha256').update(fs.readFileSync(path.join(root,
      'data/hpt-audit/nationwide-reconciliation.json'))).digest('hex'));
  assert.deepEqual(identityWorklist.records.map(row => row.ccn),
    reconciliation.records.filter(row => row.workstream === 'identity-quarantine')
      .sort((a, b) => a.priority - b.priority || a.ccn.localeCompare(b.ccn)).map(row => row.ccn));
  assert.doesNotMatch(html, /[?&]sig=/i);
});
