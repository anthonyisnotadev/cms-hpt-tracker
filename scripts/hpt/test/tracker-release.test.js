'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { digest, validateSnapshot } = require('../../check-tracker-release');
test('release hashes normalize checkout line endings but detect content changes', () => {
  assert.equal(digest('one\r\ntwo\r\n'), digest('one\ntwo\n'));
  assert.notEqual(digest('one\ntwo\n'), digest('one\nchanged\n'));
});
test('release validation rejects missing or duplicate hospitals and invalid queue counts', () => {
  const valid = { generated: '2026-09-29', rows: Array.from({ length: 5419 }, (_, i) => [String(i)]), queue: [{ n: 544 }] };
  validateSnapshot(valid);
  assert.throws(() => validateSnapshot({ ...valid, rows: valid.rows.slice(1) }), /unique CCNs/);
  assert.throws(() => validateSnapshot({ ...valid, rows: valid.rows.map(() => ['duplicate']) }), /unique CCNs/);
  assert.throws(() => validateSnapshot({ ...valid, queue: [{ n: -1 }] }), /work queue/);
});
