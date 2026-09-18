'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const audit = path.resolve(__dirname, '../../../data/hpt-audit');
const read = name => JSON.parse(fs.readFileSync(path.join(audit, name), 'utf8'));

test('completed exact-file archive proofs do not retain an inspect-archive instruction', () => {
  const rows = new Map(read('nationwide-reconciliation.json').records.map(row => [row.ccn, row]));
  const content = new Map(read('reconciliation-archive-content-proof.json').records.map(row => [row.ccn, row]));
  for (const ccn of ['100244', '100220', '100012', '220063', '220070', '220116']) {
    const row = rows.get(ccn);
    const proof = content.get(ccn);
    assert.equal(row.workstream, 'consistent', ccn);
    assert.equal(proof.mrf_url, row.standing_mrf_url, ccn);
    assert.match(proof.decompressed_sha256, /^[a-f0-9]{64}$/, ccn);
    assert.match(row.next_action, /Archive content proof for the exact standing file is complete/, ccn);
    assert.doesNotMatch(row.next_action, /Inspect a completed archive|Inspect completed archives/, ccn);
  }
});

test('completed address proof and later CCN resolution replace obsolete instructions', () => {
  const rows = new Map(read('nationwide-reconciliation.json').records.map(row => [row.ccn, row]));
  const nyee = rows.get('330100');
  assert.equal(nyee.source_proof_audit.status, 'proof-audit-complete');
  assert.match(nyee.next_action, /saved pointer and bounded file-byte proof audit is complete/);
  const mercy = rows.get('100167');
  assert.equal(mercy.latest_observation_superseded, true);
  assert.match(mercy.next_action, /later reviewed CCN resolution documents the roster-campus relationship/);
});
