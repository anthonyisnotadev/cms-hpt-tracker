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

test('St Joseph KC uses its exact Missouri pointer and file, not Washington sibling evidence', async () => {
  const proof = require(path.join(audit, 'reconciliation-st-joseph-kc-pointer-file-proof.json'));
  const resolution = require(path.join(audit, 'reviewed-resolutions.json')).find(row => row.ccn === proof.ccn);
  const pointerBytes = fs.readFileSync(path.join(root, proof.pointer_raw_file));
  const sample = fs.readFileSync(path.join(root, proof.retained_sample));
  assert.equal(sha(pointerBytes), proof.pointer_sha256);
  assert.equal(sha(sample), proof.sample_sha256);
  assert.equal(sample.length, 1048576);
  assert.ok(parsePointer(pointerBytes.toString('utf8')).entries.some(item =>
    item.locationName === proof.pointer_location_name && item.mrfUrls?.includes(proof.file_url)));
  const parsed = (await parsePayload(sample, 'application/json')).parsed.find(item => item.innerKind === 'json');
  assert.equal(parsed.mrfAddress, proof.declared_address);
  assert.equal(parsed.mrfLicenseState, 'MO');
  assert.equal(parsed.cmsVersion, '3.0');
  assert.equal(proof.displaced_file_declared_state, 'WA');
  assert.equal(resolution.evidence.url, proof.file_url);
  const view = loadReviewedView(audit);
  const row = view.compliance.find(item => item.ccn === proof.ccn);
  assert.equal(row.finding, 'compliant-observed');
  assert.equal(row.mrf_url, proof.file_url);
  assert.equal(view.history[proof.ccn].mrf_url, proof.displaced_file_url);
});
