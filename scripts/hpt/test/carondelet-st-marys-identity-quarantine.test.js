'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const audit = path.resolve(__dirname, '../../../data/hpt-audit');

test('Tucson St. Marys keeps its current Carondelet file separate from the historical Waterbury assignment', () => {
  const { compliance, history } = loadReviewedView(audit);
  const row = compliance.find(item => item.ccn === '030010');
  assert.equal(row.finding, 'compliant-observed');
  assert.equal(row.domain, 'carondelet.org');
  assert.match(row.mrf_url, /mrfs\.hyvehealthcare\.com\/TenetHealth\/474131755-1265818488_smsj-tucson-holdings-llc_standardcharges\.json$/);
  assert.equal(row.pointer_url, 'https://www.carondelet.org/patients/pricing-info-estimates/hospital-pricing-information');
  assert.equal(row.mrf_last_updated, '2026-04-06');
  assert.match(history['030010'].mrf_url, /trinity-health\.org/);
  const proof = require(path.join(audit, 'reviewed-resolutions.json'))
    .find(item => item.ccn === '030010');
  assert.equal(proof.evidence.declared_license_state, 'AZ');
  assert.match(proof.evidence.declared_address, /1601 W St Marys Rd/);
  assert.equal(proof.evidence.pointerHttpStatus, 403);
  assert.match(proof.evidence.pointerMrfUrl, /mrfs\.hyvehealthcare\.com/);
  assert.notEqual(proof.base.mrf_url, proof.evidence.pointerMrfUrl);
});
