'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const read = name => JSON.parse(fs.readFileSync(path.join(audit, name), 'utf8'));

test('Poplar Springs address-role review is reconciled without inventing current CMS file evidence', () => {
  const ccn = '494022';
  const proof = read('reconciliation-poplar-springs-virginia-location-corroboration-2026-09-28.json');
  const manual = read('reconciliation-manual-access-observations.json').records.find(row => row.ccn === ccn);
  const browser = read('nationwide-browser-reviews.json').records.find(row => row.ccn === ccn
    && row.kind === 'identity-role-reconciliation');
  const nationwide = read('nationwide-verification.json');
  const current = nationwide.records.find(row => row.ccn === ccn);
  const queue = read('unresolved-investigation-worklist.json').records.find(row => row.ccn === ccn);
  const cohort = read('reconciliation-891-baseline-member-roster-2026-09-27.json');

  assert.ok(proof.sources.some(source => source.kind === 'virginia-department-of-health-ems-communication-centers'));
  assert.ok(proof.sources.some(source => source.kind === 'joint-commission-current-provider-locator-address-role-review'));
  assert.match(proof.finding, /SUD-program site at 214 W Hundred Road, Chester/);
  assert.equal(proof.disposition, 'facility-address-role-reconciled-current-mrf-unverified');
  assert.equal(manual.proof_file, 'reconciliation-poplar-springs-virginia-location-corroboration-2026-09-28.json');
  assert.equal(manual.disposition, proof.disposition);
  assert.equal(manual.next_action, proof.next_action);
  assert.equal(browser.status, 'care-organization-address-distinguished-from-service-site');

  assert.equal(nationwide.records.length, 5419);
  assert.equal(current.disposition, 'pointer-not-retrieved');
  assert.equal(current.mrf_state, 'not-assessed');
  assert.equal(current.mrf_url, '');
  assert.equal(current.next_action, proof.next_action);
  assert.equal(queue.next_action, proof.next_action);
  assert.ok(cohort.current_crosswalk_ccns['genuinely-unresolved'].includes(ccn));
  assert.equal(cohort.summary.category_membership_sum, 891);
  assert.equal(cohort.summary.unique_ccns, 720);
});
