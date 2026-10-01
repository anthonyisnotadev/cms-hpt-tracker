'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { correctTemplateVersionFinding } = require('../lib/reviewed-resolutions');

test('current version classification preserves the literal and uncertainty', () => {
  const row = (version, finding = 'compliant-observed') => ({
    ccn: '000001', cms_template_version: version, finding, evidence: 'original evidence'
  });
  const results = correctTemplateVersionFinding([
    row('3.0.0'), row('2.2.0'), row('3.0'), row('3.0.1'), row(''),
    row('4.0.0', 'old-template-version'), row('2.0.0', 'mrf-stale-over-365-days')
  ]);
  assert.deepEqual(results.map(result => result.finding), [
    'compliant-observed', 'old-template-version', 'compliant-observed',
    'mrf-template-version-noncanonical', 'compliant-observed',
    'mrf-template-version-noncanonical', 'mrf-stale-over-365-days'
  ]);
  assert.equal(results[2].cms_template_version, '3.0');
  assert.equal(results[2].evidence, 'original evidence');
});
