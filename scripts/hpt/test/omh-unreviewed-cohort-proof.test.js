'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parsePointer } = require('../lib/parse');
const { extractDeclared } = require('../lib/probe');

const root = path.resolve(__dirname, '../../..');
const proof = require(path.join(root, 'data/hpt-audit/reconciliation-omh-unreviewed-cohort-proof.json'));
const queue = require(path.join(root, 'data/hpt-audit/unresolved-investigation-worklist.json'));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

test('fourteen OMH tier-two reviews keep shared-file and omitted-entry questions distinct', () => {
  const stage = path.join(root, 'data/hpt-audit/.domain-discovery/reconciliation/omh-shared');
  const pointer = fs.readFileSync(path.join(stage, 'pointer.txt'));
  const file = fs.readFileSync(path.join(stage, 'file.bin'));
  const directory = fs.readFileSync(path.join(root, proof.directory_retained_file));
  assert.equal(sha(pointer), proof.pointer_sha256);
  assert.equal(sha(file), proof.shared_file_sha256);
  assert.equal(sha(directory), proof.directory_sha256);
  assert.ok(proof.pointer_recheck_http_status >= 200 && proof.pointer_recheck_http_status < 300);
  assert.equal(proof.directory_http_status, 200);
  assert.ok(Date.parse(proof.pointer_rechecked_at) >= Date.parse(proof.shared_file_retained_at));
  const entries = parsePointer(pointer.toString('utf8')).entries;
  assert.equal(entries.length, 20);
  const declared = extractDeclared(file, 'csv');
  assert.equal(declared.hospitalName, 'Greater Binghamton Mental Health Facility');
  assert.equal(declared.address, '425 Robinson St, Binghamton, NY 13904');
  assert.equal(declared.licenseState, null);
  assert.equal(proof.records.length, 14);
  assert.equal(new Set(proof.records.map(row => row.ccn)).size, 14);
  const named = proof.records.filter(row => row.pointer_entry_name);
  const absent = proof.records.filter(row => !row.pointer_entry_name);
  assert.equal(named.length, 12);
  assert.deepEqual(absent.map(row => row.ccn), ['334060', '334061']);
  for (const row of proof.records) {
    const work = queue.records.find(item => item.ccn === row.ccn);
    assert.equal(work?.reviewed_follow_up, true);
    assert.deepEqual(work.reviewed_sources, ['manual-access']);
    assert.equal(work.current_disposition, 'pointer-facility-match-unresolved');
    assert.equal(work.next_action, row.next_action);
    assert.equal(work.candidate_file_recorded, Boolean(row.pointer_entry_name));
    assert.equal(directory.toString('utf8').includes(row.directory_name), true);
    assert.equal(entries.filter(entry => entry.locationName === row.pointer_entry_name).length,
      row.pointer_entry_name ? 1 : 0);
    assert.equal(row.shared_file_declared_name, declared.hospitalName);
    assert.equal(row.pointer_recheck_http_status, proof.pointer_recheck_http_status);
    assert.notEqual(row.roster_city.toUpperCase(), 'BINGHAMTON');
  }
});
