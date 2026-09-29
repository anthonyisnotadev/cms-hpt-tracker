'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parsePayload } = require('../lib/recovery-transport');
const { parsePointer } = require('../lib/parse');

const root = path.resolve(__dirname, '../../..');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

test('Henderson selected file has retained exact-campus bytes distinct from Houston sibling', async () => {
  const proofs = require(path.join(root, 'data/hpt-audit/nationwide-file-byte-proof.json')).records;
  const selected = proofs.find(row => row.url?.includes('421557533_Henderson-County-Community-Hospital'));
  const sibling = proofs.find(row => row.url?.includes('862345211_Houston-County-Community-Hospital'));
  assert.ok(selected && sibling);
  const sample = fs.readFileSync(path.join(root, selected.raw_artifact));
  assert.equal(sample.length, selected.bytes_retained);
  assert.equal(sha(sample), selected.sha256);
  const parsed = (await parsePayload(sample, selected.content_type)).parsed[0];
  assert.equal(parsed.mrfHospitalName, 'Henderson County Community Hospital');
  assert.equal(parsed.mrfAddress, '200 West Church St, Lexington, TN 38351');
  assert.equal(parsed.mrfLicenseState, 'TN');
  assert.equal(parsed.declaredLastUpdated, '2026-06-30');
  assert.equal(parsed.cmsVersion, '3.0.0');
  assert.notEqual(selected.sha256, sibling.sha256);
  const pointer = fs.readFileSync(path.join(root,
    'cms_data/hpt/pointer-corpus/raw/henderson.health-f41fcc8452d8.txt'));
  assert.ok(parsePointer(pointer.toString('utf8')).entries.some(entry => entry.mrfUrls?.includes(selected.url)));
});
