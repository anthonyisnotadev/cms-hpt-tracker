'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { retainedRootMatches, addressFieldMatches } = require('../audit-nationwide-source-proof');
const path = require('path');

const root = path.resolve(__dirname, '../../..');

const record = {
  declared_hospital_name: 'Monongahela Valley Hospital',
  declared_location_name: 'Penn Highlands Mon Valley',
  declared_address: '1163 Country Club Road, Monongahela, PA 15063',
  declared_last_updated: '2026-02-02',
  cms_template_version: '3.0.0'
};

test('retained proof may use exact location identity only with agreeing address, date and version', () => {
  assert.equal(retainedRootMatches(record, {
    mrfHospitalName: 'Monogahela Valley Hospital',
    mrfLocationName: 'Penn Highlands Mon Valley',
    mrfAddress: '1163 Country Club RD. Monongahela, PA 15063',
    declaredLastUpdated: '2026-02-02',
    cmsVersion: '3.0.0'
  }), true);
});

test('retained proof treats equivalent ISO and US date encodings as the same declared date', () => {
  assert.equal(retainedRootMatches(record, {
    mrfHospitalName: 'Monongahela Valley Hospital',
    mrfLocationName: 'Penn Highlands Mon Valley',
    mrfAddress: '1163 Country Club Road, Monongahela, PA 15063',
    declaredLastUpdated: '2/2/2026',
    cmsVersion: '3.0.0'
  }), true);
});

test('retained location identity cannot hide a conflicting street address', () => {
  assert.equal(retainedRootMatches(record, {
    mrfHospitalName: 'Monogahela Valley Hospital',
    mrfLocationName: 'Penn Highlands Mon Valley',
    mrfAddress: '999 Different Street, Monongahela, PA 15063',
    declaredLastUpdated: '2026-02-02',
    cmsVersion: '3.0.0'
  }), false);
});

test('retained proof can match one explicitly listed location in a multi-location root', () => {
  assert.equal(retainedRootMatches({ ...record,
    declared_hospital_name: 'Mount Sinai Morningside',
    declared_location_name: 'Mount Sinai West',
    declared_address: '1000 Tenth Avenue, New York, NY 10019' }, {
    mrfHospitalName: 'Mount Sinai Morningside',
    mrfLocationName: 'Mount Sinai Morningside|Mount Sinai West',
    mrfAddress: '1111 Amsterdam Ave, New York, NY 10025|1000 Tenth Avenue, New York, NY 10019',
    declaredLastUpdated: '2026-02-02',
    cmsVersion: '3.0.0'
  }), true);
});

test('multi-location proof cannot lend a sibling name with a different address', () => {
  assert.equal(retainedRootMatches({ ...record,
    declared_hospital_name: 'Mount Sinai Morningside',
    declared_location_name: 'Unlisted Sibling Hospital',
    declared_address: '999 Different Street, New York, NY 10019' }, {
    mrfHospitalName: 'Mount Sinai Morningside',
    mrfLocationName: 'Mount Sinai Morningside|Mount Sinai West',
    mrfAddress: '1111 Amsterdam Ave, New York, NY 10025|1000 Tenth Avenue, New York, NY 10019',
    declaredLastUpdated: '2026-02-02',
    cmsVersion: '3.0.0'
  }), false);
});

test('source-proof audit compares a facility address to members of a multi-campus header', () => {
  const audit = require(path.join(root, 'data/hpt-audit/nationwide-source-proof-audit.json'));
  const springMountain = audit.records.find(item => item.ccn === '294011');
  assert.ok(springMountain);
  assert.equal(springMountain.issues.includes('source-field-disagreement:declared_address'), false);
  assert.equal(springMountain.identity_source, 'byte-proof');
  // The distinct directional discrepancy against the CMS roster remains
  // visible pending a facility-specific reviewed address-equivalence record.
  assert.equal(springMountain.issues.includes('street-evidence-review'), true);
});

test('source-proof field comparison matches one address within a declared multi-campus value', () => {
  const aggregate = '1710 Harrison St, Batesville, AR 72501|2106 East Main Street, Mountain View, ARKANSAS 72560';
  assert.equal(addressFieldMatches(aggregate, '2106 East Main Street, Mountain View AR 72560'), true);
  assert.equal(addressFieldMatches(aggregate, '999 Different Road, Mountain View AR 72560'), false);
});

test('source-proof field comparison ignores punctuation-only address variants', () => {
  assert.equal(addressFieldMatches('1200 W Maple Ave Geneva AL 36340', '1200 W Maple Ave, Geneva, AL 36340'), true);
});
