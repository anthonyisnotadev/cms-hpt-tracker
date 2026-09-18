'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parsePointer } = require('../lib/parse');
const { csvToObjects } = require('../lib/util');

const root = path.resolve(__dirname, '../../..');
const review = require(path.join(root, 'data/hpt-audit/sih-pointer-version-review.json'));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

test('SIH newer pointer bytes contain different targets from earlier verified JSON files', () => {
  const current = fs.readFileSync(path.join(root, review.root_pointer_retained_raw_file));
  assert.equal(sha(current), review.root_pointer_sha256);
  assert.notEqual(review.root_pointer_sha256, review.earlier_pointer_sha256);
  const entries = parsePointer(current.toString('utf8')).entries;
  assert.equal(entries.length, 4);
  const nationwide = require(path.join(root, 'data/hpt-audit/nationwide-verification.json'));
  const byCcn = new Map(nationwide.records.map(row => [row.ccn, row]));
  for (const facility of review.facilities) {
    const entry = entries.find(item => item.locationName.trim() === facility.pointer_location_name);
    assert.ok(entry, facility.ccn);
    assert.ok(entry.mrfUrls.every(url => url.includes('.ashx?')), facility.ccn);
    assert.ok(Number.isFinite(Date.parse(facility.target_checked_at)), facility.ccn);
    assert.ok(!entry.mrfUrls.includes(byCcn.get(facility.ccn).mrf_url), facility.ccn);
  }
  const corpus = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/hpt/pointer-corpus/cms_hpt_entries.csv'), 'utf8'));
  assert.equal(corpus.filter(row => row.pointer_sha256 === review.root_pointer_sha256
    && row.mrf_url.includes('.ashx?')).length, 4);
});
