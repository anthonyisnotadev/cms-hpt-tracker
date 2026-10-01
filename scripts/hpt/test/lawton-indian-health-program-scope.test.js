'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { csvToObjects } = require('../lib/util');

const root = path.resolve(__dirname, '../../..');

test('Lawton exact CCN is supported as IHS-operated program scope while CMS Tribal ownership remains recorded', () => {
  const proof = JSON.parse(fs.readFileSync(path.join(root,
    'data/hpt-audit/reconciliation-lawton-indian-health-program-scope-proof-2026-09-28.json'), 'utf8'));
  assert.equal(proof.ccn, '370170');
  assert.equal(proof.cms_provider_record.observation.includes('hospital_ownership as Tribal'), true);
  assert.match(proof.cms_service_locator.observation, /affiliation IHS/);
  assert.match(proof.current_ihs_operator_evidence.federally_operated_facilities_observation, /Lawton.*Hospital/);
  assert.match(proof.legal_basis.regulation, /180\.30\(b\)\(2\)/);
  assert.match(proof.legal_basis.statute_observation, /administered directly by the Indian Health Service/);
  assert.equal(proof.disposition, 'scope-exempt-indian-health-program');
  assert.match(proof.interpretation, /ownership value is retained/);
  assert.match(proof.interpretation, /no pointer-linkage, current MRF availability/);

  const compliance = csvToObjects(fs.readFileSync(path.join(root, 'data/hpt-audit/compliance.csv'), 'utf8'))
    .find(row => row.ccn === '370170');
  assert.ok(compliance);
  assert.equal(compliance.finding, 'not-applicable-indian-health-program');
  assert.equal(compliance.domain, 'ihs.gov');
  assert.equal(compliance.pointer_url, '');
  assert.equal(compliance.mrf_url, '');
  assert.match(compliance.evidence, /Tribal ownership value retained separately/);

  const manual = JSON.parse(fs.readFileSync(path.join(root,
    'data/hpt-audit/reconciliation-manual-access-observations.json'), 'utf8'));
  const prior = manual.records.find(row => row.ccn === '370170'
    && row.proof_file === 'reconciliation-lawton-ownership-conflict-proof-2026-09-23.json');
  const current = manual.records.find(row => row.ccn === '370170'
    && row.proof_file === 'reconciliation-lawton-indian-health-program-scope-proof-2026-09-28.json');
  assert.ok(prior, 'retain the earlier CMS ownership conflict as history');
  assert.ok(current);
  assert.equal(current.disposition, 'scope-exempt-indian-health-program');

  const browser = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/nationwide-browser-reviews.json'), 'utf8'));
  assert.ok(browser.records.some(row => row.ccn === '370170'
    && row.proof_file === 'reconciliation-lawton-indian-health-program-scope-proof-2026-09-28.json'));

  const view = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/nationwide-verification.json'), 'utf8'));
  const record = view.records.find(row => row.ccn === '370170');
  assert.ok(record);
  assert.equal(record.disposition, 'scope-exempt-indian-health-program');
  assert.equal(record.mrf_url, '');

  const roster = JSON.parse(fs.readFileSync(path.join(root,
    'data/hpt-audit/reconciliation-891-baseline-member-roster-2026-09-27.json'), 'utf8'));
  assert.ok(roster.current_crosswalk_ccns['scope-exempt'].includes('370170'));
});
