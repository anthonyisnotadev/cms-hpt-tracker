'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadReviewedView, applyRetainedParserCorrections } = require('../lib/reviewed-resolutions');
const { effectiveVerifiedFinding } = require('../lib/nationwide-verification-view');
const { buildAssessmentHistory } = require('../lib/assessment-history');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('retained Nocona bytes correct parser transcription without promoting template status', () => {
  const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-version-parser-corrections.json'))).records[0];
  const source = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-verification.json'))).records
    .find(row => row.ccn === proof.ccn);
  assert.equal(source.cms_template_version, 'ERSION 4.0'); // Original parser output remains an audit source.
  const reviewed = loadReviewedView(audit);
  const row = reviewed.compliance.find(item => item.ccn === proof.ccn);
  const proposed = reviewed.nationwide.records.find(item => item.ccn === proof.ccn);
  assert.equal(row.cms_template_version, 'VERSION 4.0');
  assert.equal(proposed.cms_template_version, 'VERSION 4.0');
  assert.equal(row.finding, 'mrf-template-version-noncanonical');
  assert.equal(proposed.disposition, 'verified-template-review');
  assert.match(row.evidence, /earlier parser recorded ERSION 4\.0/);
  assert.throws(() => applyRetainedParserCorrections([{ ...row, cms_template_version: '3.0.0' }], [proof]),
    /no longer matches standing row/);
});

test('template-review reconciliation distinguishes older from noncanonical literals', () => {
  for (const version of ['2026.1.0', '5.0.0', 'VERSION 4.0', '4.0.0'])
    assert.equal(effectiveVerifiedFinding({ disposition: 'verified-template-review', cms_template_version: version }),
      'mrf-template-version-noncanonical');
  assert.equal(effectiveVerifiedFinding({ disposition: 'verified-template-review', cms_template_version: '2.0.0' }),
    'old-template-version');
});

test('earlier Nocona assessment remains historical and visibly flags the parser correction', () => {
  const correction = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-version-parser-corrections.json'))).records[0];
  const legacy = [{ ccn: correction.ccn, checked_at: '2026-09-09T02:24:54Z',
    mrf_url: correction.mrf_url, version: correction.previous_parser_value,
    metadata: 'date-within-365-days-version-unverified' }];
  const history = buildAssessmentHistory(legacy, [], [], [], [correction]).assessmentHistory[correction.ccn];
  assert.equal(history[0].version, 'ERSION 4.0');
  assert.match(history[0].metadata, /Parser transcription corrected to literal VERSION 4\.0/);
});
