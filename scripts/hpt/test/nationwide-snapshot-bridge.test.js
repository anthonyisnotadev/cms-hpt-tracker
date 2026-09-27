'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '../../..');
const bridgePath = path.join(root, 'data/hpt-audit/nationwide-snapshot-bridge.json');
const currentPath = path.join(root, 'data/hpt-audit/nationwide-verification.json');
const buildScript = path.join(root, 'scripts/hpt/build-nationwide-snapshot-bridge.js');

test('nationwide snapshot bridge deterministically covers the exact 5,419-CCN join', () => {
  const before = fs.readFileSync(bridgePath);
  execFileSync(process.execPath, [buildScript], { cwd: root, stdio: 'ignore' });
  const after = fs.readFileSync(bridgePath);
  const bridge = JSON.parse(after.toString('utf8'));
  const currentBytes = fs.readFileSync(currentPath);
  const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  assert.equal(bridge.current_snapshot.sha256, hash(currentBytes));
  assert.equal(bridge.current_snapshot.generated_at, JSON.parse(currentBytes).summary.generated_at);

  const current = JSON.parse(currentBytes.toString('utf8'));
  assert.equal(bridge.coverage.exact_ccn_join, true);
  assert.equal(bridge.coverage.base_ccns, 5419);
  assert.equal(bridge.coverage.current_ccns, 5419);
  assert.equal(bridge.coverage.added_ccns, 0);
  assert.equal(bridge.coverage.removed_ccns, 0);
  assert.equal(bridge.records.length, 5419);
  assert.equal(new Set(bridge.records.map(record => record.ccn)).size, 5419);
  assert.equal(Object.values(bridge.transition_counts).reduce((sum, count) => sum + count, 0), 5419);
  assert.equal(bridge.base_snapshot.counts['genuinely-unresolved'], 787);
  assert.equal(bridge.current_snapshot.counts['genuinely-unresolved'], 548);
  assert.equal(bridge.current_snapshot.sha256, hash(currentBytes));
  assert.equal(current.summary.unresolved, 548);
  assert.ok(bridge.limitations.some(note => note.includes('does not identify which cases belonged')));
});
