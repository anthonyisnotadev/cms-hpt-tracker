'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');

function readEmbeddedTrackerData() {
  const html = fs.readFileSync(path.join(root, 'tracker.html'), 'utf8');
  const marker = '<script id="tracker-data" type="application/json">';
  const start = html.indexOf(marker);
  assert.notEqual(start, -1, 'tracker data script is present');
  const jsonStart = start + marker.length;
  const jsonEnd = html.indexOf('</script>', jsonStart);
  assert.notEqual(jsonEnd, -1, 'tracker data script is closed');
  return JSON.parse(html.slice(jsonStart, jsonEnd));
}

test('embedded tracker rows reconcile exactly to nationwide verification CCNs', () => {
  const source = JSON.parse(fs.readFileSync(
    path.join(root, 'data', 'hpt-audit', 'nationwide-verification.json'), 'utf8'));
  const embedded = readEmbeddedTrackerData();
  assert.ok(Array.isArray(source.records));
  assert.ok(Array.isArray(embedded.rows));
  assert.equal(source.records.length, 5419);
  assert.equal(embedded.rows.length, source.records.length);

  const sourceCcns = source.records.map(record => record.ccn);
  const trackerCcns = embedded.rows.map(row => row[0]);
  assert.equal(new Set(sourceCcns).size, sourceCcns.length, 'source CCNs are unique');
  assert.equal(new Set(trackerCcns).size, trackerCcns.length, 'embedded CCNs are unique');
  assert.deepEqual(trackerCcns, sourceCcns,
    'tracker row order and membership must match the authoritative nationwide source');
});
