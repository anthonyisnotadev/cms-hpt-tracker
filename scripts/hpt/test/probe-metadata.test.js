'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractDeclared, sniffKind, toISODate } = require('../lib/probe');
test('only an explicitly labeled update date is accepted from CSV', () => {
  const file = 'hospital_name,version,service_date\nExample,3.0.0,2024-01-01';
  assert.equal(extractDeclared(Buffer.from(file), 'csv').raw, null);
  const preamble = '\nExported hospital data\nhospital_name,last_updated_on,version\nExample,2026-09-01,3.0.0';
  assert.equal(extractDeclared(Buffer.from(preamble), 'csv').raw, '2026-09-01');
});
test('HTML overrides a misleading MIME type and unrelated state is not a license', () => {
  assert.equal(sniffKind(Buffer.from('<!doctype html><html>Error</html>'), 'application/json'), 'html');
  assert.equal(extractDeclared(Buffer.from('{"state":"CA","hospital_name":"Example"}'), 'json').licenseState, null);
});
test('impossible calendar dates are rejected', () => {
  assert.equal(toISODate('2026-02-30'), null);
  assert.equal(toISODate('2/29/2024'), '2024-02-29');
  assert.equal(toISODate('2/29/2025'), null);
});
test('nested price-row metadata cannot substitute for root metadata', () => {
  const nested = '{"standard_charge_information":[{"version":"2.0.0","last_updated_on":"2020-01-01","state":"FL"}],"hospital_name":"Example","version":"3.0.0","last_updated_on":"2026-09-01","license_information":{"state":"AL"}}';
  const result = extractDeclared(Buffer.from(nested), 'json');
  assert.equal(result.raw, '2026-09-01');
  assert.equal(result.version, '3.0.0');
  assert.equal(result.licenseState, 'AL');
  assert.equal(extractDeclared(Buffer.from('{"standard_charge_information":[{"last_updated_on":"2020-01-01"}]}'), 'json').raw, null);
});
test('complete elements of a truncated header array remain readable', () => {
  const result = extractDeclared(Buffer.from('{"hospital_name":"Example","hospital_address":["1 Main St, Town AL 12345",'), 'json');
  assert.equal(result.address, '1 Main St, Town AL 12345');
});
