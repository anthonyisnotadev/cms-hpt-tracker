'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-maryland-psychiatric-pointer-coverage-proof.json')));

test('Maryland psychiatric follow-ups retain exact cached sibling-pointer boundary', () => {
  const bytes = fs.readFileSync(path.join(root, proof.pointer.cached_file));
  assert.equal(bytes.length, proof.pointer.bytes);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), proof.pointer.sha256);
  const names = [...bytes.toString('utf8').matchAll(/^location-name:\s*(.+)$/gm)].map(match => match[1].trim());
  assert.deepEqual(names, proof.pointer.location_names);
  assert.equal(names.length, 2);
  const ccns = ['214002', '214004', '214012', '214018'];
  assert.deepEqual(proof.records.map(row => row.ccn), ccns);
  assert.ok(proof.records.every(row => !names.some(name => name.toLowerCase() === row.name.toLowerCase())));
  const manual = new Map(JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-manual-access-observations.json')))
    .records.map(row => [row.ccn, row]));
  const queue = new Map(JSON.parse(fs.readFileSync(path.join(audit, 'unresolved-investigation-worklist.json')))
    .records.map(row => [row.ccn, row]));
  const snapshot = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-verification.json')));
  const snapshotByCcn = new Map(snapshot.records.map(row => [row.ccn, row]));
  for (const ccn of ccns) {
    assert.equal(manual.get(ccn)?.proof_file, 'reconciliation-maryland-psychiatric-pointer-coverage-proof.json');
    assert.equal(manual.get(ccn)?.pointer_cached_sha256, proof.pointer.sha256);
    assert.equal(manual.get(ccn)?.latest_scope_review?.proof_file,
      'reconciliation-maryland-state-hospital-scope-proof-2026-09-27.json');
    assert.equal(manual.get(ccn)?.latest_scope_review?.pointer_mrf_status,
      'unresolved-not-asserted-by-this-scope-classification');
    assert.equal(queue.has(ccn), true, 'state operation alone does not establish the CMS exception');
    assert.notEqual(snapshotByCcn.get(ccn)?.disposition, 'scope-exempt-state-hospital');
    assert.equal(snapshotByCcn.get(ccn)?.mrf_url, '');
  }
});
