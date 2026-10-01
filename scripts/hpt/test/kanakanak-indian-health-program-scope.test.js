'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { csvToObjects } = require('../lib/util');

const root = path.resolve(__dirname, '../../..');

test('Kanakanak exact CCN is scope-classified from CMS/IHS evidence without an MRF claim', () => {
  const proof = JSON.parse(fs.readFileSync(path.join(root,
    'data/hpt-audit/reconciliation-kanakanak-indian-health-program-scope-proof-2026-09-28.json'), 'utf8'));
  assert.equal(proof.ccn, '021309');
  assert.match(proof.cms_tribal_hospital_crosswalk.observation, /021309.*Dillingham, Alaska/);
  assert.match(proof.ihs_current_tribal_cah_listing.observation, /Tribal/);
  assert.match(proof.ihs_current_operator_evidence.observation, /Bristol Bay Area Health Corporation/);
  assert.match(proof.ihs_isdeaa_program_evidence.observation, /P\.L\. 93-638, Title V/);
  assert.match(proof.legal_basis.regulation, /180\.30\(b\)\(2\)/);
  assert.equal(proof.disposition, 'scope-exempt-indian-health-program');
  assert.match(proof.interpretation, /does not assert pointer linkage, current MRF availability, absence, or file quality/);

  const compliance = csvToObjects(fs.readFileSync(path.join(root, 'data/hpt-audit/compliance.csv'), 'utf8'))
    .find(row => row.ccn === '021309');
  assert.equal(compliance.finding, 'not-applicable-indian-health-program');
  assert.equal(compliance.pointer_url, '');
  assert.equal(compliance.mrf_url, '');

  const view = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/nationwide-verification.json'), 'utf8'));
  assert.equal(view.records.find(row => row.ccn === '021309').disposition, 'scope-exempt-indian-health-program');

  const manual = JSON.parse(fs.readFileSync(path.join(root,
    'data/hpt-audit/reconciliation-manual-access-observations.json'), 'utf8'));
  assert.ok(manual.records.some(row => row.ccn === '021309' && row.proof_file ===
    'reconciliation-kanakanak-official-portal-retired-proof-2026-09-21.json'));
  assert.ok(manual.records.some(row => row.ccn === '021309' && row.proof_file ===
    'reconciliation-kanakanak-indian-health-program-scope-proof-2026-09-28.json'));
});
