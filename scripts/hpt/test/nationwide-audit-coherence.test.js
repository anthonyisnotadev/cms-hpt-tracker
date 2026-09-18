'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const auditDir = path.resolve(__dirname, '../../../data/hpt-audit');
const read = name => JSON.parse(fs.readFileSync(path.join(auditDir, name), 'utf8'));

test('generated verification, source-proof audit and reconciliation agree per CCN on supersession', () => {
  const verification = read('nationwide-verification.json');
  const proof = read('nationwide-source-proof-audit.json');
  const reconciliation = read('nationwide-reconciliation.json');
  const proofByCcn = new Map(proof.records.map(row => [row.ccn, row]));
  const reconciliationByCcn = new Map(reconciliation.records.map(row => [row.ccn, row]));
  assert.equal(verification.records.length, 5419);
  assert.equal(proofByCcn.size, 5419);
  assert.equal(reconciliationByCcn.size, 5419);
  let superseded = 0;
  for (const row of verification.records) {
    const isSuperseded = !!row.latest_observation_superseded;
    assert.equal(proofByCcn.get(row.ccn)?.status === 'superseded-by-reviewed-resolution', isSuperseded,
      `source-proof status disagrees for ${row.ccn}`);
    assert.equal(!!reconciliationByCcn.get(row.ccn)?.latest_observation_superseded, isSuperseded,
      `reconciliation status disagrees for ${row.ccn}`);
    if (isSuperseded) superseded++;
  }
  assert.equal(verification.summary.superseded_observations, superseded);
  assert.equal(proof.summary.superseded_observations, superseded);
  assert.equal(reconciliation.summary.reconciled_observations.superseded_by_later_reviewed_resolution, superseded);
});

test('nationwide unresolved summary and prioritized investigation worklist agree on exact CCNs', () => {
  const verification = read('nationwide-verification.json');
  const reconciliation = read('nationwide-reconciliation.json');
  const worklist = read('unresolved-investigation-worklist.json');
  const unresolved = verification.records.filter(row => !row.latest_observation_superseded
    && !row.standing_evidence_retained && !row.supported_identity_uncertainty
    && !/^verified-|^scope-exempt/.test(row.disposition)).map(row => row.ccn).sort();
  const investigation = reconciliation.records.filter(row => row.workstream === 'genuinely-unresolved-investigation')
    .map(row => row.ccn).sort();
  assert.deepEqual(unresolved, investigation);
  assert.deepEqual(unresolved, worklist.records.map(row => row.ccn).sort());
  assert.equal(verification.summary.unresolved, unresolved.length);
  assert.equal(verification.summary.effective_counts['genuinely-unresolved'], unresolved.length);
});

test('superseded CHRISTUS Babcock retry is separate from standing Westover Hills evidence', () => {
  const row = read('nationwide-verification.json').records.find(record => record.ccn === '450237');
  assert.equal(row.observation_role, 'superseded-retry');
  assert.equal(row.latest_observation_superseded, true);
  assert.match(row.mrf_url, /santarosahospitalmedicalcenter_standardcharges\.json$/);
  assert.match(row.standing_mrf_url, /santarosahospitalwestoverhills_standardcharges\.json$/);
  assert.notEqual(row.mrf_url, row.standing_mrf_url);
  assert.equal(row.standing_finding, 'compliant-observed');
  assert.equal(row.standing_pointer_url, 'https://christushealth.org/cms-hpt.txt');
});

test('Taylor Regional never inherits the mislabeled South Carolina page file', () => {
  const observation = read('reconciliation-manual-access-observations.json').records
    .find(record => record.ccn === '110256');
  const verification = read('nationwide-verification.json').records
    .find(record => record.ccn === '110256');
  const work = read('unresolved-investigation-worklist.json').records
    .find(record => record.ccn === '110256');
  assert.equal(observation.source_page_file_declared_state, 'SC');
  assert.equal(observation.source_page_file_declared_location_name, 'Edgefield County Healthcare');
  assert.equal(verification.state, 'GA');
  assert.notEqual(verification.standing_mrf_url, observation.source_page_linked_file_url);
  assert.ok(work);
  assert.match(work.next_action, /Do not associate the current EZCOST download with Taylor Regional/);
});

test('Petersburg transport-only pointer retry preserves the reviewed page-file finding', () => {
  const row = read('nationwide-reconciliation.json').records.find(record => record.ccn === '021304');
  assert.equal(row.standing_finding, 'official-page-mrf-root-pointer-unavailable');
  assert.equal(row.standing_evidence_retained, true);
  assert.equal(row.workstream, 'standing-evidence-follow-up');
  assert.ok(row.issues.includes('standing-evidence-retained-review-new-observation'));
  assert.ok(!row.issues.includes('latest-check-unresolved'));
});
