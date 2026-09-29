'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parsePointer } = require('../lib/parse');
const { parsePayload } = require('../lib/recovery-transport');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

test('Riverview proof binds official campus, exact pointer and bounded September file', async () => {
  const proof = require(path.join(audit, 'reconciliation-riverview-regional-pointer-file-proof.json'));
  const resolution = require(path.join(audit, 'reviewed-resolutions.json')).find(row => row.ccn === proof.ccn);
  const pointer = fs.readFileSync(path.join(root, proof.pointer_retained_file));
  const page = fs.readFileSync(path.join(root, proof.identity_page_retained_file));
  const sample = fs.readFileSync(path.join(root, proof.retained_sample));
  assert.equal(sha(pointer), proof.pointer_sha256);
  assert.equal(sha(page), proof.identity_page_sha256);
  assert.equal(sha(sample), proof.sample_sha256);
  assert.equal(sample.length, 1048576);
  assert.ok(parsePointer(pointer.toString('utf8')).entries.some(item =>
    item.locationName === proof.pointer_location_name && item.mrfUrls?.includes(proof.file_url)));
  assert.match(page.toString('utf8'), /600 South 3rd Street<br\s*\/>Gadsden, AL 35901/i);
  const parsed = (await parsePayload(sample, 'application/json')).parsed.find(item => item.innerKind === 'json');
  assert.equal(parsed.mrfAddress, proof.declared_address);
  assert.equal(parsed.mrfLicenseState, 'AL');
  assert.equal(parsed.cmsVersion, '3.0');
  assert.equal(resolution.evidence.url, proof.file_url);
  const view = loadReviewedView(audit);
  const row = view.compliance.find(item => item.ccn === proof.ccn);
  assert.equal(row.finding, 'mrf-template-version-noncanonical');
  assert.equal(row.mrf_url, proof.file_url);
  assert.equal(view.history[proof.ccn].mrf_url, proof.displaced_file_url);
});
