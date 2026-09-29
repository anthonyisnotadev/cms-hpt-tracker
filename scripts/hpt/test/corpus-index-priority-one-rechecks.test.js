'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parsePointer } = require('../lib/parse');

const root = path.resolve(__dirname, '../../..');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

test('priority-one pointer rechecks retain exact bytes and selected-file entries', () => {
  const report = require(path.join(root, 'data/hpt-audit/corpus-index-priority-one-rechecks.json'));
  assert.deepEqual(report.records.map(row => row.ccn).sort(), ['310118', '320001', '360098']);
  for (const row of report.records) {
    assert.ok(Number.isFinite(Date.parse(row.checked_at)));
    assert.ok(row.http_status >= 200 && row.http_status < 300);
    const bytes = fs.readFileSync(path.join(root, row.raw_artifact));
    assert.equal(bytes.length, row.bytes_retained);
    assert.equal(sha(bytes), row.sha256);
    const matches = parsePointer(bytes.toString('utf8')).entries
      .filter(entry => entry.mrfUrls?.includes(row.selected_mrf_url));
    assert.ok(matches.length > 0, row.ccn);
    assert.deepEqual(matches.map(entry => entry.locationName), row.selected_location_names);
  }
  assert.equal(report.records.filter(row => row.reviewed_hash_matches).length, 2);
});
