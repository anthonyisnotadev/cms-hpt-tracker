'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { csvToObjects } = require('../lib/util');

const root = path.resolve(__dirname, '../../..');

test('Cherokee Indian Hospital exact facility is supported as Indian Health Program scope, separately from its custom workbook', () => {
  const proof = JSON.parse(fs.readFileSync(path.join(root,
    'data/hpt-audit/reconciliation-cherokee-indian-health-program-scope-proof-2026-09-28.json'), 'utf8'));
  assert.equal(proof.ccn, '340156');
  assert.match(proof.cms_tribal_hospital_crosswalk.observation, /CCN 340156/);
  assert.match(proof.cms_service_locator.observation, /Title 5 \(638\)/);
  assert.match(proof.current_operator_evidence.funding_observation, /funding from IHS/);
  assert.match(proof.legal_basis.regulation, /180\.30\(b\)\(2\)/);
  assert.match(proof.legal_basis.statute_observation, /tribal health program/);
  assert.equal(proof.disposition, 'scope-exempt-indian-health-program');
  assert.match(proof.interpretation, /not an MRF finding/);

  const compliance = csvToObjects(fs.readFileSync(path.join(root, 'data/hpt-audit/compliance.csv'), 'utf8'))
    .find(row => row.ccn === '340156');
  assert.ok(compliance);
  assert.equal(compliance.finding, 'not-applicable-indian-health-program');
  assert.equal(compliance.pointer_url, '');
  assert.equal(compliance.mrf_url, '');
  assert.match(compliance.evidence, /45 CFR 180\.30\(b\)\(2\)/);

  const manual = JSON.parse(fs.readFileSync(path.join(root,
    'data/hpt-audit/reconciliation-manual-access-observations.json'), 'utf8'));
  const prior = manual.records.find(row => row.ccn === '340156'
    && row.proof_file === 'reconciliation-cherokee-indian-hospital-chargemaster-proof-2026-09-21.json');
  const current = manual.records.find(row => row.ccn === '340156'
    && row.proof_file === 'reconciliation-cherokee-indian-health-program-scope-proof-2026-09-28.json');
  assert.ok(prior, 'retain prior page-linked custom-workbook evidence');
  assert.ok(current);
  assert.equal(current.disposition, 'scope-exempt-indian-health-program');

  const view = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/nationwide-verification.json'), 'utf8'));
  const record = view.records.find(row => row.ccn === '340156');
  assert.ok(record);
  assert.equal(record.disposition, 'scope-exempt-indian-health-program');
  assert.equal(record.mrf_url, '');

  const roster = JSON.parse(fs.readFileSync(path.join(root,
    'data/hpt-audit/reconciliation-891-baseline-member-roster-2026-09-27.json'), 'utf8'));
  assert.ok(roster.current_crosswalk_ccns['scope-exempt'].includes('340156'));
});
