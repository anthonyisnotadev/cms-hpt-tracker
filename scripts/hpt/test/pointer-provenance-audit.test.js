'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { build } = require('../audit-pointer-provenance');

const root = path.resolve(__dirname, '../../..');

test('pointer provenance audit separates exact matches, changed bytes, and unavailable index rows', () => {
  const verification = { records: [
    { ccn: '010001', pointer_corpus_checked_url: 'https://a.example/cms-hpt.txt', pointer_corpus_sha256: 'aaa' },
    { ccn: '010002', pointer_corpus_checked_url: 'https://b.example/cms-hpt.txt', pointer_corpus_sha256: 'bbb' },
    { ccn: '010003', pointer_corpus_checked_url: 'https://c.example/cms-hpt.txt', pointer_corpus_sha256: 'ccc' },
  ] };
  const corpus = [
    { pointer_url: 'https://a.example/cms-hpt.txt', pointer_sha256: 'aaa', fetched_at: '2026-09-15' },
    { pointer_url: 'https://b.example/cms-hpt.txt', pointer_sha256: 'new', fetched_at: '2026-09-16' },
  ];
  const audit = build(verification, corpus);
  assert.deepEqual(audit.summary, { hospitals: 3, pointer_provenance_rows: 3,
    exact_url_hash_correlated: 1, hash_unmatched_for_exact_url: 1, no_exact_url_corpus_entry: 1,
    manual_hash_bound_rows: 0,
    historical_pointer_rows: 0, historical_not_indexed: 0, historical_hash_correlated: 0, historical_hash_unmatched: 0 });
  assert.equal(audit.unmatched[0].ccn, '010002');
  assert.equal(audit.unindexed[0].ccn, '010003');
});

test('historical retained pointer is not counted as current provenance', () => {
  const audit = build({ records: [{ ccn: '010004', pointer_historical_checked_url: 'https://old.example/cms-hpt.txt',
    pointer_historical_sha256: 'old', pointer_historical_observed_at: '2026-09-07',
    pointer_historical_raw_integrity: 'hash-corroborated', pointer_state: 'request-or-tool-failure' }] }, []);
  assert.equal(audit.summary.pointer_provenance_rows, 0);
  assert.equal(audit.summary.historical_not_indexed, 1);
  assert.equal(audit.historical[0].later_pointer_state, 'request-or-tool-failure');
});

test('generated pointer provenance inventory covers the 5,419-CCN overlay', () => {
  const audit = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/pointer-provenance-discrepancies.json')));
  assert.equal(audit.summary.hospitals, 5419);
  assert.equal(audit.summary.pointer_provenance_rows,
    audit.summary.exact_url_hash_correlated + audit.summary.hash_unmatched_for_exact_url
      + audit.summary.no_exact_url_corpus_entry);
  assert.equal(audit.summary.hash_unmatched_for_exact_url, audit.unmatched.length);
  assert.equal(audit.summary.no_exact_url_corpus_entry, audit.unindexed.length);
  assert.ok(audit.unmatched.every(row => row.corpus_versions.every(version =>
    version.retained_raw_status === 'hash-corroborated')));
  assert.equal(new Set([...audit.unmatched, ...audit.unindexed].map(row => row.ccn)).size,
    audit.unmatched.length + audit.unindexed.length);
  assert.equal(audit.summary.historical_pointer_rows, audit.historical.length);
  assert.equal(audit.summary.historical_not_indexed + audit.summary.historical_hash_correlated
    + audit.summary.historical_hash_unmatched, audit.historical.length);
  assert.ok(audit.historical.every(row => row.retained_raw_status === 'hash-corroborated'));
  assert.equal(audit.summary.historical_not_indexed, 84);
  assert.equal(audit.summary.no_exact_url_corpus_entry, 0);
  assert.equal(audit.summary.manual_hash_bound_rows, 27);
});
