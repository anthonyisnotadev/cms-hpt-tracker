'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');

test('Jackson County current page XLSX is identity-matched but not silently promoted over the pointer CSV', () => {
  const proof = require(path.join(root, 'data/hpt-audit/reconciliation-jackson-county-current-xlsx-proof.json'));
  assert.equal(proof.ccn, '161329');
  assert.equal(proof.page_file_status, 200);
  assert.equal(proof.workbook_validation.header_metadata.version, '3.0.0');
  assert.equal(proof.workbook_validation.header_metadata.hospital_address, '601 HOSPITAL DRIVE, MAQUOKETA, IA 52060');
  assert.equal(proof.cms_enrollment.ccn, '161329');
  assert.equal(proof.pointer_boundary.pointer_file_not_promoted, true);
  assert.equal(proof.disposition, 'current-official-page-xlsx-identity-confirmed-pointer-version-mismatch-retained');
});
