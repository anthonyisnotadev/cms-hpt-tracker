'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '../../..');
const proof = require(path.join(root, 'data/hpt-audit/reconciliation-eamc-lanier-sibling-pointer-proof.json'));
const queue = require(path.join(root, 'data/hpt-audit/nationwide-reconciliation-queue.json'));

test('Lanier cannot inherit the Opelika pointer entry or archive header', () => {
  assert.equal(proof.ccn, '010780');
  assert.equal(proof.pointer_entries.length, 1);
  assert.equal(proof.pointer_entries[0].location_name, 'East Alabama Medical Center');
  assert.equal(proof.pointer_lanier_entry_present, false);
  assert.match(proof.official_identity, /4800 48th Street, Valley, AL/);
  assert.match(proof.archive_header_address, /2000 PEPPERELL PKWY OPELIKA, AL/);
  const sample = fs.readFileSync(path.join(root, proof.archive_sample_path));
  assert.equal(sample.length, proof.archive_sample_bytes);
  assert.equal(crypto.createHash('sha256').update(sample).digest('hex'), proof.archive_sample_sha256);
  const row = queue.find(item => item.ccn === proof.ccn);
  assert.equal(row.workstream, 'genuinely-unresolved-investigation');
  assert.equal(row.manual_access_observation.proof_file, 'reconciliation-eamc-lanier-sibling-pointer-proof.json');
  assert.match(row.next_action, /Do not assign the current Opelika/);
});
