'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { csvToObjects } = require('../lib/util');

const root = path.resolve(__dirname, '../../..');

test('Hopi exact CCN is scope-exempt based on IHS operation while CMS Tribal ownership remains recorded', () => {
  const proofFile = 'reconciliation-hopi-indian-health-program-scope-proof-2026-09-29.json';
  const proof = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit', proofFile), 'utf8'));
  assert.equal(proof.ccn, '031305');
  assert.equal(proof.cms_provider_record.record.facility_name, 'HOPI HEALTH CARE CENTER');
  assert.equal(proof.cms_provider_record.record.hospital_ownership, 'Tribal');
  assert.match(proof.cms_ihs_service_locator.observation, /IHS affiliation/);
  assert.match(proof.ihs_federally_operated_facility_dashboard.observation, /Hopi.*Critical Access Hospital/);
  assert.match(proof.legal_basis.regulation, /180\.30\(b\)\(2\)/);
  assert.match(proof.legal_basis.statute_observation, /administered directly by the Indian Health Service/);
  assert.equal(proof.disposition, 'scope-exempt-indian-health-program');
  assert.match(proof.interpretation, /CMS's separate Tribal ownership value is preserved/);
  assert.match(proof.interpretation, /does not establish pointer linkage, current MRF availability, absence, or file quality/);

  const compliance = csvToObjects(fs.readFileSync(path.join(root, 'data/hpt-audit/compliance.csv'), 'utf8'))
    .find(row => row.ccn === '031305');
  assert.ok(compliance);
  assert.equal(compliance.finding, 'not-applicable-indian-health-program');
  assert.equal(compliance.domain, 'ihs.gov');
  assert.equal(compliance.pointer_url, '');
  assert.equal(compliance.mrf_url, '');
  assert.match(compliance.evidence, /Tribal ownership is retained separately/);

  const manual = JSON.parse(fs.readFileSync(path.join(root,
    'data/hpt-audit/reconciliation-manual-access-observations.json'), 'utf8'));
  assert.ok(manual.records.some(row => row.ccn === '031305'
    && row.proof_file === 'reconciliation-hopi-ihs-pointer-discovery-recheck-proof-2026-09-21.json'),
  'retain the earlier pointer-discovery observation as history');
  assert.ok(manual.records.some(row => row.ccn === '031305' && row.proof_file === proofFile
    && row.disposition === 'scope-exempt-indian-health-program'));

  const browser = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/nationwide-browser-reviews.json'), 'utf8'));
  assert.ok(browser.records.some(row => row.ccn === '031305' && row.proof_file === proofFile));

  const view = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/nationwide-verification.json'), 'utf8'));
  const record = view.records.find(row => row.ccn === '031305');
  assert.ok(record);
  assert.equal(record.disposition, 'scope-exempt-indian-health-program');
  assert.equal(record.mrf_url, '');

  const roster = JSON.parse(fs.readFileSync(path.join(root,
    'data/hpt-audit/reconciliation-891-baseline-member-roster-2026-09-27.json'), 'utf8'));
  assert.ok(roster.current_crosswalk_ccns['scope-exempt'].includes('031305'));
});
