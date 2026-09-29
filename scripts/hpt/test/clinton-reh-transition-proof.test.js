'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const proof = require(path.join(root, 'data/hpt-audit/reconciliation-clinton-reh-transition-proof.json'));
const observations = require(path.join(root, 'data/hpt-audit/reconciliation-manual-access-observations.json')).records;
const worklist = require(path.join(root, 'data/hpt-audit/same-campus-ccn-transition-worklist.json')).groups;
const resolutions = require(path.join(root, 'data/hpt-audit/reviewed-resolutions.json'));
const reconciliation = require(path.join(root, 'data/hpt-audit/nationwide-reconciliation.json')).records;

test('Clinton REH conversion is exact-CCN and full-file-NPI bound', () => {
  assert.deepEqual(proof.ccns, ['370245', '370784']);
  assert.equal(proof.cms_current_enrollment.ccn, '370784');
  assert.equal(proof.cms_current_enrollment.former_hospital_ccn, '370245');
  assert.equal(proof.cms_current_enrollment.reh_conversion_date, '2025-12-02');
  assert.equal(proof.cms_former_enrollment_rows_in_current_snapshot, 0);
  assert.deepEqual(proof.file_type_2_npi, [proof.cms_current_enrollment.npi]);
  assert.equal(proof.file_license_state, 'OK');
  assert.equal(proof.file_last_updated_on, '2026-07-28');
  assert.equal(proof.file_version, '3.0.0');
  assert.equal(proof.file_bytes, 3871397);
  assert.match(proof.file_sha256, /^[a-f0-9]{64}$/);
  const former = observations.find(row => row.ccn === '370245');
  const current = observations.find(row => row.ccn === '370784');
  assert.equal(former.proof_file, 'reconciliation-clinton-reh-transition-proof.json');
  assert.equal(current.proof_file, former.proof_file);
  assert.match(former.next_action, /do not assign the current REH file to 370245/i);
  assert.match(current.next_action, /not line-item or legal compliance validation/i);
  const group = worklist.find(row => row.ccns.join(',') === '370245,370784');
  assert.ok(group);
  assert.equal(group.disposition, 'same-campus-cms-confirmed-reh-transition-scope-reviewed');
  assert.match(group.records.find(row => row.ccn === '370245').existing_next_action, /historical acute-care/i);
  assert.match(group.records.find(row => row.ccn === '370784').existing_next_action, /promoted for CCN 370784/i);
  assert.match(group.next_action, /promoted only for 370784/);
  const resolution = resolutions.find(row => row.ccn === '370784');
  assert.equal(resolution.action, 'replace');
  assert.equal(resolution.evidence.fileSha256, proof.file_sha256);
  assert.equal(resolution.evidence.cmsNpi, proof.cms_current_enrollment.npi);
  assert.equal(resolutions.some(row => row.ccn === '370245'), false);
  assert.equal(reconciliation.find(row => row.ccn === '370784').standing_finding, 'compliant-observed');
  assert.equal(reconciliation.find(row => row.ccn === '370245').workstream, 'genuinely-unresolved-investigation');
});
