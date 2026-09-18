'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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
  assert.match(data.reviewedFollowups['010125'].nextAction, /acute-care certification period/);
  assert.match(data.reviewedFollowups['011311'].nextAction, /critical-access certification period/);
  assert.match(data.reviewedFollowups['010779'].nextAction, /license_number\|CA/);
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
  assert.equal(data.investigationNextSteps['061308'].stream, 'supported-uncertainty-monitor');
  assert.match(data.investigationNextSteps['061308'].nextAction, /81101/);
  assert.match(data.investigationNextSteps['061308'].nextAction, /81140/);
  const browserRetry = standingWorklist.records.find(row => row.ccn === '050145');
  assert.equal(data.investigationNextSteps[browserRetry.ccn].nextAction, browserRetry.next_action);
  assert.match(browserRetry.next_action, /materially different permitted route/);
  assert.doesNotMatch(html, /[?&]sig=/i);
});
