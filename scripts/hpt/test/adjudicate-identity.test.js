'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { adjudicateIdentity, stripCorporate, stripCampus, dbaSuffix } = require('../lib/adjudicate-identity');

const rosterRow = { ccn: '161348', name: 'CLARKE COUNTY HOSPITAL', address: '800 S FILLMORE ST', city: 'OSCEOLA', state: 'IA', zip: '50213' };
const roster = [rosterRow];
const goodAddress = '800 S. Fillmore St., Osceola, IA 50213';

test('corporate suffix helpers reduce names as documented', () => {
  assert.equal(dbaSuffix('St. Elizabeth Healthcare LLC d/b/a Clarke County Hospital'), 'Clarke County Hospital');
  assert.equal(dbaSuffix('Clarke County Hospital'), null);
  assert.equal(stripCampus('clarke county hosp main campus'), 'clarke county hosp');
  assert.equal(stripCampus('clarke county hosp'), 'clarke county hosp');
});

test('T1 DBA clause with agreeing roster address is accepted', () => {
  const r = adjudicateIdentity({ rosterRow, roster, pointerLinked: true, pointerLabels: ['Clarke County Hospital'],
    member: { mrfHospitalName: 'Clarke County Public Hospital LLC d/b/a Clarke County Hospital', mrfLocationName: 'Clarke County Hospital', mrfAddress: goodAddress, mrfLicenseState: 'IA' } });
  assert.equal(r.accept, true);
  assert.equal(r.basis, 'dba-name-and-roster-address');
});

test('T1 refuses a DBA clause naming a different facility', () => {
  const r = adjudicateIdentity({ rosterRow, roster, pointerLinked: true, pointerLabels: ['Other Name'],
    member: { mrfHospitalName: 'X LLC d/b/a Unionville Hospital', mrfLocationName: 'Unionville Hospital', mrfAddress: goodAddress, mrfLicenseState: 'IA' } });
  assert.equal(r.accept, false);
});

test('T2 corporate-suffix-only difference never reaches adjudication (normalizer drops suffixes)', () => {
  const r = adjudicateIdentity({ rosterRow, roster, pointerLinked: true, pointerLabels: ['Clarke County Hospital LLC'],
    member: { mrfHospitalName: 'Clarke County Hospital, LLC', mrfLocationName: 'Clarke County Hospital', mrfAddress: goodAddress, mrfLicenseState: 'IA' } });
  // matchMrfHeader already accepts suffix-only differences via normalizeName,
  // so this module only ever sees them if something else failed; no tier here
  // may relax identity further.
  assert.equal(r.accept, false);
  assert.equal(r.reason, 'no-adjudication-tier-applies');
});

test('T3 campus qualifier accepted for a unique base name, refused when ambiguous', () => {
  const ok = adjudicateIdentity({ rosterRow, roster, pointerLinked: true, pointerLabels: ['Clarke County Hospital Main Campus'],
    member: { mrfHospitalName: 'Clarke County Hospital Main Campus', mrfLocationName: 'Clarke County Hospital', mrfAddress: goodAddress, mrfLicenseState: 'IA' } });
  assert.equal(ok.accept, true);
  assert.equal(ok.basis, 'campus-qualified-name-and-roster-address');
  const twin = { ccn: '161349', name: 'CLARKE COUNTY HOSPITAL', address: '9 OTHER ST', city: 'DES MOINES', state: 'IA', zip: '50309' };
  const ambiguous = adjudicateIdentity({ rosterRow: rosterRow, roster: [rosterRow, twin], pointerLinked: true, pointerLabels: [],
    member: { mrfHospitalName: 'Clarke County Hospital Main Campus', mrfLocationName: 'Clarke County Hospital', mrfAddress: goodAddress, mrfLicenseState: 'IA' } });
  assert.equal(ambiguous.accept, false); // base name maps to two roster facilities
  assert.equal(ambiguous.reason, 'campus-base-name-is-ambiguous-in-roster');
});

test('T4 rename accepted only with pointer endorsement and agreeing address', () => {
  const renamed = adjudicateIdentity({ rosterRow, roster, pointerLinked: true, pointerLabels: ['Amberwell Clarke County'],
    member: { mrfHospitalName: 'Amberwell Clarke County', mrfLocationName: 'Amberwell Clarke County', mrfAddress: goodAddress, mrfLicenseState: 'IA' } });
  assert.equal(renamed.accept, true);
  assert.equal(renamed.basis, 'renamed-facility-pointer-label-and-roster-address');
  const unendorsed = adjudicateIdentity({ rosterRow, roster, pointerLinked: false, pointerLabels: [],
    member: { mrfHospitalName: 'Amberwell Clarke County', mrfLocationName: 'Amberwell Clarke County', mrfAddress: goodAddress, mrfLicenseState: 'IA' } });
  assert.equal(unendorsed.accept, false);
});

test('T5 missing license state is accepted on exact name plus strong address', () => {
  const r = adjudicateIdentity({ rosterRow, roster, pointerLinked: true, pointerLabels: ['Clarke County Hospital'],
    member: { mrfHospitalName: 'Clarke County Hospital', mrfLocationName: 'Clarke County Hospital', mrfAddress: goodAddress, mrfLicenseState: '' } });
  assert.equal(r.accept, true);
  assert.equal(r.basis, 'exact-name-and-address-without-license-state');
});

test('address and state always anchor the decision', () => {
  const wrongAddress = adjudicateIdentity({ rosterRow, roster, pointerLinked: true, pointerLabels: ['Clarke County Hospital'],
    member: { mrfHospitalName: 'Clarke County Hospital', mrfLocationName: 'Clarke County Hospital', mrfAddress: '12 Market St, Des Moines, IA 50309', mrfLicenseState: 'IA' } });
  assert.equal(wrongAddress.accept, false);
  const wrongState = adjudicateIdentity({ rosterRow, roster, pointerLinked: true, pointerLabels: ['Clarke County Hospital'],
    member: { mrfHospitalName: 'Clarke County Hospital', mrfLocationName: 'Clarke County Hospital', mrfAddress: goodAddress, mrfLicenseState: 'MO' } });
  assert.equal(wrongState.accept, false);
  const sameAddressDifferentHospital = adjudicateIdentity({ rosterRow, roster: [{ ...rosterRow }, { ccn: '161999', name: 'OSCEOLA CLINIC HOSPITAL', address: '800 S FILLMORE ST', city: 'OSCEOLA', state: 'IA', zip: '50213' }],
    pointerLinked: true, pointerLabels: ['Clarke County Hospital'],
    member: { mrfHospitalName: 'Clarke County Hospital', mrfLocationName: 'Clarke County Hospital', mrfAddress: goodAddress, mrfLicenseState: 'IA' } });
  assert.equal(sameAddressDifferentHospital.accept, false);
  assert.equal(sameAddressDifferentHospital.reason, 'roster-has-another-facility-at-this-address');
});
