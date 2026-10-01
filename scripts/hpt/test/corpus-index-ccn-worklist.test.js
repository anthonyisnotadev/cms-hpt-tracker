'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { build } = require('../build-corpus-index-ccn-worklist');

test('per-CCN stale-index queue distinguishes no active link, different file and same file', () => {
  const audit = { discrepancies: [{ pointer_url: 'https://old.test/cms-hpt.txt',
    final_url: 'https://old.test/cms-hpt.txt', pointer_sha256: 'old', fetched_at: '2026-09-07',
    issue: 'index-version-without-successful-target', matched_ccns: ['1', '2', '3'] }] };
  const verification = { records: ['1', '2', '3'].map(ccn => ({ ccn, hospital_name: ccn,
    mrf_url: `https://files.test/${ccn}.json` })) };
  const state = { targets: { a: { status: 'ok', finalUrl: 'https://current.test/cms-hpt.txt', sha256: 'new' } } };
  const rows = [{ final_url: 'https://current.test/cms-hpt.txt', pointer_sha256: 'new',
    matched_ccns: '2|3', mrf_url: 'https://files.test/3.json' }];
  const result = build(audit, verification, state, rows);
  assert.deepEqual(result.summary.by_priority, { 1: 1, 2: 1, 3: 1, 4: 0 });
  assert.deepEqual(result.records.map(row => row.ccn), ['1', '2', '3']);
});

test('active file comparison ignores hostname case but preserves signed query case', () => {
  const audit = { discrepancies: [{ pointer_url: 'https://old.test/cms-hpt.txt',
    final_url: 'https://old.test/cms-hpt.txt', pointer_sha256: 'old', fetched_at: '2026-09-07',
    issue: 'index-hash-differs-from-successful-state', matched_ccns: ['1'] }] };
  const selected = 'https://hospitalpricedisclosure.com/download.aspx?pi=AbC';
  const verification = { records: [{ ccn: '1', hospital_name: 'A', mrf_url: selected }] };
  const state = { targets: { current: { status: 'ok', finalUrl: 'https://current.test/cms-hpt.txt', sha256: 'new' } } };
  const row = { final_url: 'https://current.test/cms-hpt.txt', pointer_sha256: 'new',
    matched_ccns: '1', mrf_url: 'https://HospitalPriceDisclosure.com/download.aspx?pi=AbC' };
  const matched = build(audit, verification, state, [row]).records[0];
  assert.equal(matched.selected_file_in_active_links, true);
  assert.equal(matched.priority, 3);
  const different = build(audit, verification, state, [{ ...row,
    mrf_url: 'https://HospitalPriceDisclosure.com/download.aspx?pi=abc' }]).records[0];
  assert.equal(different.selected_file_in_active_links, false);
  assert.equal(different.priority, 2);
});

test('later bounded root recheck moves a superseded historical link to follow-up', () => {
  const audit = { discrepancies: [{ pointer_url: 'https://old.test/cms-hpt.txt', final_url: 'https://old.test/cms-hpt.txt',
    pointer_sha256: 'old', fetched_at: '2026-09-07', issue: 'index-hash-differs-from-successful-state',
    matched_ccns: ['310118'] }] };
  const verification = { records: [{ ccn: '310118', hospital_name: 'Hudson', state: 'NJ',
    standing_finding: 'compliant-observed', disposition: 'verified-current-mrf',
    observation_role: 'superseded-retry', mrf_url: 'https://files.test/current.csv' }] };
  const recheck = { ccn: '310118', pointer_url: 'https://old.test/cms-hpt.txt',
    selected_mrf_url: 'https://files.test/current.csv', selected_file_in_pointer: true,
    http_status: 206, checked_at: '2026-09-17T00:00:00Z', sha256: 'new', reviewed_hash_matches: true };
  const result = build(audit, verification, { targets: {} }, [], [], [recheck]);
  assert.equal(result.records[0].priority, 4);
  assert.equal(result.records[0].reviewed_current_proof.source, 'bounded-current-root-recheck');
  assert.equal(build(audit, { records: [{ ...verification.records[0], observation_role: 'current-observation' }] },
    { targets: {} }, [], [], [recheck]).records[0].priority, 1);
});

