'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isVersionedDocumentAlias, isCaseOnlyDocumentAlias, isClaimedSourceUrl } = require('../import-browser-file-byte-proof');

test('browser proof importer accepts only a same-origin numeric document revision', () => {
  const claim = 'https://www.example.org/home/showpublisheddocument/29234';
  assert.equal(isVersionedDocumentAlias(claim, `${claim}/639130559546500000`), true);
  assert.equal(isVersionedDocumentAlias(claim, `${claim}/latest.csv`), false);
  assert.equal(isVersionedDocumentAlias(claim, 'https://files.example.org/home/showpublisheddocument/29234/639130559546500000'), false);
  assert.equal(isVersionedDocumentAlias(claim, 'https://www.example.org/home/showpublisheddocument/292340/639130559546500000'), false);
});

test('an unnamed browser download requires the exact claim or approved revision alias', () => {
  const claim = 'https://www.example.org/files/hospital_standardcharges.csv';
  assert.equal(isClaimedSourceUrl(claim, claim), true);
  assert.equal(isClaimedSourceUrl(claim, `${claim}?download=1`), false);
  assert.equal(isClaimedSourceUrl(claim, 'https://www.example.org/files/other_standardcharges.csv'), false);
  assert.equal(isClaimedSourceUrl(claim, 'https://other.example.org/files/hospital_standardcharges.csv'), false);
});

test('a browser download may use only a same-origin case-only path alias', () => {
  const claim = 'https://example.org/documents/344477047_henry-county-hospital_standardcharges.csv';
  const caseAlias = 'https://example.org/documents/344477047_Henry-County-Hospital_standardcharges.csv';
  assert.equal(isCaseOnlyDocumentAlias(claim, caseAlias), true);
  assert.equal(isClaimedSourceUrl(claim, caseAlias), true);
  assert.equal(isCaseOnlyDocumentAlias(claim, 'https://other.example/documents/344477047_Henry-County-Hospital_standardcharges.csv'), false);
  assert.equal(isCaseOnlyDocumentAlias(claim, 'https://example.org/documents/344477047_Henry-County-Hospital_standardcharges.csv?download=1'), false);
  assert.equal(isCaseOnlyDocumentAlias(claim, 'https://example.org/documents/other.csv'), false);
});
