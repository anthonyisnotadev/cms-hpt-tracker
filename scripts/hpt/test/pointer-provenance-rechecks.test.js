'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parsePointer } = require('../lib/parse');
const { decode } = require('../lib/recovery-transport');
const { parseCSV } = require('../lib/util');

const root = path.resolve(__dirname, '../../..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const sha = body => crypto.createHash('sha256').update(body).digest('hex');

test('nine provenance conflicts have bounded, hash-bound recheck outcomes', () => {
  const audit = read('data/hpt-audit/pointer-provenance-discrepancy-rechecks.json');
  assert.equal(audit.records.length, 9);
  assert.equal(audit.summary.complete_structured_pointers, 6);
  assert.equal(audit.records.filter(row => row.http_status === 0).length, 3);
  for (const row of audit.records.filter(row => row.retained_file)) {
    const body = fs.readFileSync(path.join(root, row.retained_file));
    assert.equal(sha(body), row.response_sha256);
    assert.ok(parsePointer(decode(body)).entries.length > 0);
  }
});

test('Surgical Hospital of Oklahoma is a file-header/linkage review, not a verified recovery', () => {
  const proof = read('data/hpt-audit/reconciliation-surgical-oklahoma-pointer-file-proof.json');
  const pointer = fs.readFileSync(path.join(root, proof.pointer_retained_file));
  const sample = fs.readFileSync(path.join(root, proof.pointer_mrf_sample_retained_file));
  assert.equal(sha(pointer), proof.pointer_sha256);
  assert.equal(sha(sample), proof.pointer_mrf_sample_sha256);
  assert.equal(sample.length, 262144);
  const entry = parsePointer(decode(pointer)).entries[0];
  assert.equal(entry.locationName, 'Surgical Hospital of Oklahoma');
  assert.ok(entry.mrfUrls.includes(proof.pointer_mrf_url));
  const rows = parseCSV(decode(sample));
  const i = rows[0].indexOf('license_number | KS');
  assert.ok(i >= 0);
  assert.equal(rows[1][i], '');
  assert.equal(proof.pointer_mrf_declared_address, '100 SE 59th St. Oklahoma City, OK, 73129');
  assert.equal(proof.pricing_page_mrf_link_http_status, 404);
  const manual = read('data/hpt-audit/reconciliation-manual-access-observations.json').records.find(row => row.ccn === proof.ccn);
  const reconciliation = read('data/hpt-audit/nationwide-reconciliation.json').records.find(row => row.ccn === proof.ccn);
  const queue = read('data/hpt-audit/unresolved-investigation-worklist.json').records.find(row => row.ccn === proof.ccn);
  assert.equal(manual.proof_file, 'reconciliation-surgical-oklahoma-pointer-file-proof.json');
  assert.equal(reconciliation.workstream, 'genuinely-unresolved-investigation');
  assert.equal(queue.current_disposition, proof.disposition);
  assert.equal(queue.evidence_gate, 'file-header-and-page-linkage');
  assert.equal(queue.candidate_file_recorded, true);
});
