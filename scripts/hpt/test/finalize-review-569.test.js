'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { baseDigest, findPointerProof } = require('../finalize-review-569');

const sha = value => crypto.createHash('sha256').update(value).digest('hex');

test('review-569 base guard is stable across object property order', () => {
  assert.equal(baseDigest({ ccn: '1', finding: 'x', nested: { b: 2, a: 1 } }),
    baseDigest({ nested: { a: 1, b: 2 }, finding: 'x', ccn: '1' }));
});

test('finalizer requires a hash-checked exact official pointer entry', () => {
  const body = [
    'location-name: Example Hospital',
    'source-page-url: https://example.org/prices',
    'mrf-url: https://example.org/file.csv'
  ].join('\n');
  const mrf = { ccn: '000001', entry: { pointer_url: 'https://example.org/cms-hpt.txt',
    location_name: 'Example Hospital', mrf_url: 'https://example.org/file.csv' } };
  const official = { attempts: [{ url: mrf.entry.pointer_url, usable: true, http_status: 200,
    body, body_sha256: sha(body) }] };
  assert.equal(findPointerProof(mrf, official).entry.mrf_url, mrf.entry.mrf_url);
  official.attempts[0].body_sha256 = sha('different');
  assert.throws(() => findPointerProof(mrf, official), /hash mismatch/);
});

