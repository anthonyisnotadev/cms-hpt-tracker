'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { csvToObjects } = require('../lib/util');
const { parsePointer } = require('../lib/parse');

const root = path.resolve(__dirname, '../../..');
const review = require(path.join(root, 'data/hpt-audit/reviewed-prime-corpus-links.json'));
const headers = new Map(csvToObjects(fs.readFileSync(path.join(root,
  'cms_data/hpt/nationwide-verification/mrf-headers.csv'), 'utf8')).map(row => [row.mrf_url, row]));
const roster = new Map(JSON.parse(fs.readFileSync(path.join(root, 'cms_data/hpt/roster.json'), 'utf8'))
  .map(row => [row.ccn, row]));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

test('28 reviewed Prime links remain bound to pointer bytes and exact facility headers', () => {
  assert.equal(review.excluded_ccn, '230031');
  assert.equal(review.records.length, 28);
  assert.equal(new Set(review.records.map(row => row.ccn)).size, 28);
  for (const item of review.records) {
    assert.notEqual(item.ccn, review.excluded_ccn);
    const raw = fs.readFileSync(path.join(root, item.pointer_raw_file));
    assert.equal(sha(raw), item.pointer_sha256, item.ccn);
    assert.ok(parsePointer(raw.toString('utf8')).entries.some(entry =>
      entry.mrfUrls?.includes(item.mrf_url)), item.ccn);
    const header = headers.get(item.mrf_url);
    assert.ok(header, item.ccn);
    assert.ok(header.header_matched_ccns.split('|').includes(item.ccn), item.ccn);
    assert.ok([item.identity_gate, 'exact-pointer-ccn-file-street-license-state-agree']
      .includes(header.identity_gate), item.ccn);
    assert.equal(header.mrf_address, item.mrf_declared_address, item.ccn);
    assert.equal(header.mrf_license_state, roster.get(item.ccn).state, item.ccn);
    assert.equal(header.mrf_last_updated, item.mrf_last_updated, item.ccn);
    assert.equal(header.mrf_cms_version, '3.0', item.ccn);
    assert.notEqual(item.displaced_mrf_url, item.mrf_url, item.ccn);
  }
});
