'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  clearNewDateRecords, collectExactCandidates, findingFor, headerEvidenceCandidate,
  headerEvidenceDateRecord, mergeDomains, seedDateCache
} = require('../import-corpus');

test('corpus import uses only exact matched_ccns and deduplicates repeated observations', () => {
  const rows = [
    {
      record_status: 'ok', mrf_url: 'https://files.test/a.csv', matched_ccns: '111111',
      related_ccns: '999999', pointer_url: 'http://hospital.test/cms-hpt.txt', fetched_at: '2026-09-01'
    },
    {
      record_status: 'ok', mrf_url: 'https://files.test/a.csv', matched_ccns: '111111',
      related_ccns: '', pointer_url: 'https://hospital.test/cms-hpt.txt', fetched_at: '2026-09-02'
    },
    {
      record_status: 'ok', mrf_url: 'https://files.test/context.csv', matched_ccns: '',
      related_ccns: '222222', pointer_url: 'https://system.test/cms-hpt.txt'
    }
  ];
  const candidates = collectExactCandidates(rows);
  assert.deepEqual([...candidates.keys()], ['111111']);
  assert.equal(candidates.get('111111').pointer_url, 'https://hospital.test/cms-hpt.txt');
});

test('corpus import refuses conflicting MRF URLs for one CCN', () => {
  assert.throws(() => collectExactCandidates([
    { record_status: 'ok', mrf_url: 'https://files.test/a.csv', matched_ccns: '111111' },
    { record_status: 'ok', mrf_url: 'https://files.test/b.csv', matched_ccns: '111111' }
  ]), /conflicting MRF URLs/);
});

test('reviewed header evidence maps to an exact import candidate and reusable date record', () => {
  const candidate = headerEvidenceCandidate({
    header_status: 'matched', header_matched_ccns: '010001',
    pointer_domains: 'hospital.test', pointer_urls: 'http://hospital.test/cms-hpt.txt|https://hospital.test/cms-hpt.txt',
    pointer_location_names: 'Test Hospital', source_page_urls: 'https://hospital.test/prices',
    mrf_url: 'https://files.test/a.csv', mrf_http_status: '404', mrf_range_status: '206',
    mrf_file_kind: 'csv', mrf_content_type: 'text/csv', mrf_bytes: '123',
    mrf_license_state: 'AL', mrf_hospital_name: 'TEST HOSPITAL',
    mrf_last_updated_raw: '9/1/2026', mrf_last_updated: '2026-09-01',
    mrf_date_source: 'file-metadata', mrf_cms_version: '3.0.0', checked_at: '2026-09-02T00:00:00Z'
  }, 'test-header-evidence');
  assert.equal(candidate.matched_ccns, '010001');
  assert.equal(candidate.pointer_url, 'https://hospital.test/cms-hpt.txt');
  assert.equal(candidate.pointer_host, 'hospital.test');
  const date = headerEvidenceDateRecord(candidate);
  assert.equal(date.httpStatus, 404);
  assert.equal(date.rangeStatus, 206);
  assert.equal(date.declaredLastUpdated, '2026-09-01');
  assert.equal(date.ok, true);
});

test('reviewed header evidence ignores non-matches and can report conflicting CCNs', () => {
  assert.equal(headerEvidenceCandidate({
    header_status: 'review', header_matched_ccns: '010001', mrf_url: 'https://files.test/a.csv'
  }, 'test'), null);
  const conflicts = [];
  const candidates = collectExactCandidates([
    { record_status: 'ok', mrf_url: 'https://files.test/a.csv', matched_ccns: '010001' },
    { record_status: 'ok', mrf_url: 'https://files.test/b.csv', matched_ccns: '010001' },
    { record_status: 'ok', mrf_url: 'https://files.test/c.csv', matched_ccns: '010002' }
  ], { conflicts });
  assert.deepEqual([...candidates.keys()], ['010002']);
  assert.deepEqual(conflicts.map(row => row.ccn), ['010001']);
});

test('corpus import leaves existing manifest CCNs untouched even if their corpus URLs conflict', () => {
  const candidates = collectExactCandidates([
    { record_status: 'ok', mrf_url: 'https://files.test/old.csv', matched_ccns: '111111' },
    { record_status: 'ok', mrf_url: 'https://files.test/new.csv', matched_ccns: '111111' },
    { record_status: 'ok', mrf_url: 'https://files.test/add.csv', matched_ccns: '222222' }
  ], { excludeCcns: new Set(['111111']) });
  assert.deepEqual([...candidates.keys()], ['222222']);
});

test('date cache preserves existing MRF evidence and leaves new URLs unseeded', () => {
  const dates = seedDateCache({}, [{
    mrf_url: 'https://files.test/a.csv', mrf_last_updated: '2026-08-01',
    mrf_last_updated_raw: '08/01/2026', mrf_date_source: 'file-metadata',
    mrf_cms_version: '3.0.0', mrf_http_status: '200', mrf_bytes: '123',
    mrf_content_type: 'text/csv', mrf_file_kind: 'csv', mrf_checked_at: '2026-08-02T00:00:00Z',
    mrf_http_last_modified_diagnostic: '2026-08-01'
  }]);
  assert.equal(dates['https://files.test/a.csv'].declaredLastUpdated, '2026-08-01');
  assert.equal(dates['https://files.test/a.csv'].httpStatus, 200);
  assert.equal(dates['https://files.test/new.csv'], undefined);
});

test('retry-new clears only imported URLs that were not already in the manifest', () => {
  const dates = {
    'https://files.test/existing.csv': { headError: 'fetch failed' },
    'https://files.test/new.csv': { headError: 'fetch failed' }
  };
  const imports = [
    { candidate: { mrf_url: 'https://files.test/existing.csv' } },
    { candidate: { mrf_url: 'https://files.test/new.csv' } }
  ];
  assert.equal(clearNewDateRecords(dates, imports, [{ mrf_url: 'https://files.test/existing.csv' }]), 1);
  assert.ok(dates['https://files.test/existing.csv']);
  assert.equal(dates['https://files.test/new.csv'], undefined);
});

test('domain merge keeps prior provenance and adds exact facility CCNs', () => {
  const domains = mergeDomains({
    'hospital.test': { domain: 'hospital.test', ccns: ['111111'], source: 'open-data' }
  }, [{ ccn: '222222', manifest: { domain: 'hospital.test' } }]);
  assert.deepEqual(domains['hospital.test'].ccns, ['111111', '222222']);
  assert.equal(domains['hospital.test'].source, 'open-data');
});

test('new matches inherit the tracker compliance taxonomy', () => {
  const base = { mrf_url: 'https://files.test/a.csv', location_name: 'A Hospital' };
  assert.equal(findingFor({ ...base, mrf_last_updated: '' }, {}, 'Acute Care Hospitals').finding,
    'compliant-date-unverified');
  assert.equal(findingFor({ ...base, mrf_http_status: '404' }, { httpStatus: 404 }, 'Acute Care Hospitals').finding,
    'mrf-url-unreachable');
  assert.equal(findingFor({ ...base, mrf_last_updated: '2026-08-01', mrf_http_status: '404' },
    { httpStatus: 404, rangeStatus: 200, declaredLastUpdated: '2026-08-01' }, 'Acute Care Hospitals').finding,
  'compliant-observed');
  assert.equal(findingFor({ ...base, mrf_last_updated: '2025-01-01', mrf_stale_over_365: 'yes' }, {}, 'Acute Care Hospitals').finding,
    'mrf-stale-over-365-days');
  assert.equal(findingFor(base, {}, 'Acute Care - Veterans Administration').finding,
    'not-applicable-federal');
});
