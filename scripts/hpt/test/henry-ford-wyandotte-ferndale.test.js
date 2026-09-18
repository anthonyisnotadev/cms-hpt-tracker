'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { applyResolutions, loadReviewedView } = require('../lib/reviewed-resolutions');

const audit = path.resolve(__dirname, '../../../data/hpt-audit');
const ledger = require(path.join(audit, 'reviewed-resolutions.json'));

test('Wyandotte file is promoted only to its Wyandotte roster campus', () => {
  const wyandotte = ledger.find(row => row.ccn === '230146');
  const ferndale = ledger.find(row => row.ccn === '234011');
  assert.equal(wyandotte.action, 'replace');
  assert.equal(ferndale.action, 'quarantine');
  assert.equal(wyandotte.evidence.url, ferndale.base.mrf_url);
  assert.equal(wyandotte.evidence.declared_hospital_name, 'Henry Ford Wyandotte Hospital');
  assert.match(wyandotte.evidence.declared_address, /2333 Biddie Avenue, Wyandotte, MI 48192/);
  assert.match(wyandotte.note, /Biddle/);
  assert.equal(wyandotte.evidence.declared_license_state, 'MI');
  assert.equal(wyandotte.evidence.date, '2026-06-28');
  assert.equal(wyandotte.evidence.version, '3.0.0');
  assert.match(ferndale.proof.rosterAddress, /10300 W EIGHT MILE ROAD/);
  const result = applyResolutions([wyandotte.base, ferndale.base], [], [], [wyandotte, ferndale]);
  const by = new Map(result.compliance.map(row => [row.ccn, row]));
  assert.equal(by.get('230146').mrf_url, wyandotte.evidence.url);
  assert.equal(by.get('230146').finding, 'compliant-observed');
  assert.equal(by.get('234011').mrf_url, '');
  assert.equal(by.get('234011').cms_template_version, '');
  assert.equal(by.get('234011').finding, 'not-assessed-identity-conflict');
  assert.equal(result.history['234011'].mrf_url, ferndale.base.mrf_url);
});

test('standing view never reuses the Wyandotte file for Ferndale', () => {
  const view = loadReviewedView(audit);
  assert.match(view.compliance.find(row => row.ccn === '230146').mrf_url, /wyandotte-hospital_standardcharges\.csv$/);
  assert.equal(view.compliance.find(row => row.ccn === '234011').mrf_url, '');
});
