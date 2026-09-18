'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { audit } = require('../audit-corpus-state-index');

test('corpus index audit flags only versions without a successful final-state target', () => {
  const state = { targets: {
    a: { status: 'ok', finalUrl: 'https://a.test/cms-hpt.txt', sha256: 'aaa' },
    b: { status: 'failed', finalUrl: 'https://b.test/cms-hpt.txt', sha256: 'bbb' }
  } };
  const rows = [
    { final_url: 'https://a.test/cms-hpt.txt', pointer_sha256: 'aaa' },
    { final_url: 'https://b.test/cms-hpt.txt', pointer_sha256: 'bbb', matched_ccns: '111111' },
    { final_url: 'https://b.test/cms-hpt.txt', pointer_sha256: 'bbb', matched_ccns: '222222' }
  ];
  const result = audit(state, rows);
  assert.equal(result.summary.documents_without_successful_target, 1);
  assert.equal(result.summary.rows_without_successful_target, 2);
  assert.equal(result.summary.matched_ccns_to_review, 2);
  assert.equal(result.discrepancies[0].issue, 'index-version-with-failed-current-target');
  assert.deepEqual(result.discrepancies[0].matched_ccns, ['111111', '222222']);
});

test('generated corpus-index discrepancy inventory is source-bound and prioritized', () => {
  const root = path.resolve(__dirname, '../../..');
  const report = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/corpus-state-index-discrepancies.json')));
  const state = JSON.parse(fs.readFileSync(path.join(root, 'cms_data/hpt/pointer-corpus/crawl-state.json')));
  assert.equal(report.summary.corpus_documents, state.summary.pointerDocuments);
  assert.equal(report.summary.documents_without_successful_target, report.discrepancies.length);
  assert.equal(report.summary.matched_ccns_to_review,
    new Set(report.discrepancies.flatMap(item => item.matched_ccns)).size);
  assert.ok(report.discrepancies.every(item => item.priority === 1 || item.priority === 2));
  assert.ok(report.discrepancies.every(item => item.retained_raw_status === 'hash-corroborated'));
  for (const [name, file] of Object.entries({
    'crawl-state.json': 'cms_data/hpt/pointer-corpus/crawl-state.json',
    'cms_hpt_entries.csv': 'cms_data/hpt/pointer-corpus/cms_hpt_entries.csv'
  })) {
    const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
    assert.equal(report.source_sha256[name], hash);
  }
});
