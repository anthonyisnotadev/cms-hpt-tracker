'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseResults, candidateScore, officialLooking, governmentOperatorResult } = require('../deepen-candidate-identities');

const row = {
  ccn: '123456', hospital_name: 'Example Valley Hospital', address: '123 Main Street',
  city: 'Sampletown', state: 'TX', candidate_urls: ['https://examplevalleyhospital.org/'],
};

test('parses built-in search result sections and accepts exact first-party identity', () => {
  const [result] = parseResults('Example Valley Hospital (https://examplevalleyhospital.org/contact)\n123 Main Street, Sampletown, TX 75000');
  const scored = candidateScore(row, result);
  assert.equal(scored.identity_match, true);
  assert.equal(officialLooking(row, scored), true);
});

test('directory result is address evidence but never an official website', () => {
  const [result] = parseResults('Example Valley Hospital (https://carelens.io/hospitals/123456)\n123 Main Street, Sampletown, TX 75000');
  const scored = candidateScore(row, result);
  assert.equal(scored.identity_match, true);
  assert.equal(scored.denied, true);
  assert.equal(officialLooking(row, scored), false);
});

test('government operator page is distinguished from a licensing profile', () => {
  assert.equal(governmentOperatorResult({ host: 'www.ihs.gov', url: 'https://www.ihs.gov/navajo/healthcarefacilities/example/' }), true);
  assert.equal(governmentOperatorResult({ host: 'hcai.ca.gov', url: 'https://hcai.ca.gov/facility/example-hospital/' }), false);
});
