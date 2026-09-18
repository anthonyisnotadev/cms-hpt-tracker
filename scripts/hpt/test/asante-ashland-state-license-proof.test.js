'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const audit = path.resolve(__dirname, '../../../data/hpt-audit');
const read = name => JSON.parse(fs.readFileSync(path.join(audit, name), 'utf8'));

test('dated Oregon state-license proof distinguishes satellite relationship from Medicare CCN status', () => {
  const proof = read('reconciliation-asante-ashland-state-license-proof.json');
  assert.deepEqual(proof.ccns, ['380005', '380018']);
  for (const document of [proof.licensed_hospitals, proof.licensed_satellites]) {
    assert.equal(document.file_updated_on, '2026-07-30');
    assert.match(document.sha256, /^[a-f0-9]{64}$/);
    assert.ok(document.bytes > 0 && document.bytes < 1000000);
    assert.match(document.url, /^https:\/\/www\.oregon\.gov\/.*\.pdf$/);
  }
  assert.match(proof.licensed_satellites.satellite, /14-0451-8.*280 Maple Street/);
  assert.match(proof.licensed_hospitals.observation, /not a Medicare CCN termination record/);
  const rows = new Map(read('nationwide-reconciliation.json').records.map(row => [row.ccn, row]));
  const former = rows.get('380005'), parent = rows.get('380018');
  assert.equal(former.workstream, 'genuinely-unresolved-investigation');
  assert.equal(parent.standing_finding, 'compliant-observed');
  assert.equal(parent.workstream, 'standing-evidence-follow-up');
  assert.match(former.next_action, /effective-dated Medicare CCN status/);
  assert.match(parent.next_action, /Asante Ashland satellite coverage/);
  assert.notEqual(former.standing_mrf_url, parent.standing_mrf_url);
  const standing = read('standing-evidence-followup-worklist.json').records.find(row => row.ccn === '380018');
  assert.equal(standing.next_action, parent.manual_access_observation.next_action);
});
