'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('Lincoln keeps pointer-host DNS observations separate from the current page-linked CSV', () => {
  const { record: row } = JSON.parse(fs.readFileSync(path.join(audit,
    'reconciliation-lincoln-pointer-dns-proof.json'), 'utf8'));
  const ledger = JSON.parse(fs.readFileSync(path.join(audit, 'reviewed-resolutions.json'), 'utf8'));
  const standing = loadReviewedView(audit).compliance.find(item => item.ccn === row.ccn);
  const bytes = fs.readFileSync(path.join(root, row.retained_sample));
  assert.equal(row.pointer_mrf_http_status, 0);
  assert.equal(row.browser_error_code, 'ERR_NAME_NOT_RESOLVED');
  assert.notEqual(row.pointer_mrf_url, row.current_mrf_url);
  assert.equal(bytes.length, row.retained_bytes);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), row.current_mrf_sha256);
  const resolution = ledger.find(item => item.ccn === row.ccn);
  assert.equal(resolution.action, 'replace-observation');
  assert.equal(resolution.evidence.pointerMrfUrl, row.pointer_mrf_url);
  assert.equal(resolution.evidence.url, row.current_mrf_url);
  assert.equal(standing.finding, 'pointer-target-dns-unresolved-page-file-found');
  assert.equal(standing.mrf_url, row.current_mrf_url);
  assert.notEqual(standing.finding, 'compliant-observed');
});
