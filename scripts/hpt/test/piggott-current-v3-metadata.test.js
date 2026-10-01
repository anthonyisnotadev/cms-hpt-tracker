'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
const auditDir = path.join(root, 'data/hpt-audit');

test('Piggott current 3.0.0 metadata supersedes but preserves the earlier 3.00 observation', () => {
  const ledger = JSON.parse(fs.readFileSync(path.join(auditDir, 'reviewed-resolutions.json'), 'utf8'));
  const resolution = ledger.find(row => row.ccn === '041330');
  assert.ok(resolution);
  assert.equal(resolution.evidence.version, '3.0.0');
  assert.equal(resolution.evidence.date, '2026-09-14');
  assert.equal(resolution.evidence.completeFileValidated, false);
  assert.equal(resolution.evidence_history?.[0]?.version, '3.00');
  assert.equal(resolution.evidence_history[0].date, '2026-04-02');

  const proofDoc = JSON.parse(fs.readFileSync(path.join(auditDir, 'nationwide-file-byte-proof.json'), 'utf8'));
  const proof = proofDoc.records.find(row => row.ccns?.includes('041330')
    && row.url === resolution.evidence.url);
  assert.ok(proof, 'retained byte proof is bound to this CCN and exact URL');
  assert.equal(proof.requested_range, resolution.evidence.sampleRange);
  assert.equal(proof.bytes_retained, resolution.evidence.sampleBytes);
  assert.equal(proof.sha256, resolution.evidence.sampleSha256);
  assert.equal(proof.raw_artifact, resolution.evidence.sampleArtifact);

  const bytes = fs.readFileSync(path.resolve(root, proof.raw_artifact));
  assert.equal(bytes.length, proof.bytes_retained);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), proof.sha256);
  const parsed = require('../lib/probe').extractDeclared(bytes, 'csv');
  assert.equal(parsed.version, '3.0.0');
  assert.equal(parsed.raw, '2026-09-14');
  assert.equal(parsed.hospitalName, 'PIGGOTT COMMUNITY HOSPITAL');

  const view = require('../lib/reviewed-resolutions').loadReviewedView(auditDir, { nationwide: false });
  const manifest = view.manifest.find(row => row.ccn === '041330');
  assert.equal(manifest.mrf_cms_version, '3.0.0');
  assert.equal(manifest.mrf_last_updated, '2026-09-14');
  assert.equal(manifest.mrf_url, resolution.evidence.url);
});
