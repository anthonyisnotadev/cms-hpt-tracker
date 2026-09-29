'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parsePointer } = require('../lib/parse');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = require(path.join(audit, 'reconciliation-montefiore-new-rochelle-pointer-page-proof.json'));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

test('Montefiore CR-only root and newer page file retain separate roles and ZIP exception', () => {
  const raw = fs.readFileSync(path.join(root, 'cms_data/hpt/pointer-corpus/raw/montefiorenewrochelle.org-aa9d68ea6d9a.txt'));
  assert.equal(hash(raw), proof.pointer_sha256);
  assert.equal(raw.includes(10), false);
  assert.equal(parsePointer(raw.toString('utf8')).entries[0].mrfUrl, proof.pointer_mrf_url);
  for (const [file, digest] of [
    [proof.pointer_file_retained_sample, proof.pointer_file_sample_sha256],
    [proof.page_file_retained_sample, proof.page_file_sample_sha256],
  ]) {
    const sample = fs.readFileSync(path.join(root, file));
    assert.equal(sample.length, 262144);
    assert.equal(hash(sample), digest);
  }
  assert.notEqual(proof.pointer_mrf_url, proof.page_mrf_url);
  assert.ok(Date.parse(proof.pointer_file_date) < Date.parse(proof.page_file_date));
  assert.equal(proof.roster_zip, '10802');
  assert.ok(proof.page_file_declared_address.endsWith('10801'));
  const view = loadReviewedView(audit);
  const row = view.compliance.find(item => item.ccn === proof.ccn);
  assert.equal(row.finding, 'pointer-links-older-mrf-than-source-page');
  assert.equal(row.pointer_url, proof.pointer_url);
  assert.equal(row.mrf_url, proof.page_mrf_url);
  assert.equal(view.history[proof.ccn].finding, 'not-assessed-domain-unknown');
});
