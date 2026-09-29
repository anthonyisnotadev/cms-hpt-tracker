'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isCredentialUrl, protectPublicUrls } = require('../lib/public-url-safety');

test('public payload withholds signed file links without changing source evidence', () => {
  const signed = 'https://files.test/file.csv?sv=1&sig=private-value';
  const source = { rows: [[signed, 'https://hospital.test/cms-hpt.txt']],
    history: { note: `Downloaded ${signed}. See https://hospital.test/pricing` } };
  const safe = protectPublicUrls(source);
  assert.equal(isCredentialUrl(signed), true);
  assert.equal(safe.rows[0][0], '');
  assert.equal(safe.rows[0][1], 'https://hospital.test/cms-hpt.txt');
  assert.equal(safe.history.note, 'Downloaded [signed URL withheld]. See https://hospital.test/pricing');
  assert.equal(source.rows[0][0], signed);
  assert.equal(isCredentialUrl('https://files.test/file.csv?ordinary=1'), false);
  assert.equal(isCredentialUrl('https://files.test/file.csv?X-Amz-Signature=private'), true);
});
