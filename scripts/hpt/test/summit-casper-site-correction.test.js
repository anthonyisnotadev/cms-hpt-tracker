'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { applyResolutions } = require('../lib/reviewed-resolutions');
const { build } = require('../build-unresolved-investigation-worklist');

const audit = path.resolve(__dirname, '../../../data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-summit-casper-site-proof.json'), 'utf8'));
const resolution = JSON.parse(fs.readFileSync(path.join(audit, 'reviewed-resolutions.json'), 'utf8'))
  .find(row => row.ccn === '530034');

test('Summit Casper corrects a wrong HCA site without promoting unretained pointer bytes', () => {
  assert.equal(proof.ccn, resolution.ccn);
  assert.equal(proof.old_domain, resolution.base.domain);
  assert.equal(proof.official_domain, resolution.evidence.officialDomain);
  assert.equal(resolution.finding, 'verified-current-mrf');
  assert.equal(resolution.evidence.declared_address, '6350 E 2nd St, Casper, WY 82609');
  assert.equal(resolution.evidence.declared_license_state, 'WY');
  assert.equal(resolution.evidence.date, '2026-03-25');
  assert.equal(resolution.evidence.version, '3.0.0');
  const effective = applyResolutions([resolution.base], [], [], [resolution]);
  assert.deepEqual(effective.applied, ['530034']);
  assert.equal(effective.compliance[0].domain, 'summitmedicalcasper.com');
  assert.equal(effective.compliance[0].finding, 'compliant-observed');
  assert.equal(effective.compliance[0].mrf_url, resolution.evidence.url);
  const reconciliation = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-reconciliation.json'), 'utf8'));
  const verification = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-verification.json'), 'utf8'));
  const queued = build(reconciliation, verification).records.find(row => row.ccn === '530034');
  assert.equal(queued, undefined);
});
