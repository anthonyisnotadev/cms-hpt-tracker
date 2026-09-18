'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('Ozark HTML root is not promoted to a pointer-linked verification', () => {
  const { record: row } = JSON.parse(fs.readFileSync(path.join(audit,
    'reconciliation-ozark-pointer-file-proof.json'), 'utf8'));
  const ledger = JSON.parse(fs.readFileSync(path.join(audit, 'reviewed-resolutions.json'), 'utf8'));
  const standing = loadReviewedView(audit).compliance.find(item => item.ccn === row.ccn);
  const bytes = fs.readFileSync(path.join(root, row.retained_sample));
  assert.equal(bytes.length, row.retained_bytes);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), row.current_mrf_sha256);
  assert.equal(row.pointer_http_status, 200);
  assert.match(row.pointer_content_type, /^text\/html/i);
  const resolution = ledger.find(item => item.ccn === row.ccn);
  assert.equal(resolution.action, 'replace-observation');
  assert.equal(resolution.evidence.observedFinding, 'root-pointer-html-page-with-official-page-file');
  assert.equal(standing.finding, resolution.evidence.observedFinding);
  assert.equal(standing.mrf_url, row.current_mrf_url);
});
