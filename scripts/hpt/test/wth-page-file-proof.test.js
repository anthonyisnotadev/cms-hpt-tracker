'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('WTH page-linked facility proofs remain distinct, hash-bound and non-pointer-linked', () => {
  const artifact = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-wth-page-file-proofs.json'), 'utf8'));
  const ledger = JSON.parse(fs.readFileSync(path.join(audit, 'reviewed-resolutions.json'), 'utf8'));
  const standing = new Map(loadReviewedView(audit).compliance.map(row => [row.ccn, row]));
  assert.deepEqual(new Set(artifact.records.map(row => row.ccn)), new Set(['440002', '441316', '441320']));
  assert.equal(new Set(artifact.records.map(row => row.current_mrf_url)).size, 3);
  for (const proof of artifact.records) {
    const bytes = fs.readFileSync(path.join(root, proof.retained_sample));
    assert.equal(bytes.length, proof.retained_bytes);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), proof.current_mrf_sha256);
    assert.equal(proof.pointer_http_status, 404);
    const resolution = ledger.find(row => row.ccn === proof.ccn);
    assert.equal(resolution.evidence.observedFinding, 'official-page-mrf-root-pointer-unavailable');
    assert.equal(resolution.evidence.url, proof.current_mrf_url);
    assert.equal(resolution.evidence.date, proof.declared_date);
    assert.equal(standing.get(proof.ccn).finding, resolution.evidence.observedFinding);
    assert.equal(standing.get(proof.ccn).mrf_url, proof.current_mrf_url);
  }
});
