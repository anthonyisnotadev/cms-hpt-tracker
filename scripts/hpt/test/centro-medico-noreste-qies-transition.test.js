'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const read = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const proof = read('data/hpt-audit/reconciliation-centro-medico-noreste-qies-transition-proof-2026-09-29.json');
const pricingScopeProof = read('data/hpt-audit/reconciliation-centro-medico-del-noreste-publisher-pricing-page-scope-2026-09-29.json');
const manualData = read('data/hpt-audit/reconciliation-manual-access-observations.json');
const manualRows = Array.isArray(manualData) ? manualData : Object.values(manualData).flat();
const manual = manualRows.find(row => row.ccn === '400141'
  && row.proof_file === 'reconciliation-centro-medico-noreste-qies-transition-proof-2026-09-29.json');

test('CMS QIES responses are retained and bind the distinct 400140/400141 status records', () => {
  assert.equal(proof.source.release, 'Q1 2026');
  assert.equal(proof.records.length, 2);
  for (const record of proof.records) {
    const bytes = fs.readFileSync(path.join(audit, record.response_file));
    assert.equal(bytes.length, record.response_bytes);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), record.response_sha256);
    const rows = JSON.parse(bytes.toString('utf8'));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].PRVDR_NUM, record.ccn);
    assert.equal(rows[0].FAC_NAME, record.provider_name);
    assert.equal(rows[0].ST_ADR, record.address);
  }
  const predecessor = proof.records.find(row => row.ccn === '400140');
  const current = proof.records.find(row => row.ccn === '400141');
  assert.equal(predecessor.termination_date, '20250313');
  assert.equal(current.termination_date, '');
  assert.equal(current.certification_date, '20250717');
  assert.equal(predecessor.cross_reference_provider_number, '');
  assert.equal(current.cross_reference_provider_number, '');
  assert.equal(proof.count_effect, 'none; CCN 400141 remains unresolved in the frozen 891-member cohort');
});

test('current CCN evidence sharpens the next action without assigning the sibling MRF', () => {
  assert.ok(manual);
  assert.equal(manual.disposition, 'current-ccn-400141-confirmed-mrf-unresolved');
  assert.match(manual.next_action, /400141 as the later-certified CCN/);
  assert.match(manual.next_action, /Do not repeat the generic root pointer or confirmed sibling CSV/);
  assert.match(manual.next_action, /Centro Médico del Noreste-specific CMS CSV\/JSON MRF or pointer/);
  assert.equal(manual.predecessor_ccn, '400140');
});

test('first-party pricing-page cross-link preserves the sibling-file exclusion for CCN 400141', () => {
  assert.equal(pricingScopeProof.ccn, '400141');
  assert.equal(pricingScopeProof.observations.facility_page_pricing_link.includes('shared Price Transparency page'), true);
  assert.deepEqual(pricingScopeProof.observations.listed_files, [
    '660559417_Caribbean-Medical-Center_Standard-and-Negotiated.csv',
    '660559417_Caribbean-Medical-Center_Shoppable.csv',
  ]);
  assert.equal(pricingScopeProof.disposition_effect, 'none');
  assert.equal(pricingScopeProof.count_effect, 0);
  assert.match(pricingScopeProof.interpretation, /Do not assign|Do not map|does not map/i);
  assert.match(manual.next_action, /do not assign those files to 400141/);
});
