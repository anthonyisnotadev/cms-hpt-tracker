'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { metadataStatus } = require('../recheck-interventions');
const now = Date.parse('2026-09-09T12:00:00Z');
test('recheck reports observed metadata without promoting missing, future, or invalid dates', () => {
  const status = (declared_date, version) => metadataStatus({ declared_date, version }, now);
  assert.equal(status('', '3.0.0'), 'date-unverified');
  assert.equal(status('2026-02-30', '3.0.0'), 'date-invalid');
  assert.equal(status('2027-01-01', '3.0.0'), 'future-date-review');
  assert.equal(status('2025-09-08', '3.0.0'), 'date-over-365-days');
  assert.equal(status('2025-09-09', '3.0.0'), 'date-within-365-days-version-3');
  assert.equal(status('2026-09-08', '2.2.0'), 'date-within-365-days-older-version');
  assert.equal(status('2026-09-08', ''), 'date-within-365-days-version-unverified');
});
