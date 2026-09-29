'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { buildQueue } = require('../build-html-pointer-target-queue');

test('HTML target queue separates exact pointer links, contextual links, and reviewed intermediaries', () => {
  const headers = [
    { mrf_url: 'https://x.test/prices/', mrf_http_status: '200', mrf_content_type: 'text/html',
      mrf_file_kind: 'html', existing_matched_ccns: '000001|000002', checked_at: '2026-09-16T00:00:00Z' },
    { mrf_url: 'https://x.test/file.csv', mrf_http_status: '200', mrf_content_type: 'text/html',
      mrf_file_kind: 'html', existing_matched_ccns: '000003', checked_at: '2026-09-16T00:00:00Z' }
  ];
  const pointers = [{ matched_ccns: '000001', related_ccns: '000001|000002',
    mrf_url: 'https://x.test/prices/', pointer_url: 'https://x.test/cms-hpt.txt' },
  { matched_ccns: '000003', mrf_url: 'https://x.test/file.csv', pointer_url: 'https://x.test/cms-hpt.txt' }];
  const facilities = ['000001', '000002', '000003'].map(ccn => ({ 'Facility ID': ccn,
    'Facility Name': `Hospital ${ccn}`, State: 'PA' }));
  const resolutions = [{ ccn: '000001', evidence: { observedFinding: 'pointer-links-html-download-page-with-file' } }];
  const rows = buildQueue(headers, pointers, facilities, resolutions);
  assert.equal(rows.length, 3);
  assert.equal(rows.find(row => row.ccn === '000001').review_status, 'reviewed-html-intermediary-with-file-proof');
  assert.equal(rows.find(row => row.ccn === '000002').review_status, 'existing-link-not-exact-pointer-matched');
  assert.equal(rows.find(row => row.ccn === '000002').pointer_url, '');
  assert.equal(rows.find(row => row.ccn === '000003').target_kind, 'file-like-url-returned-html');
  assert.equal(rows.find(row => row.ccn === '000003').priority, 2);
});

test('reviewed rendered not-found portal stays in the queue as monitored evidence', () => {
  const rows = buildQueue([{ mrf_url: 'https://portal.test/standard-charges', mrf_http_status: '206',
    mrf_content_type: 'text/html', mrf_file_kind: 'html', existing_matched_ccns: '000004' }],
  [{ matched_ccns: '000004', mrf_url: 'https://portal.test/standard-charges',
    pointer_url: 'https://hospital.test/cms-hpt.txt' }],
  [{ 'Facility ID': '000004', 'Facility Name': 'Hospital 4', State: 'PA' }],
  [{ ccn: '000004', evidence: { observedFinding: 'pointer-html-portal-not-found-source-page-current-file' } }]);
  assert.equal(rows[0].priority, 3);
  assert.equal(rows[0].review_status, 'reviewed-portal-not-found-with-first-party-file-proof');
});

test('dated CAPTCHA observation stays an access challenge, not a download intermediary or file verdict', () => {
  const url = 'https://hospital.test/standardcharges';
  const rows = buildQueue([{ mrf_url: url, mrf_http_status: '200', mrf_content_type: 'text/html',
    mrf_file_kind: 'html', existing_matched_ccns: '000005', checked_at: '2026-09-15T00:00:00Z' }],
  [{ matched_ccns: '000005', mrf_url: url, pointer_url: 'https://hospital.test/cms-hpt.txt' }],
  [{ 'Facility ID': '000005', 'Facility Name': 'Hospital 5', State: 'PA' }], [],
  [{ ccn: '000005', pointer_url: 'https://hospital.test/cms-hpt.txt', pointer_mrf_url: url,
    http_status: 200, html_title: 'Radware Captcha Page', observed_at: '2026-09-16T00:00:00Z',
    next_action: 'Retry after access changes.' }]);
  assert.equal(rows[0].target_kind, 'automation-challenge-html');
  assert.equal(rows[0].review_status, 'observed-automation-captcha-preserve-prior-evidence');
  assert.equal(rows[0].priority, 2);
  assert.equal(rows[0].review_checked_at, '2026-09-16T00:00:00Z');
  assert.equal(rows[0].next_action, 'Retry after access changes.');
});

test('file-like target rendering a not-found page is not a working HTML intermediary', () => {
  const url = 'https://hospital.test/standardcharges.csv';
  const rows = buildQueue([{ mrf_url: url, mrf_http_status: '200', mrf_content_type: 'text/html',
    mrf_file_kind: 'html', existing_matched_ccns: '000006' }],
  [{ matched_ccns: '000006', mrf_url: url, pointer_url: 'https://hospital.test/cms-hpt.txt' }],
  [{ 'Facility ID': '000006', 'Facility Name': 'Hospital 6', State: 'NJ' }],
  [{ ccn: '000006', evidence: { observedFinding: 'pointer-file-url-renders-not-found-source-page-current-file' } }]);
  assert.equal(rows[0].target_kind, 'file-like-url-returned-html');
  assert.equal(rows[0].review_status, 'reviewed-file-url-not-found-with-first-party-file-proof');
  assert.equal(rows[0].priority, 3);
});

test('access review updates the exact target only, without promoting it to file proof', () => {
  const url = 'https://vendor.test/pricer/file.csv';
  const base = [{ mrf_url: url, mrf_http_status: '200', mrf_content_type: 'text/html',
    mrf_file_kind: 'html', existing_matched_ccns: '000007' }];
  const pointers = [{ matched_ccns: '000007', mrf_url: url,
    pointer_url: 'https://hospital.test/cms-hpt.txt' }];
  const facilities = [{ 'Facility ID': '000007', 'Facility Name': 'Hospital 7', State: 'TX' }];
  const review = { ccn: '000007', pointer_url: pointers[0].pointer_url,
    target_sha256: crypto.createHash('sha256').update(url).digest('hex'),
    review_status: 'reviewed-pricer-app-shell-no-csv-proof',
    observed_at: '2026-09-16T09:36:14Z', next_action: 'Recover the exact CSV.' };
  const matching = buildQueue(base, pointers, facilities, [], [], [review])[0];
  assert.equal(matching.review_status, review.review_status);
  assert.equal(matching.priority, 2);
  assert.equal(matching.review_checked_at, review.observed_at);
  assert.equal(matching.next_action, review.next_action);
  const changed = buildQueue([{ ...base[0], mrf_url: `${url}?changed=1` }],
    [{ ...pointers[0], mrf_url: `${url}?changed=1` }], facilities, [], [], [review])[0];
  assert.equal(changed.review_status, 'needs-target-and-link-review');
});
