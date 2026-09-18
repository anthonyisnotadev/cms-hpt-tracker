'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('Physicians Medical Center browser file is retained as historical, not current pointer proof', () => {
  const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-physicians-houma-browser-file-proof.json'), 'utf8'));
  const bytes = fs.readFileSync(path.join(root, proof.retained_file));
  const manual = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-manual-access-observations.json'), 'utf8'))
    .records.find(row => row.ccn === '190241');
  assert.equal(bytes.length, proof.retained_file_bytes);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), proof.retained_file_sha256);
  assert.match(bytes.subarray(0, 100).toString(), /^Updated as of 3\/9\/2023/);
  assert.match(proof.browser_pointer_result, /ERR_BLOCKED_BY_CLIENT/);
  assert.equal(manual.page_file_sha256, proof.retained_file_sha256);
  assert.match(manual.next_action, /do not promote the 2023 CSV/i);
});
