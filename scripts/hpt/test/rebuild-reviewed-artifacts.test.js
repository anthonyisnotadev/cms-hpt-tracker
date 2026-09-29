'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../../..');

test('reviewed-artifact rebuild orders the nationwide view before every derived queue and inventory', () => {
  const source = fs.readFileSync(path.join(root, 'scripts/hpt/rebuild-reviewed-artifacts.js'), 'utf8');
  const ordered = [
    'build-nationwide-verification.js',
    'reconcile-nationwide.js',
    'build-unresolved-investigation-worklist.js',
    'build-standing-evidence-followup-worklist.js',
    'build-same-campus-ccn-worklist.js',
    'build-recovered-unresolved-shortlist.js',
    'build-supported-uncertainty-worklist.js',
    'build-corpus-index-ccn-worklist.js',
    'audit-selected-pointer-attribution.js',
    'build-interventions.js',
    'build-cross-domain-pointer-inventory.js',
  ];
  let cursor = -1;
  for (const name of ordered) {
    const next = source.indexOf(name);
    assert.ok(next > cursor, `${name} is missing or out of order`);
    cursor = next;
  }
  const scripts = require(path.join(root, 'package.json')).scripts;
  assert.equal(scripts['hpt:verify:reconcile-all'], 'node scripts/hpt/rebuild-reviewed-artifacts.js');
});
