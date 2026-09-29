'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));

test('UCSD Hillcrest retains bounded current page/file metadata without overclaiming full-file parsing', () => {
  const proof = read('data/hpt-audit/reconciliation-ucsd-hillcrest-current-page-file-proof-2026-09-26.json');
  const manual = read('data/hpt-audit/reconciliation-manual-access-observations.json').records
    .find(row => row.ccn === '050025');
  assert.equal(proof.ccn, '050025');
  assert.match(proof.publisher_file_url, /UC-San-Diego-Standard-Charges-956006144\.json/);
  assert.equal(proof.publisher_file_status, 206);
  assert.equal(proof.publisher_file_content_range, 'bytes 0-65535/3227761341');
  assert.equal(proof.declared_address.split('|')[0], '200 West Arbor Dr, San Diego, CA 92103');
  assert.equal(proof.cms_template_version, '3.0');
  assert.equal(proof.disposition, 'verified-template-review');
  assert.equal(manual.proof_file, 'reconciliation-ucsd-hillcrest-current-page-file-proof-2026-09-26.json');
  assert.match(manual.next_action, /literal version 3\.0/);
});
