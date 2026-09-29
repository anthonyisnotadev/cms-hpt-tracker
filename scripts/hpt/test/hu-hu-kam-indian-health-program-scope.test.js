'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { csvToObjects } = require('../lib/util');

const root = path.resolve(__dirname, '../../..');

test('Hu Hu Kam exact facility is supported as an Indian Health Program scope case without an MRF claim', () => {
  const proof = JSON.parse(fs.readFileSync(path.join(root,
    'data/hpt-audit/reconciliation-hu-hu-kam-indian-health-program-scope-proof-2026-09-28.json'), 'utf8'));
  assert.equal(proof.ccn, '031308');
  assert.equal(proof.cms_provider_record.record.facility_id, '031308');
  assert.equal(proof.cms_provider_record.record.address, '483 WEST SEED FARM ROAD');
  assert.equal(proof.cms_indian_health_service_locator.http_status, 200);
  assert.match(proof.cms_indian_health_service_locator.facility_entry_observation, /Title 5 \(638\)/);
  assert.match(proof.current_operator_evidence.operator_638_observation, /federally recognized 638/);
  assert.match(proof.legal_basis.regulation, /180\.30\(b\)\(2\)/);
  assert.match(proof.legal_basis.statute_observation, /tribal health program/);
  assert.equal(proof.disposition, 'scope-exempt-indian-health-program');
  assert.match(proof.interpretation, /Government - Federal ownership field is retained/);

  const compliance = csvToObjects(fs.readFileSync(path.join(root, 'data/hpt-audit/compliance.csv'), 'utf8'))
    .find(row => row.ccn === '031308');
  assert.ok(compliance);
  assert.equal(compliance.finding, 'not-applicable-indian-health-program');
  assert.equal(compliance.pointer_url, '');
  assert.equal(compliance.mrf_url, '');
  assert.match(compliance.evidence, /45 CFR 180\.30\(b\)\(2\)/);

  const manual = JSON.parse(fs.readFileSync(path.join(root,
    'data/hpt-audit/reconciliation-manual-access-observations.json'), 'utf8'));
  const prior = manual.records.find(row => row.ccn === '031308'
    && row.proof_file === 'reconciliation-huhu-kam-current-pricing-page-proof.json');
  const current = manual.records.find(row => row.ccn === '031308'
    && row.proof_file === 'reconciliation-hu-hu-kam-indian-health-program-scope-proof-2026-09-28.json');
  assert.ok(prior, 'retain the prior pointer and historical pricing-PDF observation');
  assert.ok(current);
  assert.equal(current.disposition, 'scope-exempt-indian-health-program');

  const view = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/nationwide-verification.json'), 'utf8'));
  const record = view.records.find(row => row.ccn === '031308');
  assert.ok(record);
  assert.equal(record.disposition, 'scope-exempt-indian-health-program');
  assert.equal(record.mrf_url, '');
});
