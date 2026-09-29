'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('CORE root 404 and separate inpatient/full page files remain explicit', () => {
  const { record: row } = JSON.parse(fs.readFileSync(path.join(audit,
    'reconciliation-core-institute-page-files-proof.json'), 'utf8'));
  const ledger = JSON.parse(fs.readFileSync(path.join(audit, 'reviewed-resolutions.json'), 'utf8'));
  const standing = loadReviewedView(audit).compliance.find(item => item.ccn === row.ccn);
  for (const [sample, size, sha] of [
    [row.inpatient_sample, row.inpatient_bytes, row.inpatient_sha256],
    [row.full_sample, row.full_bytes, row.full_sha256],
  ]) {
    const bytes = fs.readFileSync(path.join(root, sample));
    assert.equal(bytes.length, size);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), sha);
  }
  assert.equal(row.pointer_http_status, 404);
  assert.notEqual(row.inpatient_url, row.full_url);
  const resolution = ledger.find(item => item.ccn === row.ccn);
  assert.equal(resolution.action, 'replace-observation');
  assert.equal(resolution.evidence.fileScope, 'inpatient-labeled');
  assert.equal(resolution.evidence.fullFileOpeningMetadata,
    'no-hospital-name-date-or-version-in-bounded-opening');
  assert.equal(standing.finding, 'official-page-mrf-root-pointer-unavailable');
  assert.equal(standing.mrf_url, row.inpatient_url);
});
