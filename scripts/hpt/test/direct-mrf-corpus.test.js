'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeCcn, stageDirectMrfRows } = require('../direct-mrf-corpus');
const { headerEvidenceCandidate, importedManifestRow } = require('../import-corpus');

test('direct-MRF staging preserves identifiers and treats source CCNs as claims, not matches', () => {
  const roster = [
    { ccn: '010001', name: 'ONE HOSPITAL', state: 'AL' },
    { ccn: '01002F', name: 'FEDERAL HOSPITAL', state: 'AL' }
  ];
  const rows = [{
    ccn: '10001', reporting_entity_name_common: 'One Hospital', state_or_region: 'AL',
    machine_readable_url: 'HTTPS://FILES.TEST/one.csv#fragment',
    machine_readable_page: 'https://one.test/prices', machine_readable_url_status: 'up'
  }, {
    ccn: '01002F', reporting_entity_name_legal: 'Federal Hospital', state_or_region: 'AL',
    machine_readable_url: 'https://files.test/federal.json'
  }];
  const staged = stageDirectMrfRows(rows, roster, [], { sourceFile: 'direct_mrf_links.csv', sourceHash: 'abc' });
  assert.equal(staged.candidates.length, 2);
  assert.equal(staged.candidates[0].related_ccns, '010001');
  assert.equal(staged.candidates[0].matched_ccns, '');
  assert.equal(staged.candidates[0].pointer_url, '');
  assert.equal(staged.candidates[0].source_page_url, 'https://one.test/prices');
  assert.equal(staged.candidates[1].related_ccns, '01002F');
  assert.equal(normalizeCcn('01002F'), '01002F');
});

test('direct-MRF staging separates covered, unknown, state-conflicting, and URL-less rows', () => {
  const roster = [
    { ccn: '010001', name: 'ONE HOSPITAL', state: 'AL' },
    { ccn: '010002', name: 'TWO HOSPITAL', state: 'AL' },
    { ccn: '010003', name: 'THREE HOSPITAL', state: 'AL' }
  ];
  const rows = [
    { ccn: '010001', machine_readable_url: 'https://files.test/covered.csv' },
    { ccn: '999999', machine_readable_url: 'https://files.test/unknown.csv' },
    { ccn: '010002', state_or_region: 'GA', machine_readable_url: 'https://files.test/wrong-state.csv' },
    { ccn: '010003', state_or_region: 'AL', machine_readable_url: '' }
  ];
  const staged = stageDirectMrfRows(rows, roster, [{ ccn: '010001' }]);
  assert.equal(staged.candidates.length, 0);
  assert.deepEqual(staged.summary.reviewReasons, {
    'already-in-manifest': 1,
    'ccn-not-in-current-cms-roster': 1,
    'missing-or-invalid-mrf-url': 1,
    'source-state-disagrees-with-roster': 1
  });
});

test('direct-MRF header imports require the independently matched CCN to be source-claimed', () => {
  const base = {
    header_status: 'matched', header_matched_ccns: '010001|010099',
    related_ccns: '010001|010002', pointer_domains: 'one.test', pointer_urls: '',
    pointer_location_names: 'One Hospital', source_page_urls: 'https://one.test/prices',
    source_datasets: 'direct-mrf-links', mrf_url: 'https://files.test/one.csv',
    mrf_range_status: '206', checked_at: '2026-09-03T00:00:00Z'
  };
  const candidate = headerEvidenceCandidate(base, 'direct-mrf-header-evidence', { requireClaimedCcn: true });
  assert.equal(candidate.matched_ccns, '010001');
  const manifest = importedManifestRow(candidate, {
    ccn: '010001', name: 'ONE HOSPITAL', city: 'DOTHAN', state: 'AL', type: 'Acute Care Hospitals'
  });
  assert.equal(manifest.pointer_url, '');
  assert.equal(manifest.pointer_via, 'direct-mrf');
  assert.equal(manifest.match_method, 'ccn+mrf-header');
  assert.match(manifest.match_corroboration, /independently confirmed/);

  assert.equal(headerEvidenceCandidate({ ...base, header_matched_ccns: '010099' },
    'direct-mrf-header-evidence', { requireClaimedCcn: true }), null);
});
