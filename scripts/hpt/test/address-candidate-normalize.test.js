'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { compactStreet, compactSiteStreet, addressHasZip } = require('../lib/address-candidate-normalize');

test('exact-address lead normalization preserves cardinal abbreviations', () => {
  assert.equal(compactStreet('900 NORTH HIGH SCHOOL ROAD'), compactStreet('900 N High School Rd'));
  assert.equal(compactStreet('1721 SOUTH STEPHENSON AVENUE'), compactStreet('1721 S Stephenson Ave'));
  assert.equal(compactStreet('301 EAST MAIN STREET'), compactStreet('301 E Main St'));
  assert.equal(compactStreet('411 WEST RANDOLPH ROAD'), compactStreet('411 W Randolph Rd'));
  assert.notEqual(compactStreet('900 NORTH HIGH SCHOOL ROAD'), compactStreet('900 SOUTH HIGH SCHOOL ROAD'));
});

test('investigative address leads may omit suite and express ZIP+4 without a dash', () => {
  const roster = '3600 FLORIDA BLVD, SUITE 2020';
  const declared = '3600 FLORIDA BLVD, BATON ROUGE, LA 708063842';
  assert.ok(compactStreet(declared).includes(compactSiteStreet(roster)));
  assert.equal(addressHasZip(declared, '70806'), true);
  assert.equal(addressHasZip('3600 FLORIDA BLVD, BATON ROUGE, LA 70806-3842', '70806'), true);
  assert.equal(addressHasZip(declared, '70809'), false);
  assert.equal(addressHasZip('3600 FLORIDA BLVD, BATON ROUGE, LA 1708063842', '70806'), false);
});
