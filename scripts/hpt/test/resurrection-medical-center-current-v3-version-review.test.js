'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const read = name => JSON.parse(fs.readFileSync(path.join(audit, name), 'utf8'));

test('Resurrection current pointer and full file are verified as CMS v3 while its validator version alert remains visible', () => {
  const proof = read('reconciliation-resurrection-medical-center-current-pointer-file-proof-2026-09-30.json');
  const file = fs.readFileSync(path.join(root, proof.current_mrf.raw_artifact));
  const pointer = read('reconciliation-manual-access-observations.json').records.find(row => row.ccn === '140117');
  const verification = read('nationwide-verification.json').records.find(row => row.ccn === '140117');
  const reconciliation = read('nationwide-reconciliation.json').records.find(row => row.ccn === '140117');
  const worklist = read('unresolved-investigation-worklist.json');
  const queued = worklist.records.find(row => row.ccn === '140117');
  const effective = require('../lib/reviewed-resolutions').loadReviewedView(audit)
    .compliance.find(row => row.ccn === '140117');
  const resolution = read('reviewed-resolutions.json').find(row => row.ccn === '140117');

  assert.equal(file.length, proof.current_mrf.bytes);
  assert.equal(crypto.createHash('sha256').update(file).digest('hex'), proof.current_mrf.sha256);
  assert.equal(proof.current_mrf.declared_version, '3.0');
  assert.equal(proof.current_mrf.cms_validator.result, 'no errors, 1 alert');
  assert.match(proof.current_mrf.cms_validator.alert, /"3\.0".*"3\.0\.0"/);
  assert.equal(pointer.pointer_sha256, proof.current_pointer.sha256);
  assert.equal(pointer.facility_file_url, proof.current_mrf.url);
  assert.equal(verification.mrf_url, proof.current_mrf.url);
  assert.equal(verification.disposition, 'verified-current-mrf');
  assert.equal(verification.latest_observation_superseded, false);
  assert.equal(verification.cms_template_version, '3.0');
  assert.equal(verification.mrf_state, 'verified-current-v3');
  assert.equal(verification.cms_validator.version, '1.10.8');
  assert.equal(verification.cms_validator.alert_count, 1);
  assert.equal(reconciliation.workstream, 'consistent');
  assert.deepEqual(reconciliation.issues, []);
  assert.equal(queued, undefined);
  assert.equal(effective.finding, 'compliant-observed');
  assert.equal(effective.mrf_url, proof.current_mrf.url);
  assert.equal(effective.mrf_last_updated, proof.current_mrf.declared_last_updated);
  assert.equal(effective.cms_template_version, '3.0');
  assert.match(effective.evidence, /CMS validator alert retained:.*version data element/);
  assert.match(resolution.evidence.cmsValidator.alert, /"3\.0".*"3\.0\.0"/);
  assert.match(effective.evidence, /CMS validator alert retained:.*version data element/);
  assert.equal(worklist.summary.total, 581);
});
