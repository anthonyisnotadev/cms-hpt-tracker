'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { matchMrfHeader } = require('../lib/mrf-header-match');

test('MRF headers fuzzy-match a unique hospital using license state and ZIP', () => {
  const task = {
    mrf_url: 'https://files.test/good.csv',
    refs: [{ domain: 'good.test', state: 'AL', location_name: 'Good Regional' }]
  };
  const hospitals = [
    { ccn: '010001', name: 'GOOD REGIONAL HOSPITAL', address: '100 MAIN STREET', city: 'DOTHAN', state: 'AL', zip: '36301' },
    { ccn: '010002', name: 'GOOD REGIONAL HOSPITAL NORTH', address: '200 NORTH STREET', city: 'MOBILE', state: 'AL', zip: '36601' }
  ];
  const matched = matchMrfHeader(task, {
    rangeStatus: 206, mrfLicenseState: 'AL',
    mrfHospitalName: 'Good Regional Hospital Campus',
    mrfAddress: '100 Main Street, Dothan, AL 36301'
  }, hospitals);
  assert.equal(matched.status, 'matched');
  assert.deepEqual(matched.matches.map(row => row.hospital.ccn), ['010001']);
});

test('MRF header name without city, address, or ZIP remains review-only', () => {
  const matched = matchMrfHeader({
    mrf_url: 'https://files.test/mercy.csv', refs: [{ domain: 'mercy.test', location_name: 'Mercy' }]
  }, {
    rangeStatus: 200, mrfLicenseState: 'AL', mrfHospitalName: 'Mercy Hospital'
  }, [{ ccn: '010003', name: 'MERCY HOSPITAL', city: 'NORTHPORT', state: 'AL', zip: '35476' }]);
  assert.equal(matched.status, 'review');
  assert.equal(matched.reviews[0].reviewReason, 'mrf-header-name-without-location');
});

test('one system MRF header can recover multiple independently located facilities', () => {
  const task = {
    mrf_url: 'https://system.test/all.csv',
    refs: [{ domain: 'system.test', state: 'AL', location_name: 'Example System' }]
  };
  const hospitals = [
    { ccn: '010010', name: 'EXAMPLE NORTH HOSPITAL', address: '1 NORTH ST', city: 'NORTH', state: 'AL', zip: '35001' },
    { ccn: '010011', name: 'EXAMPLE SOUTH HOSPITAL', address: '2 SOUTH ST', city: 'SOUTH', state: 'AL', zip: '35002' }
  ];
  const matched = matchMrfHeader(task, {
    rangeStatus: 206, mrfLicenseState: 'AL', mrfHospitalName: 'Example System',
    mrfLocationName: 'Example North Hospital|Example South Hospital',
    mrfAddress: '1 North St, North, AL 35001|2 South St, South, AL 35002'
  }, hospitals);
  assert.deepEqual(matched.matches.map(row => row.hospital.ccn).sort(), ['010010', '010011']);
});

test('MRF header recovery refuses conflicting VA and rehabilitation identities', () => {
  const task = {
    mrf_url: 'https://files.test/wrong.csv',
    refs: [{ domain: 'wrong.test', state: 'MO', location_name: 'St Lukes Rehabilitation Hospital' }]
  };
  const rehab = matchMrfHeader(task, {
    rangeStatus: 206, mrfLicenseState: 'MO', mrfHospitalName: 'St Lukes Rehabilitation Hospital LLC',
    mrfAddress: '14709 Olive Blvd, Chesterfield, MO 63017'
  }, [{
    ccn: '260179', name: 'ST LUKES HOSPITAL', address: '232 S WOODS MILL RD',
    city: 'CHESTERFIELD', state: 'MO', zip: '63017'
  }]);
  assert.equal(rehab.matches.length, 0);

  const va = matchMrfHeader(task, {
    rangeStatus: 206, mrfLicenseState: 'NY', mrfHospitalName: 'Albany Medical Center Hospital',
    mrfAddress: '43 New Scotland Avenue, Albany, NY 12208'
  }, [{
    ccn: '33009F', name: 'ALBANY VA MEDICAL CENTER', address: '113 HOLLAND AVENUE',
    city: 'ALBANY', state: 'NY', zip: '12208'
  }]);
  assert.equal(va.matches.length, 0);
});
