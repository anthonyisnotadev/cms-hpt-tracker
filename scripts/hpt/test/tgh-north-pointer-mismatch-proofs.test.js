'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('TGH North Brooksville and Crystal River proofs stay facility-specific and page-linked', () => {
  const { records } = JSON.parse(fs.readFileSync(path.join(audit,
    'reconciliation-tgh-north-pointer-mismatch-proofs.json'), 'utf8'));
  const ledger = JSON.parse(fs.readFileSync(path.join(audit, 'reviewed-resolutions.json'), 'utf8'));
  const standing = new Map(loadReviewedView(audit).compliance.map(row => [row.ccn, row]));
  assert.deepEqual(new Set(records.map(row => row.ccn)), new Set(['100071', '100249']));
  assert.equal(new Set(records.map(row => row.current_mrf_url)).size, 2);
  for (const row of records) {
    const bytes = fs.readFileSync(path.join(root, row.retained_sample));
    assert.equal(bytes.length, 262144);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), row.current_mrf_sha256);
    assert.equal(row.pointer_mrf_http_status, 404);
    assert.notEqual(row.pointer_mrf_url, row.current_mrf_url);
    assert.ok(row.declared_address.includes(row.ccn === '100071' ? '17240 Cortez Blvd' : '6201 N Suncoast Blvd'));
    const resolution = ledger.find(item => item.ccn === row.ccn);
    assert.equal(resolution.evidence.observedFinding, 'pointer-links-unavailable-mrf-source-page-current-file');
    assert.equal(resolution.evidence.pointerMrfUrl, row.pointer_mrf_url);
    assert.equal(resolution.evidence.url, row.current_mrf_url);
    assert.equal(standing.get(row.ccn).finding, resolution.evidence.observedFinding);
    assert.equal(standing.get(row.ccn).mrf_url, row.current_mrf_url);
  }
});
