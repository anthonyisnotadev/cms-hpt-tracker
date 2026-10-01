'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const read = name => JSON.parse(fs.readFileSync(path.join(audit, name), 'utf8'));
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

test('Buchanan General current first-party pointer and CMS v3 file supersede the malformed prior target', () => {
  const proof = read('reconciliation-buchanan-general-current-pointer-proof-2026-09-30.json');
  const verification = read('nationwide-verification.json');
  const effective = read('nationwide-effective-audit.json');
  const worklist = read('unresolved-investigation-worklist.json');
  const resolutions = read('reviewed-resolutions.json');

  const pointerBytes = fs.readFileSync(path.resolve(root, proof.sources.pointer.raw_artifact));
  const mrfBytes = fs.readFileSync(path.resolve(root, proof.sources.current_mrf.raw_artifact));
  assert.equal(sha256(pointerBytes), proof.sources.pointer.sha256);
  assert.equal(sha256(mrfBytes), proof.sources.current_mrf.sha256);
  assert.equal(mrfBytes.length, proof.sources.current_mrf.bytes);
  assert.equal(proof.sources.pointer.http_status, 200);
  assert.doesNotMatch(proof.sources.pointer.text, /contact-(?:name|email):/i);
  assert.equal(proof.sources.prior_target.observed_http_status, 404);
  assert.match(proof.sources.pointer.text, /540895648_buchanan-general-hospital-_standardcharges\.csv/);
  assert.equal(proof.sources.current_mrf.version, '3.0.0');
  assert.equal(proof.sources.current_mrf.last_updated_on, '9/2/2026');
  assert.equal(proof.structure.cms_validator.result, 'valid');
  assert.equal(proof.structure.cms_validator.dictionary_version, '3.0.0');
  assert.equal(proof.structure.cms_validator.errors, 0);
  assert.equal(proof.structure.cms_validator.alerts, 0);
  assert.equal(proof.structure.data_rows, 6435);
  assert.equal(proof.structure.row_widths.join(','), '59');
  assert.equal(proof.identity_review.file_name_agrees, true);
  assert.equal(proof.identity_review.file_address_agrees, true);
  assert.equal(proof.identity_review.file_state_agrees, true);

  const row = verification.records.find(record => record.ccn === '490127');
  assert.ok(row);
  assert.equal(row.disposition, 'verified-current-mrf');
  assert.equal(row.mrf_url, proof.sources.current_mrf.url);
  assert.equal(row.cms_template_version, '3.0.0');
  assert.equal(row.declared_last_updated, '2026-09-02');
  assert.ok(!worklist.records.some(record => record.ccn === '490127'));
  assert.equal(worklist.summary.total, 581);

  const resolution = resolutions.find(record => record.ccn === '490127');
  assert.equal(resolution.action, 'replace');
  assert.equal(resolution.finding, 'verified-current-mrf');
  assert.equal(resolution.base.mrf_url, proof.sources.prior_target.url);
  const effectiveRecord = effective.records.find(record => record.ccn === '490127');
  assert.equal(effectiveRecord.reconciliation.workstream, 'consistent');
  assert.equal(effectiveRecord.effective_reviewed_observation.latest_observation_superseded, true);
});
