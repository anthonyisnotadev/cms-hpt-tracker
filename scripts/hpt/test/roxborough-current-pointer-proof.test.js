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

test('Roxborough correction binds the exact first-party pointer and file metadata', async () => {
  const proof = require(path.join(audit, 'reconciliation-roxborough-current-pointer-proof.json'));
  const resolution = require(path.join(audit, 'reviewed-resolutions.json'))
    .find(row => row.ccn === proof.ccn);
  const state = require(path.join(root, 'cms_data/hpt/pointer-corpus/crawl-state.json'));
  const pointer = state.targets[`url:${proof.pointer_url}`];
  const pointerBytes = fs.readFileSync(path.join(root, pointer.rawFile));
  const sample = fs.readFileSync(path.join(root, proof.retained_sample));
  assert.equal(sha(pointerBytes), proof.pointer_sha256);
  assert.equal(sha(sample), proof.sample_sha256);
  assert.equal(sample.length, 1048576);
  const entry = parsePointer(pointerBytes.toString('utf8')).entries
    .find(item => item.locationName === 'Roxborough Memorial Hospital');
  assert.ok(entry.mrfUrls.includes(proof.file_url));
  const parsed = (await parsePayload(sample, 'application/json')).parsed[0];
  assert.equal(parsed.mrfHospitalName, 'Roxborough Memorial Hospital');
  assert.match(parsed.mrfAddress, /5800 Ridge Avenue Philadelphia, PA  19128/);
  assert.equal(parsed.mrfLicenseState, 'PA');
  assert.equal(parsed.declaredLastUpdated, '2026-09-01');
  assert.equal(parsed.cmsVersion, '3.0');
  assert.equal(resolution.evidence.url, proof.file_url);
  assert.equal(resolution.evidence.observedFinding, 'mrf-template-version-noncanonical');
  const view = loadReviewedView(audit);
  const row = view.compliance.find(item => item.ccn === proof.ccn);
  assert.equal(row.finding, 'mrf-template-version-noncanonical');
  assert.equal(row.mrf_url, proof.file_url);
  assert.equal(view.history[proof.ccn].finding, 'compliant-observed');
});
