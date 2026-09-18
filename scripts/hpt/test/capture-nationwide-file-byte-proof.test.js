'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { captureSummary } = require('../capture-nationwide-file-byte-proof');

test('capture summary separates attempted requests from valid stored samples', () => {
  const claims = new Map([['https://example.org/a.csv', ['010001']], ['https://example.org/b.csv', ['010002']]]);
  const records = [
    { url: 'https://example.org/a.csv', http_status: 206, bytes_retained: 1024, parsed_root_candidates: [{ mrfHospitalName: 'A' }] },
    { url: 'https://example.org/b.csv', http_status: 403, bytes_retained: 537, parsed_root_candidates: [] }
  ];
  const summary = captureSummary({ nationwide: [{}, {}], claims, prior: { records: [] }, selected: [...claims], attempted: 2,
    records, byUrl: new Map(records.map(record => [record.url, record])) });
  assert.equal(summary.attempted_requests, 2);
  assert.equal(summary.stored_successful_http_samples, 1);
  assert.equal(summary.stored_parsed_root_samples, 1);
  assert.equal(summary.stored_unsuccessful_responses, 1);
  assert.equal(summary.remaining_unattempted_urls, 0);
  assert.equal('completed' in summary, false);
});
