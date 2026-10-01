'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const read = name => JSON.parse(fs.readFileSync(path.join(audit, name), 'utf8'));

test('Legent current full MRF is hash-bound, reconciled to CCN 670265, and supersedes the unresolved retry', () => {
  const proofName = 'reconciliation-legent-orthopedic-current-mrf-full-proof-2026-09-27.json';
  const proof = read(proofName);
  const resolution = read('reviewed-resolutions.json').find(row => row.ccn === '670265');
  const reconciliation = read('nationwide-reconciliation.json');
  const record = reconciliation.records.find(row => row.ccn === '670265');
  const worklist = read('unresolved-investigation-worklist.json');
  const queue = read('nationwide-reconciliation-queue.json');
  const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(audit, proofName))).digest('hex');

  assert.equal(proof.retrieval.status, 200);
  assert.equal(proof.retrieval.bytes_received, 68823627);
  assert.equal(proof.retrieval.sha256, '529d0d86ee53ab404edad4fec48d0c38eaa26f23c719ee09d28a3795259098ce');
  assert.equal(proof.csv_validation.usable_data_rows, 21076);
  assert.equal(proof.csv_validation.malformed_row_widths, 0);
  assert.equal(proof.current_cms_enrollment.ccn, '670265');
  assert.equal(proof.current_cms_enrollment.npi, '1316505043');
  assert.equal(resolution.evidence.fileSha256, proof.retrieval.sha256);
  assert.equal(resolution.evidence.pointerSha256, proof.root_pointer_sha256);
  const verification = read('nationwide-verification.json').records.find(row => row.ccn === '670265');
  assert.equal(verification.pointer_corpus_sha256, proof.root_pointer_sha256);
  assert.equal(verification.mrf_url, resolution.evidence.url);
  assert.equal(verification.disposition, 'pointer-linked-file-not-probed',
    'the later parser retry did not return file bytes; exact unchanged pointer bytes must not erase the reviewed file proof');
  assert.equal(resolution.base.city, 'GRAPEVINE');
  assert.match(resolution.note, /older CMS provider-roster Grapevine address is retained/i);
  assert.equal(reconciliation.summary.source_sha256[proofName], hash);
  assert.equal(record.latest_observation_superseded, true);
  assert.equal(record.workstream, 'consistent');
  assert.equal(worklist.records.some(row => row.ccn === '670265'), false);
  assert.equal(queue.some(row => row.ccn === '670265'), false);
});
