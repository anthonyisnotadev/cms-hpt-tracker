'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { csvToObjects } = require('../lib/util');
const { buildQueues } = require('../build-nationwide-queues');

const root = path.resolve(__dirname, '../../..');
const read = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const digest = relative => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, relative))).digest('hex');

test('San Joaquin General does not inherit Adventist Bakersfield review file', () => {
  const proof = read('data/hpt-audit/reviewed-file-attribution-exclusions.json').records.find(row => row.ccn === '050167');
  const roster = read('cms_data/hpt/roster.json').find(row => row.ccn === proof.ccn);
  const headers = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/hpt/nationwide-verification/mrf-headers.csv'), 'utf8'));
  const rejected = headers.find(row => row.mrf_url === proof.excluded_mrf_url);
  const currentPointer = fs.readFileSync(path.join(root, proof.current_pointer_file), 'utf8');
  const rejectedPointer = fs.readFileSync(path.join(root, proof.excluded_pointer_file), 'utf8');
  assert.equal(digest(proof.current_pointer_file), proof.current_pointer_sha256);
  assert.equal(digest(proof.excluded_pointer_file), proof.excluded_pointer_sha256);
  assert.ok(currentPointer.includes(`location-name: ${proof.current_pointer_location_name}`));
  const currentTarget = (currentPointer.match(/^mrf-url:\s*(.+)$/m) || [,''])[1].trim();
  assert.equal(crypto.createHash('sha256').update(currentTarget).digest('hex'), proof.current_pointer_mrf_url_sha256);
  assert.equal(proof.browser_result, 'ERR_BLOCKED_BY_CLIENT');
  assert.equal(proof.browser_bytes_retained, 0);
  assert.ok(rejectedPointer.includes(proof.excluded_mrf_url));
  assert.equal(roster.name, proof.hospital_name);
  assert.equal(roster.city, proof.roster_city);
  assert.equal(roster.zip, proof.roster_zip);
  assert.equal(rejected.review_ccns, proof.ccn);
  assert.equal(rejected.mrf_address, proof.excluded_header_address);
  assert.equal(rejected.mrf_hospital_name, proof.excluded_header_hospital_name);
  assert.equal(rejected.mrf_license_state, proof.excluded_header_license_state);
  const current = read('data/hpt-audit/nationwide-verification.json').records.find(row => row.ccn === proof.ccn);
  assert.equal(current.prior_finding, 'compliant-observed');
  assert.equal(current.disposition, 'mrf-request-unsuccessful');
  assert.equal(current.mrf_url, currentTarget);
  assert.equal(current.pointer_corpus_sha256, proof.current_pointer_sha256);
  assert.equal(current.reviewed_excluded_mrf_url, proof.excluded_mrf_url);
  assert.equal(current.evidence.review_mrf_candidates, 0);
  assert.equal(current.observation_role, 'superseded-retry');
  const browserRecords = read('data/hpt-audit/nationwide-browser-reviews.json').records;
  const queue = buildQueues(read('data/hpt-audit/nationwide-verification.json'), [], [], browserRecords, [proof])
    .mrf.find(item => item.ccns.includes(proof.ccn));
  assert.equal(queue, undefined);
});
