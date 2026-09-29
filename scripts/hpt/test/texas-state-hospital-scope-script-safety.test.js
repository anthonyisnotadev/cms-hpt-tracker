'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../../..');
const ledgerPath = path.join(root, 'data/hpt-audit/reviewed-resolutions.json');
const scriptPath = path.join(root, 'scripts/hpt/apply-texas-state-hospital-scope.js');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

test('superseded Texas state-hospital scope script refuses unsupported exemption and preserves ledger', () => {
  const before = fs.readFileSync(ledgerPath);
  const result = spawnSync(process.execPath, [scriptPath], { cwd: root, encoding: 'utf8' });
  const after = fs.readFileSync(ledgerPath);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Refusing Texas scope promotion/);
  assert.equal(hash(after), hash(before));

  const ledger = JSON.parse(after.toString('utf8'));
  for (const ccn of ['454000', '454006', '454008', '454009', '454011', '454084', '454088', '454100']) {
    const entry = ledger.find(item => item.ccn === ccn);
    assert.equal(entry?.action, 'scope-review-pending', `${ccn} must stay pending absent exact exception evidence`);
  }
});
