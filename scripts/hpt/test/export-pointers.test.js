const test = require('node:test');
const assert = require('node:assert/strict');

const { sourceHash } = require('../../export-pointers');

test('pointer export provenance ignores platform line endings', () => {
  const lf = 'ccn,hospital_name\n000001,Example Hospital\n';
  const crlf = 'ccn,hospital_name\r\n000001,Example Hospital\r\n';

  assert.equal(sourceHash(lf), sourceHash(crlf));
});
