'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');

const { csvToObjects } = require('../lib/util');
const { toRFC4180 } = require('../pointer-corpus');
const { runCombine, splitCcns } = require('../combine-corpus');

async function tempDir(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'hpt-combine-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  return root;
}

test('splitCcns trims, deduplicates, and sorts exact facility links', () => {
  assert.deepEqual(splitCcns('222222 | 111111|222222'), ['111111', '222222']);
});

test('full outer join is exact, auditable, and deterministic', async t => {
  const root = await tempDir(t);
  const manifestFile = path.join(root, 'manifest.csv');
  const corpusFile = path.join(root, 'corpus.csv');
  const outputFile = path.join(root, 'combined.csv');
  const manifestColumns = ['ccn', 'hospital_name', 'state', 'mrf_url', 'pointer_url'];
  const corpusColumns = [
    'record_status', 'pointer_sha256', 'entry_index', 'mrf_url_index',
    'mrf_url', 'matched_ccns', 'related_ccns', 'extra_fields_json'
  ];
  const manifestRows = [
    { ccn: '111111', hospital_name: 'Exact Hospital', state: 'AA', mrf_url: 'https://files.test/a.csv', pointer_url: 'https://a.test/cms-hpt.txt' },
    { ccn: '222222', hospital_name: 'Duplicate A', state: 'BB', mrf_url: 'https://files.test/b.csv', pointer_url: 'https://b.test/cms-hpt.txt' },
    { ccn: '222222', hospital_name: 'Duplicate B', state: 'BB', mrf_url: 'https://files.test/c.csv', pointer_url: 'https://c.test/cms-hpt.txt' },
    { ccn: '333333', hospital_name: 'Database Only', state: 'CC', mrf_url: 'https://files.test/d.csv', pointer_url: '' },
    { ccn: '444444', hospital_name: 'Changed URL', state: 'DD', mrf_url: 'https://files.test/new.csv', pointer_url: '' }
  ];
  const corpusRows = [
    { record_status: 'ok', pointer_sha256: 'sha-a', entry_index: '1', mrf_url_index: '1', mrf_url: 'https://files.test/a.csv', matched_ccns: '111111', related_ccns: '999999', extra_fields_json: '' },
    { record_status: 'ok', pointer_sha256: 'sha-b', entry_index: '1', mrf_url_index: '1', mrf_url: 'https://files.test/c.csv', matched_ccns: '222222', related_ccns: '', extra_fields_json: '' },
    { record_status: 'ok', pointer_sha256: 'sha-many', entry_index: '1', mrf_url_index: '1', mrf_url: 'https://files.test/a.csv', matched_ccns: '111111|999999', related_ccns: '', extra_fields_json: '' },
    { record_status: 'ok', pointer_sha256: 'sha-ambiguous', entry_index: '1', mrf_url_index: '1', mrf_url: 'https://files.test/no-match.csv', matched_ccns: '222222', related_ccns: '', extra_fields_json: '' },
    { record_status: 'ok', pointer_sha256: 'sha-changed', entry_index: '1', mrf_url_index: '1', mrf_url: 'https://files.test/old.csv', matched_ccns: '444444', related_ccns: '', extra_fields_json: '' },
    { record_status: 'missing-mrf-url', pointer_sha256: 'sha-related', entry_index: '1', mrf_url_index: '', mrf_url: '', matched_ccns: '', related_ccns: '333333', extra_fields_json: '{"note":"not a facility match"}' }
  ];
  await fsp.writeFile(manifestFile, toRFC4180(manifestRows, manifestColumns));
  await fsp.writeFile(corpusFile, toRFC4180(corpusRows, corpusColumns));

  const first = await runCombine({ manifest: manifestFile, corpus: corpusFile, out: outputFile });
  assert.equal(first.manifestRows, 5);
  assert.equal(first.corpusRows, 6);
  assert.equal(first.corpusRowsRepresented, 6);
  assert.equal(first.databaseRowsRepresented, 5);

  const rows = csvToObjects(await fsp.readFile(outputFile, 'utf8'));
  const exact = rows.find(row => row.corpus_pointer_sha256 === 'sha-a');
  assert.equal(exact.join_status, 'matched');
  assert.equal(exact.join_method, 'exact-ccn+mrf-url');
  assert.equal(exact.db_hospital_name, 'Exact Hospital');

  const duplicate = rows.find(row => row.corpus_pointer_sha256 === 'sha-b');
  assert.equal(duplicate.db_hospital_name, 'Duplicate B');
  assert.equal(duplicate.manifest_candidate_count, '2');
  assert.equal(rows.some(row => row.corpus_pointer_sha256 === 'sha-b' && row.db_hospital_name === 'Duplicate A'), false);

  const multi = rows.filter(row => row.corpus_pointer_sha256 === 'sha-many');
  assert.deepEqual(multi.map(row => row.joined_ccn).sort(), ['111111', '999999']);
  assert.equal(multi.find(row => row.joined_ccn === '999999').join_status, 'ccn-not-in-current-database');

  const ambiguous = rows.find(row => row.corpus_pointer_sha256 === 'sha-ambiguous');
  assert.equal(ambiguous.join_status, 'ambiguous-duplicate-ccn');
  assert.equal(ambiguous.db_row_number, '');
  assert.equal(ambiguous.manifest_candidate_count, '2');

  const changed = rows.find(row => row.corpus_pointer_sha256 === 'sha-changed');
  assert.equal(changed.join_status, 'matched-ccn-url-differs');
  assert.equal(changed.join_method, 'exact-ccn');

  const relatedOnly = rows.find(row => row.corpus_pointer_sha256 === 'sha-related');
  assert.equal(relatedOnly.join_status, 'unmatched-corpus');
  assert.equal(relatedOnly.joined_ccn, '');
  assert.equal(relatedOnly.db_row_number, '');

  assert.equal(rows.some(row => row.join_status === 'database-only' && row.db_ccn === '333333'), true);
  assert.equal(new Set(rows.map(row => row.combined_row_id)).size, rows.length);

  const firstBytes = await fsp.readFile(outputFile);
  await runCombine({ manifest: manifestFile, corpus: corpusFile, out: outputFile });
  assert.deepEqual(await fsp.readFile(outputFile), firstBytes);
});
