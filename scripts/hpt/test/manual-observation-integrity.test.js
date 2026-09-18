'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data', 'hpt-audit');
const ledger = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-manual-access-observations.json'), 'utf8'));

test('manual observations are unique, actionable, and reference existing proof artifacts', () => {
  assert.ok(Array.isArray(ledger.records));
  const seen = new Set();
  for (const record of ledger.records) {
    assert.match(String(record.ccn || ''), /^\d{6}$/);
    assert.equal(seen.has(record.ccn), false, `duplicate manual observation ${record.ccn}`);
    seen.add(record.ccn);
    assert.ok(record.observed_at, `missing observed_at for ${record.ccn}`);
    assert.ok(record.disposition, `missing disposition for ${record.ccn}`);
    assert.ok(record.next_action, `missing next_action for ${record.ccn}`);
    if (record.proof_file) {
      assert.equal(path.basename(record.proof_file), record.proof_file,
        `proof_file must be repository-relative basename for ${record.ccn}`);
      assert.ok(fs.existsSync(path.join(audit, record.proof_file)),
        `missing proof file for ${record.ccn}: ${record.proof_file}`);
    }
  }
});
