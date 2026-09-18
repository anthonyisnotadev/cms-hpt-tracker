'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const alias = require(path.join(audit, 'reconciliation-reviewed-alias-pointer-proof.json')).records.find(row => row.ccn === '140148');
const page = require(path.join(audit, 'reconciliation-memorial-springfield-page-proof.json'));
const ledger = require(path.join(audit, 'reviewed-resolutions.json'));

test('Springfield Memorial rename and file header match without hiding ZIP or page-date differences', () => {
  assert.equal(alias.pointer_location_name, 'Springfield Memorial Hospital');
  assert.equal(alias.roster_address, '701 N FIRST ST');
  assert.equal(alias.roster_zip, '62702');
  assert.equal(alias.declared_hospital_name, 'Memorial Medical Center dba Springfield Memorial Hospital');
  assert.equal(alias.declared_address, '701 N 1st Street');
  assert.equal(alias.declared_license_state, 'IL');
  assert.equal(alias.declared_date, '2026-02-10');
  assert.equal(alias.version, '3.0.0');
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, alias.retained_sample))).digest('hex'), alias.retained_sha256);
  assert.equal(page.pointer_file_sample_sha256, alias.retained_sha256);
  assert.equal(page.page_file_sample_sha256, alias.retained_sha256);
  assert.notEqual(page.first_party_page_displayed_update_date, page.file_declared_update_date);
  const resolution = ledger.find(row => row.ccn === '140148');
  assert.equal(resolution.action, 'replace');
  assert.match(resolution.note, /62781 while the roster says 62702/);
});
