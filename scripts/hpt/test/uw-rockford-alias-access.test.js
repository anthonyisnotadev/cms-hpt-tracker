'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const audit = path.resolve(__dirname, '../../../data/hpt-audit');

test('Rockford alias preserves the cached exact pointer lead without file promotion', () => {
  const observation = require(path.join(audit, 'reconciliation-manual-access-observations.json')).records
    .find(row => row.ccn === '140228');
  assert.ok(observation);
  assert.equal(observation.pointer_cached_location_name, 'SwedishAmerican Hospital');
  assert.match(observation.official_address, /1401 E\. State Street, Rockford, IL 61104/);
  assert.match(observation.next_action, /Do not apply the Belvidere location/);
  const queue = require(path.join(audit, 'unresolved-investigation-worklist.json')).records
    .find(row => row.ccn === '140228');
  assert.ok(queue.reviewed_sources.includes('manual-access'));
  assert.match(queue.next_action, /materially different authorized DNS\/network route/);
  const verification = require(path.join(audit, 'nationwide-verification.json')).records
    .find(row => row.ccn === '140228');
  assert.equal(verification.mrf_url || '', '');
});
