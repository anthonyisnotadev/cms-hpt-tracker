'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const audit = path.resolve(__dirname, '../../../data/hpt-audit');

test('Strawhun page file retains pointer 404 and Indiana license-state conflict', () => {
  const ledger = JSON.parse(fs.readFileSync(path.join(audit, 'reviewed-resolutions.json'), 'utf8'));
  const resolution = ledger.find(row => row.ccn === '154020');
  assert.ok(resolution);
  const e = resolution.evidence;
  assert.equal(resolution.action, 'replace-observation');
  assert.equal(e.observedFinding, 'pointer-links-unavailable-mrf-source-page-current-file');
  assert.equal(e.pointerMrfHttpStatus, 404);
  assert.notEqual(e.pointerMrfUrl, e.url);
  assert.equal(e.declared_hospital_name, 'Regional Mental Health Center');
  assert.equal(e.location_name, 'Strawhun');
  assert.match(e.declared_address, /8555 Taft Street Merrillville, In 46410/);
  assert.equal(e.facility_state, 'IN');
  assert.equal(e.declared_license_state, 'CA');
  assert.equal(e.date, '2026-01-26');
  assert.equal(e.version, '3.0.0');
  const standing = loadReviewedView(audit).compliance.find(row => row.ccn === '154020');
  assert.equal(standing.finding, e.observedFinding);
  assert.equal(standing.mrf_url, e.url);
  assert.notEqual(standing.mrf_url, e.pointerMrfUrl);
});
