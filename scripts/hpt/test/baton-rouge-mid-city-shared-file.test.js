'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const audit = path.resolve(__dirname, '../../../data/hpt-audit');

test('The General uses the Mid City pointer entry and named campus within shared ZIP', () => {
  const ledger = JSON.parse(fs.readFileSync(path.join(audit, 'reviewed-resolutions.json'), 'utf8'));
  const resolution = ledger.find(row => row.ccn === '190316');
  assert.ok(resolution);
  const e = resolution.evidence;
  assert.equal(e.location_name, 'Baton Rouge General - Mid City');
  assert.match(e.declared_location_name, /THE GENERAL\s+\(ACU2\)/);
  assert.match(e.declared_address, /3600 FLORIDA BLVD, BATON ROUGE, LA/);
  assert.equal(e.declared_license_state, 'LA');
  assert.equal(e.file_kind, 'zip');
  assert.equal(e.zip_member, '721025017_baton-rouge-general-medical-center_standardcharges.csv');
  assert.equal(e.date, '2026-03-26');
  assert.equal(e.version, '3.0.0');
  const standing = loadReviewedView(audit).compliance.find(row => row.ccn === '190316');
  assert.equal(standing.finding, 'compliant-observed');
  assert.equal(standing.pointer_url, e.pointerUrl);
  assert.equal(standing.mrf_url, e.url);
});
