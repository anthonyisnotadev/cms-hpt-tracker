'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { collect } = require('../build-template-version-discrepancies');

test('version discrepancy inventory distinguishes same-file label correction from changed-file review', () => {
  const base = { hospital_name: 'HOSPITAL', city: 'CITY', state: 'NY',
    finding: 'compliant-observed', cms_template_version: '3.0', mrf_url: 'https://example.org/a.csv', checked_at: '2026-09-01' };
  const observed = { hospital_name: base.hospital_name, city: base.city, state: base.state,
    prior_finding: base.finding, disposition: 'verified-template-review', cms_template_version: '3.0',
    metadata_source: 'header-observation', facility_identity: 'corroborated-by-pointer-and-header',
    header_identity_gate: 'file-name-and-address', mrf_http_status: '206', observed_at: '2026-09-15' };
  const standing = [{ ...base, ccn: '000001' }, { ...base, ccn: '000002' }];
  const records = [{ ...observed, ccn: '000001', mrf_url: base.mrf_url },
    { ...observed, ccn: '000002', mrf_url: 'https://example.org/b.csv' }];
  const rows = collect(records, standing);
  assert.equal(rows.find(row => row.ccn === '000001').displayed_finding, 'compliant-observed');
  assert.equal(rows.find(row => row.ccn === '000002').displayed_finding, 'compliant-observed');
  assert.equal(rows.find(row => row.ccn === '000002').review_priority, '1-different-file-pointer-match-unresolved');
  assert.equal(collect([{ ...records[1], pointer_state: 'retrieved-facility-linked' }], standing)[0].review_priority,
    '1-different-file-pointer-match-unresolved');
  const proven = { ...records[1], pointer_state: 'retrieved-facility-linked',
    pointer_url: 'https://example.org/cms-hpt.txt', pointer_corpus_checked_url: 'https://example.org/cms-hpt.txt',
    pointer_corpus_sha256: 'a'.repeat(64), pointer_corpus_raw_integrity: 'hash-corroborated',
    pointer_corpus_observed_at: '2026-09-15',
    evidence: { pointer_sha256s: ['a'.repeat(64)], matched_mrf_candidates: 1 } };
  assert.equal(collect([proven], standing)[0].review_priority,
    '1-different-file-pointer-match-unresolved');
});
