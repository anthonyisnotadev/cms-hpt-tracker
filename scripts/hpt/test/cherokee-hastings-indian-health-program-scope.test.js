'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { csvToObjects } = require('../lib/util');

const root = path.resolve(__dirname, '../../..');

test('W.W. Hastings exact CCN is scope-classified while MRF and campus evidence remain separate', () => {
  const proof = JSON.parse(fs.readFileSync(path.join(root,
    'data/hpt-audit/reconciliation-cherokee-hastings-indian-health-program-scope-proof-2026-09-28.json'), 'utf8'));
  assert.equal(proof.ccn, '370171');
  assert.equal(proof.cms_provider_record.record.facility_id, '370171');
  assert.equal(proof.cms_provider_record.http_status, 200);
  assert.match(proof.cms_tribal_hospital_crosswalk.observation, /370171.*Tahlequah, Oklahoma/);
  assert.match(proof.cherokee_nation_hospital_operator.observation, /assumed hospital operations and management/);
  assert.match(proof.indian_health_service_self_governance_evidence.current_funding_record_observation, /Compacts\/Funding Agreements/);
  assert.match(proof.legal_basis.regulation, /180\.30\(b\)\(2\)/);
  assert.equal(proof.disposition, 'scope-exempt-indian-health-program');
  assert.match(proof.interpretation, /does not assert current CCN continuity, pointer linkage, current MRF availability, absence, or file quality/);

  const compliance = csvToObjects(fs.readFileSync(path.join(root, 'data/hpt-audit/compliance.csv'), 'utf8'))
    .find(row => row.ccn === '370171');
  assert.equal(compliance.finding, 'not-applicable-indian-health-program');
  assert.equal(compliance.pointer_url, '');
  assert.equal(compliance.mrf_url, '');

  const view = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/nationwide-verification.json'), 'utf8'));
  assert.equal(view.records.find(row => row.ccn === '370171').disposition, 'scope-exempt-indian-health-program');
  const worklist = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/unresolved-investigation-worklist.json'), 'utf8'));
  assert.ok(!worklist.records.some(row => row.ccn === '370171'));

  const manual = JSON.parse(fs.readFileSync(path.join(root,
    'data/hpt-audit/reconciliation-manual-access-observations.json'), 'utf8'));
  const record = manual.records.find(row => row.ccn === '370171');
  assert.ok(record.latest_campus_transition_confirmation_2026_09_27,
    'retain the older/new replacement-campus transition observation');
  assert.equal(record.latest_indian_health_program_scope_2026_09_28.disposition,
    'scope-exempt-indian-health-program');
  assert.equal(record.latest_indian_health_program_scope_2026_09_28.mrf_recovered, false);
});
