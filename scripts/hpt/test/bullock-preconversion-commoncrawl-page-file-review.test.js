'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const read = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));

test('Bullock pre-conversion archived pricing page is retained without becoming a CMS MRF claim', () => {
  const proof = read('data/hpt-audit/reconciliation-bullock-preconversion-commoncrawl-page-file-review-2026-09-28.json');
  assert.equal(proof.ccn, '010110');
  assert.equal(proof.preconversion_publisher_page_captures.length, 2);
  const [older, newer] = proof.preconversion_publisher_page_captures;
  assert.equal(older.captured_at, '2023-12-06T21:17:19Z');
  assert.equal(newer.captured_at, '2024-04-23T11:37:28Z');
  assert.ok(Date.parse(newer.captured_at) < Date.parse('2024-05-01T00:00:00Z'));
  assert.equal(older.url, newer.url);
  assert.equal(older.linked_file, newer.linked_file);
  assert.match(older.linked_file, /BCH%20CDM%20for%20Webpage%20upload\.xlsx/);
  assert.match(newer.page_description, /chargemaster/i);
  for (const capture of [older, newer]) {
    assert.equal(capture.http_status, 200);
    const range = /^bytes (\d+)-(\d+)\//.exec(capture.warc_range);
    assert.ok(range);
    assert.equal(capture.warc_range_bytes, Number(range[2]) - Number(range[1]) + 1);
    assert.match(capture.warc_range_sha256, /^[a-f0-9]{64}$/);
  }
  assert.equal(proof.outcome.new_mrf_bytes, false);
  assert.equal(proof.outcome.pointer_linkage_established, false);
  assert.equal(proof.outcome.ccn_disposition_changed, false);
  assert.equal(proof.outcome.unresolved_count_change, 0);
  assert.match(proof.outcome.next_action, /CMS pointer\/MRF capture/);
  assert.equal(proof.follow_up_2026_09_28.cms_reh_quality_dataset.provider_id, '010779');
  assert.equal(proof.follow_up_2026_09_28.disposition_changed, false);
  assert.equal(proof.follow_up_2026_09_28.count_effect, 0);

  const queue = read('data/hpt-audit/unresolved-investigation-worklist.json');
  const item = queue.records.find(row => row.ccn === '010110');
  assert.ok(item);
  assert.equal(item.current_disposition, 'pointer-facility-match-unresolved');
  assert.match(item.next_action, /publisher-confirmed historical CMS-format MRF\/pointer evidence/);
  assert.match(item.next_action, /do not repeat the current pointer\/page-label/);
  assert.match(item.next_action, /genuinely new dated archive source/);
});
