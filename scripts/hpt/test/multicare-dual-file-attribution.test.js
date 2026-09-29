'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { csvToObjects } = require('../lib/util');
const { applyMulticareDualFileAttribution } = require('../pointer-corpus');

const root = path.resolve(__dirname, '../../..');
const proof = JSON.parse(fs.readFileSync(path.join(root,
  'data/hpt-audit/reconciliation-multicare-tacoma-allenmore-dual-file-proof.json'), 'utf8'));

test('current MultiCare pointer attributes Allenmore as an additional file only', () => {
  for (const file of [proof.allenmore, proof.tacoma]) {
    const bytes = fs.readFileSync(path.join(root, file.retained_sample));
    assert.equal(bytes.length, file.sample_bytes);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), file.sample_sha256);
  }
  const rows = csvToObjects(fs.readFileSync(path.join(root,
    'cms_data/hpt/pointer-corpus/cms_hpt_entries.csv'), 'utf8'));
  const without = rows.map(row => ({ ...row }));
  const target = without.find(row => row.pointer_url === proof.pointer_url
    && row.pointer_sha256 === proof.pointer_sha256 && row.mrf_url === proof.allenmore.mrf_url);
  assert.ok(target);
  target.matched_ccns = '';
  const result = applyMulticareDualFileAttribution(without, proof);
  const changed = result.filter((row, index) => row.matched_ccns !== without[index].matched_ccns);
  assert.equal(changed.length, 1);
  assert.equal(changed[0].mrf_url, proof.allenmore.mrf_url);
  assert.equal(changed[0].matched_ccns, '500129');
  assert.equal(rows.find(row => row.mrf_url === proof.allenmore.mrf_url
    && row.pointer_sha256 === proof.pointer_sha256).matched_ccns, '500129');
  assert.throws(() => applyMulticareDualFileAttribution(without,
    { ...proof, pointer_sha256: '0'.repeat(64) }), /proof changed/);
});
