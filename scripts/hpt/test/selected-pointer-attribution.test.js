'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { collect } = require('../audit-selected-pointer-attribution');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

test('selected-header pointer hash disagreements are inventoried without implying file failure', () => {
  const rows = collect([
    { ccn: '000001', pointer_corpus_sha256: 'b', evidence: { pointer_sha256s: ['a'] } },
    { ccn: '000002', pointer_corpus_sha256: 'a', evidence: { pointer_sha256s: ['a'] } }
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ccn, '000001');
  assert.match(rows[0].next_action, /preserve both dates/);
});

test('selected-pointer attribution inventory is bound to the current nationwide report', () => {
  const reportBytes = fs.readFileSync(path.join(audit, 'nationwide-verification.json'));
  const inventory = JSON.parse(fs.readFileSync(path.join(audit, 'selected-pointer-attribution-discrepancies.json')));
  assert.equal(inventory.summary.source_nationwide_sha256, sha(reportBytes));
  assert.deepEqual(inventory.records, collect(JSON.parse(reportBytes).records));
});
