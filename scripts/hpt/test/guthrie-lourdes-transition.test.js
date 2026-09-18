'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { applyResolutions } = require('../lib/reviewed-resolutions');
const { csvToObjects } = require('../lib/util');

const root = path.resolve(__dirname, '../../..');
const proof = JSON.parse(fs.readFileSync(path.join(root,
  'data/hpt-audit/reconciliation-guthrie-lourdes-transition-proof.json'), 'utf8'));
const resolution = JSON.parse(fs.readFileSync(path.join(root,
  'data/hpt-audit/reviewed-resolutions.json'), 'utf8'))
  .find(row => row.ccn === '330011');

test('Guthrie Lourdes keeps the blocked HTTP pointer URL distinct from the readable HTTPS page file', () => {
  const sample = fs.readFileSync(path.join(root, proof.retained_sample));
  assert.equal(sample.length, 262144);
  assert.equal(crypto.createHash('sha256').update(sample).digest('hex'), proof.pricing_file_sample_sha256);
  assert.equal(proof.pointer_mrf_url, proof.pricing_page_mrf_url.replace(/^https:/, 'http:'));
  assert.equal(proof.pointer_mrf_browser_observed_on, '2026-09-17');
  assert.notEqual(proof.pointer_sha256, 'cea0cd772a9854ade5fe5884217bc90b710dd890420d4f6f533df452bdb87605');
  const result = applyResolutions([resolution.base], [], [], [resolution]);
  assert.equal(result.compliance[0].finding, 'pointer-http-client-error-page-file-found');
  assert.equal(result.compliance[0].domain, 'guthrie.org');
  assert.equal(result.compliance[0].mrf_url, proof.pricing_page_mrf_url);
  assert.equal(result.manifest[0].pointer_via, 'reviewed-indirect');
  assert.throws(() => applyResolutions([resolution.base], [], [], [{ ...resolution,
    evidence: { ...resolution.evidence, browserTargetErrorCode: '' } }]));
  assert.throws(() => applyResolutions([resolution.base], [], [], [{ ...resolution,
    evidence: { ...resolution.evidence, url: proof.pointer_mrf_url } }]));
});

test('older Guthrie root bytes remain historical after exact-target refresh', () => {
  const state = JSON.parse(fs.readFileSync(path.join(root, 'cms_data/hpt/pointer-corpus/crawl-state.json'), 'utf8'));
  const old = state.targets['domain:guthrie.org'];
  assert.equal(old.status, 'superseded');
  assert.equal(old.reason, 'newer-exact-url-bytes');
  assert.equal(old.lastSuccessful.sha256, 'cea0cd772a9854ade5fe5884217bc90b710dd890420d4f6f533df452bdb87605');
  const raw = fs.readFileSync(path.join(root, old.lastSuccessful.rawFile));
  assert.equal(crypto.createHash('sha256').update(raw).digest('hex'), old.lastSuccessful.sha256);
  const rows = csvToObjects(fs.readFileSync(path.join(root,
    'cms_data/hpt/pointer-corpus/cms_hpt_entries.csv'), 'utf8'))
    .filter(row => row.pointer_host === 'guthrie.org' && row.location_name === 'Guthrie Lourdes Hospital');
  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => row.record_status === 'ok' && row.pointer_sha256 === proof.pointer_sha256));
  assert.ok(rows.every(row => row.mrf_url === proof.pointer_mrf_url && !row.matched_ccns.split('|').includes('330011')));
});
