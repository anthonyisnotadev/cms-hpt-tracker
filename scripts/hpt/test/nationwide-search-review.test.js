'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validate, upsert } = require('../nationwide-search-review');

test('official search results require first-party identity evidence', () => {
  assert.throws(() => validate({ ccn: '010001', status: 'official', domain: 'example.test', query: 'q', reason: 'r' }), /name evidence/);
  assert.doesNotThrow(() => validate({ ccn: '010001', status: 'official', domain: 'example.test', query: 'q', reason: 'r',
    name_evidence: 'https://example.test/hospital', address_evidence: 'https://example.test/contact' }));
});

test('upsert preserves the prior adjudication as history', () => {
  const first = { ccn: '010001', status: 'candidate', observed_at: '2026-09-15T00:00:00Z' };
  const second = { ccn: '010001', status: 'official', observed_at: '2026-09-15T01:00:00Z' };
  const document = upsert({ records: [first] }, second);
  assert.equal(document.records.length, 1);
  assert.equal(document.records[0].status, 'official');
  assert.equal(document.records[0].history[0].status, 'candidate');
});
