'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

test('retained identity queue is source-bound and keeps Tucson quarantine out', () => {
  const queue = JSON.parse(fs.readFileSync(path.join(audit, 'retained-identity-review-queue.json')));
  assert.equal(queue.sources['data/hpt-audit/nationwide-verification.json'],
    hash(fs.readFileSync(path.join(audit, 'nationwide-verification.json'))));
  assert.equal(queue.sources['cms_data/Hospital_General_Information.csv'],
    hash(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'))));
  assert.equal(queue.sources['data/hpt-audit/reviewed-resolutions.json'],
    hash(fs.readFileSync(path.join(audit, 'reviewed-resolutions.json'))));
  assert.equal(queue.sources['data/hpt-audit/claraprice-complete-metadata-2026-09-16.json'],
    hash(fs.readFileSync(path.join(audit, 'claraprice-complete-metadata-2026-09-16.json'))));
  assert.equal(queue.total, queue.records.length);
  assert.equal(queue.records.some(row => row.ccn === '030010'), false);
  assert.equal(queue.records.some(row => row.ccn === '110100'), false);
  assert.equal(queue.records.some(row => row.ccn === '060004'), false);
  assert.equal(queue.records.some(row => row.ccn === '144029'), false);
  for (const ccn of ['161310', '170780', '171382', '201312', '270003'])
    assert.equal(queue.records.some(row => row.ccn === ccn), false);
  const top = queue.records.filter(row => row.priority === '1-different-facility-match');
  assert.equal(queue.counts['1-different-facility-match'], top.length);
  assert.equal(queue.counts['2-license-state-conflict'],
    queue.records.filter(row => row.priority === '2-license-state-conflict').length);
  assert.equal(queue.counts['3-reviewed-same-target-metadata'],
    queue.records.filter(row => row.priority === '3-reviewed-same-target-metadata').length);
  assert.equal(queue.counts['3b-complete-file-metadata-observed'],
    queue.records.filter(row => row.priority === '3b-complete-file-metadata-observed').length);
  assert.equal(queue.counts['4-metadata-not-observed-in-sample'],
    queue.records.filter(row => row.priority === '4-metadata-not-observed-in-sample').length);
  assert.equal(queue.counts['5-unresolved-identity'],
    queue.records.filter(row => row.priority === '5-unresolved-identity').length);
  for (const item of queue.records.filter(row => row.priority === '4-metadata-not-observed-in-sample')) {
    assert.equal(item.observation_scope, 'bounded-sample-hospital-name-only');
    assert.equal(item.header_match_reason, 'mrf-header-metadata-not-observed-in-bounded-sample');
    assert.equal(item.source_header_match_reason, 'mrf-header-has-no-license-state');
    assert.match(item.next_action, /do not infer that date, address, version or license fields are absent/);
    assert.equal(item.declared_address, '');
    assert.equal(item.declared_license_state, '');
  }
  const reviewed = new Map(require(path.join(audit, 'reviewed-resolutions.json')).map(row => [row.ccn, row]));
  for (const item of queue.records.filter(row => row.priority === '3-reviewed-same-target-metadata')) {
    const evidence = reviewed.get(item.ccn)?.evidence;
    assert.equal(item.earlier_reviewed_same_target, true);
    assert.equal(item.earlier_reviewed_file_sha256, evidence?.fileSha256);
    assert.equal(item.earlier_reviewed_checked_at, evidence?.checked_at || '');
    assert.match(item.next_action, /without repeating facility discovery/);
  }
  const complete = new Map(require(path.join(audit, 'claraprice-complete-metadata-2026-09-16.json')).records.map(row => [row.ccn, row]));
  for (const item of queue.records.filter(row => row.priority === '3b-complete-file-metadata-observed')) {
    const evidence = complete.get(item.ccn);
    assert.equal(item.complete_file_metadata_observed, true);
    assert.equal(item.complete_file_sha256, evidence?.file_sha256);
    assert.equal(item.complete_file_last_updated_on, evidence?.last_updated_on);
    if (item.complete_file_pointer_identity_reviewed)
      assert.match(item.next_action, /assess CMS file structure/);
    else assert.match(item.next_action, /before changing the standing finding/);
  }
  // St. Andrew's (351307) now has a hash-bound reviewed resolution, so it is
  // no longer a retained-identity follow-up from the complete-file cohort.
  assert.equal(queue.counts['3b-complete-file-metadata-observed'], 24);
  assert.equal(queue.records.some(row => row.ccn === '351307'), false);
  for (const ccn of ['061327', '170103', '271311', '281306', '281313', '281334', '281349', '281350', '451373', '671300', '671303', '450508', '471306'])
    assert.equal(queue.records.some(row => row.ccn === ccn), false);
  for (const ccn of ['281312', '281316'])
    assert.equal(queue.records.find(row => row.ccn === ccn)?.complete_file_pointer_identity_reviewed, true);
  const manati = queue.records.find(row => row.ccn === '400132');
  assert.equal(manati?.priority, '3b-complete-file-metadata-observed');
  assert.equal(manati?.standing_and_observed_mrf_same_target, true);
  assert.equal(queue.records.find(row => row.ccn === '280065')?.priority, '3b-complete-file-metadata-observed');
  assert.equal(queue.records.find(row => row.ccn === '280065')?.complete_file_pointer_identity_reviewed, true);
  assert.equal(queue.counts['4-metadata-not-observed-in-sample'], 0);
  const firstSameState = top.findIndex(row => !row.cross_state_different_facility);
  const crossStatePrefixLength = firstSameState < 0 ? top.length : firstSameState;
  assert.ok(top.slice(0, crossStatePrefixLength).every(row => row.cross_state_different_facility));
  assert.ok(top.slice(crossStatePrefixLength).every(row => !row.cross_state_different_facility));
  assert.equal(queue.counts.cross_state_different_facility, crossStatePrefixLength);
  assert.ok(queue.records.every(row => !('standing_mrf_url' in row) && !('observed_mrf_url' in row)));
  const nationwide = require(path.join(audit, 'nationwide-verification.json'));
  for (const item of queue.records.filter(row => row.priority === '1-different-facility-match')) {
    const record = nationwide.records.find(row => row.ccn === item.ccn);
    assert.match(record.standing_evidence_reason, /contested pending exact-CCN review/);
  }
});

test('complete Claraprice metadata is promoted only with exact current pointer and site identity', () => {
  const proof = require(path.join(audit, 'claraprice-complete-metadata-2026-09-16.json'));
  const ledger = new Map(require(path.join(audit, 'reviewed-resolutions.json')).map(row => [row.ccn, row]));
  for (const ccn of ['061327', '170103', '271311', '281306', '281313', '281334', '281349', '281350', '451373', '671300', '671303', '450508', '471306']) {
    const record = proof.records.find(row => row.ccn === ccn);
    const review = ledger.get(ccn);
    assert.equal(review?.action, 'replace-observation');
    assert.equal(review?.evidence?.observedFinding, 'mrf-stale-over-365-days');
    assert.equal(review?.evidence?.fileSha256, record.file_sha256);
    assert.equal(review?.evidence?.pointerSha256, record.identity_review.pointer_sha256);
    assert.equal(review?.evidence?.identityPageSha256, record.identity_review.identity_page_sha256);
    assert.equal(review?.evidence?.date, record.last_updated_on);
  }
  const morton = proof.records.find(row => row.ccn === '171386');
  assert.equal(morton.pointer_recheck.response_kind, 'html-incapsula-challenge');
  assert.equal(morton.pointer_recheck.exact_file_link_observed, false);
  assert.equal(ledger.has('171386'), false);
  assert.equal(proof.records.find(row => row.ccn === '280065')?.bytes, 63388619);
});

test('capped complete-file cohort has one auditable disposition per attempted CCN', () => {
  const proof = require(path.join(audit, 'claraprice-complete-metadata-2026-09-16.json'));
  const queue = require(path.join(audit, 'retained-identity-review-queue.json'));
  const nationwide = new Map(require(path.join(audit, 'nationwide-verification.json')).records.map(row => [row.ccn, row]));
  const reviewed = new Set(require(path.join(audit, 'reviewed-resolutions.json')).map(row => row.ccn));
  const queueBy = new Map(queue.records.map(row => [row.ccn, row]));
  const all = [...proof.records, ...proof.incomplete];
  assert.equal(proof.records.length, 38);
  assert.equal(proof.incomplete.length, 0);
  assert.equal(new Set(all.map(row => row.ccn)).size, all.length);
  for (const row of proof.records) {
    assert.equal(new URL(row.url).href, new URL(nationwide.get(row.ccn)?.standing_mrf_url).href);
    assert.equal(row.http_status, 200);
    assert.ok(row.bytes > 0 && row.bytes <= 80_000_000);
    assert.match(row.file_sha256, /^[a-f0-9]{64}$/);
    assert.match(row.last_updated_on, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(row.location_name.length && row.hospital_address.length && row.license_state);
    assert.ok(reviewed.has(row.ccn) || queueBy.get(row.ccn)?.priority === '3b-complete-file-metadata-observed');
  }
  for (const row of proof.incomplete) {
    assert.equal(row.reason, 'stream-exceeded-cap-no-metadata-inference');
    assert.equal(queueBy.get(row.ccn)?.priority, '4-metadata-not-observed-in-sample');
  }
});
