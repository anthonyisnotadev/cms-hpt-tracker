'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { csvToObjects } = require('../lib/util');

const root = path.resolve(__dirname, '../../..');

test('Claremore scope correction is exact-CCN and compact-backed, without an MRF claim', () => {
  const proof = JSON.parse(fs.readFileSync(path.join(root,
    'data/hpt-audit/reconciliation-claremore-indian-health-program-scope-proof-2026-09-27.json'), 'utf8'));
  assert.equal(proof.ccn, '370173');
  assert.equal(proof.cms_record.facility_name, 'CLAREMORE INDIAN HOSPITAL');
  assert.equal(proof.cms_record.hospital_ownership, 'Government - Federal');
  assert.equal(proof.disposition, 'scope-exempt-indian-health-program');
  assert.match(proof.ihs_transfer_observation, /effective October 1, 2025/);
  assert.match(proof.cherokee_report_observation, /self-governance compact/);
  assert.match(proof.regulatory_observation, /180\.30\(b\)\(2\)/);
  assert.equal(Object.hasOwn(proof, 'mrf_url'), false);
  assert.equal(Object.hasOwn(proof, 'pointer_url'), false);

  const compliance = csvToObjects(fs.readFileSync(path.join(root, 'data/hpt-audit/compliance.csv'), 'utf8'))
    .find(row => row.ccn === '370173');
  assert.ok(compliance);
  assert.equal(compliance.finding, 'not-applicable-indian-health-program');
  assert.match(compliance.evidence, /Government - Federal/);
  assert.match(compliance.evidence, /self-governance compact/);
  assert.equal(compliance.pointer_url, '');
  assert.equal(compliance.mrf_url, '');

  const manual = JSON.parse(fs.readFileSync(path.join(root,
    'data/hpt-audit/reconciliation-manual-access-observations.json'), 'utf8'));
  const observations = manual.records.filter(row => row.ccn === '370173');
  assert.equal(observations.length, 2, 'retain prior ownership-transition observation and add the reviewed scope observation');
  const current = observations.find(row => row.proof_file === 'reconciliation-claremore-indian-health-program-scope-proof-2026-09-27.json');
  assert.ok(current);
  assert.equal(current.disposition, 'scope-exempt-indian-health-program');
  assert.match(current.interpretation, /does not assert pointer linkage, MRF availability, file quality, closure, or termination/);

  const view = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/nationwide-verification.json'), 'utf8'));
  const record = view.records.find(row => row.ccn === '370173');
  assert.ok(record);
  assert.equal(record.disposition, 'scope-exempt-indian-health-program');
  assert.equal(record.mrf_url, '');
});