test('hash-bound provenance recheck recognizes the exact current UNM root and selected file', () => {
  const audit = { discrepancies: [{ pointer_url: 'https://unmhealth.org/cms-hpt.txt',
    final_url: 'https://unmhealth.org/cms-hpt.txt', pointer_sha256: 'old', fetched_at: '2026-09-07',
    issue: 'index-hash-differs-from-successful-state', matched_ccns: ['320001'] }] };
  const file = 'https://unmhealth.org/patients-visitors/_files/unm.csv';
  const verification = { records: [{ ccn: '320001', hospital_name: 'UNM Hospital',
    pointer_corpus_checked_url: 'https://unmhealth.org/cms-hpt.txt',
    observation_role: 'incomplete-retry-standing-retained', mrf_url: file }] };
  const recheck = { ccn: '320001', checked_url: 'https://unmhealth.org/cms-hpt.txt',
    selected_mrf_url: file, complete_pointer_bytes: true, http_status: 200,
    observed_at: '2026-09-25T10:18:42.725Z', response_sha256: 'a'.repeat(64),
    retained_file: 'cms_data/hpt/pointer-corpus/raw/unmhealth.org.bin' };
  const record = build(audit, verification, { targets: {} }, [], [], [], [recheck]).records[0];
  assert.equal(record.priority, 4);
  assert.equal(record.reviewed_current_proof.source, 'later-hash-bound-provenance-recheck');
  assert.equal(record.reviewed_current_proof.reviewed_hash_matches_current_pointer, true);
  assert.equal(build(audit, verification, { targets: {} }, [], [], [], [{ ...recheck,
    checked_url: 'https://other.test/cms-hpt.txt' }]).records[0].priority, 1);
  assert.equal(build(audit, verification, { targets: {} }, [], [], [], [{ ...recheck,
    observed_at: '2026-09-01T00:00:00Z' }]).records[0].priority, 1);
});

test('generated per-CCN queue is source-bound and covers all indexed links', () => {
  const root = path.resolve(__dirname, '../../..');
  const report = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/corpus-index-ccn-worklist.json')));
  const source = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/corpus-state-index-discrepancies.json')));
  assert.equal(report.summary.ccns,
    new Set(source.discrepancies.flatMap(item => item.matched_ccns)).size);
  assert.equal(Object.values(report.summary.by_priority).reduce((sum, count) => sum + count, 0), report.summary.ccns);
  assert.equal(report.summary.by_priority['1'], 0);
  assert.equal(report.records.some(row => row.ccn === '310025'), false,
    'Bayonne current corpus entry is no longer stale after the hash-verified reindex');
  assert.equal(new Set(report.records.map(row => row.ccn)).size, report.records.length);
  for (const [name, file] of Object.entries({
    'corpus-state-index-discrepancies.json': 'data/hpt-audit/corpus-state-index-discrepancies.json',
    'nationwide-verification.json': 'data/hpt-audit/nationwide-verification.json',
    'crawl-state.json': 'cms_data/hpt/pointer-corpus/crawl-state.json',
    'cms_hpt_entries.csv': 'cms_data/hpt/pointer-corpus/cms_hpt_entries.csv',
    'reviewed-resolutions.json': 'data/hpt-audit/reviewed-resolutions.json',
    'corpus-index-priority-one-rechecks.json': 'data/hpt-audit/corpus-index-priority-one-rechecks.json',
    'pointer-provenance-discrepancy-rechecks.json': 'data/hpt-audit/pointer-provenance-discrepancy-rechecks.json'
  })) assert.equal(report.source_sha256[name], crypto.createHash('sha256')
    .update(fs.readFileSync(path.join(root, file))).digest('hex'));
  assert.equal(report.records.some(row => row.ccn === '320001'), false,
    'UNM current corpus entry is no longer stale after the hash-verified reindex');
});
