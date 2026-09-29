'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resultLinks, adjudicateOne } = require('../nationwide-web-discovery');

test('Bing redirect wrappers decode to the underlying result URL', () => {
  const target = 'https://hospital.example/locations/main-hospital';
  const encoded = Buffer.from(target).toString('base64url');
  const html = `<ol><li class="b_algo"><h2><a href="https://www.bing.com/ck/a?u=a1${encoded}">Main Hospital</a></h2><p>Official location</p></li></ol>`;
  assert.deepEqual(resultLinks('bing', html), [{
    url: target,
    host: 'hospital.example',
    title: 'Main Hospital',
    text: 'Main HospitalOfficial location'
  }]);
});

test('failed search transport remains a search error, not a negative finding', () => {
  const record = adjudicateOne({ ccn: '010001', hospital_name: 'TEST HOSPITAL', address: '1 MAIN ST', city: 'TESTVILLE', state: 'AL' }, {
    query: 'test query',
    attempts: [{ checked_at: '2026-09-15T00:00:00Z', http_status: 0, transport_error: 'timeout', results: [] }],
    pages: []
  });
  assert.equal(record.status, 'search-error');
  assert.match(record.reason, /no negative website conclusion/i);
});
