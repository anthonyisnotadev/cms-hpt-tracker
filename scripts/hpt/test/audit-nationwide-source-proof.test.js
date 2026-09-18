'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { retainedRootMatches } = require('../audit-nationwide-source-proof');

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
