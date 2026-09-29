'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('HPI source-page files remain CCN-specific and distinct from 404 pointer targets', () => {
  const { records } = JSON.parse(fs.readFileSync(path.join(audit,
    'reconciliation-hpi-pointer-page-proofs.json'), 'utf8'));
  const ledger = JSON.parse(fs.readFileSync(path.join(audit, 'reviewed-resolutions.json'), 'utf8'));
  const standing = new Map(loadReviewedView(audit).compliance.map(row => [row.ccn, row]));
  assert.deepEqual(new Set(records.map(row => row.ccn)), new Set(['241320', '260025', '281357', '241369']));
  assert.equal(new Set(records.map(row => row.current_mrf_url)).size, 4);
  assert.equal(new Set(records.map(row => row.current_mrf_sha256)).size, 4);
  for (const row of records) {
    const bytes = fs.readFileSync(path.join(root, row.retained_sample));
    assert.equal(bytes.length, 262144);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), row.current_mrf_sha256);
    assert.equal(row.pointer_mrf_http_status, 404);
    assert.equal(row.current_mrf_http_status, 206);
    assert.notEqual(row.pointer_mrf_url, row.current_mrf_url);
    assert.equal(row.rendered_source_download_url, row.current_mrf_url);
    assert.equal(row.declared_state, { '241320': 'MN', '260025': 'MO', '281357': 'NE', '241369': 'MN' }[row.ccn]);
    const resolution = ledger.find(item => item.ccn === row.ccn);
    assert.equal(resolution.evidence.observedFinding, 'pointer-links-unavailable-mrf-source-page-current-file');
    assert.equal(resolution.evidence.pointerMrfUrl, row.pointer_mrf_url);
    assert.equal(resolution.evidence.url, row.current_mrf_url);
    assert.equal(resolution.evidence.sourcePageShellSha256, row.source_page_shell_sha256);
    assert.equal(resolution.evidence.sourcePageSha256, undefined);
    assert.equal(standing.get(row.ccn).finding, resolution.evidence.observedFinding);
    assert.equal(standing.get(row.ccn).mrf_url, row.current_mrf_url);
  }
});
