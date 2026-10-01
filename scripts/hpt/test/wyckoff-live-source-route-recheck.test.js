'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('Wyckoff current official route failures remain discovery evidence, not an MRF disposition', () => {
  const proof = JSON.parse(fs.readFileSync(path.join(audit,
    'reconciliation-wyckoff-live-source-route-recheck-2026-09-29.json'), 'utf8'));
  const worklist = JSON.parse(fs.readFileSync(path.join(audit, 'unresolved-investigation-worklist.json'), 'utf8'));
  const nationwide = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-verification.json'), 'utf8'));
  const plan = fs.readFileSync(path.join(audit, 'accuracy-plan.md'), 'utf8');

  assert.equal(proof.ccn, '330221');
  assert.equal(proof.vendor_route.file_bytes_received, false);
  assert.equal(proof.cms_root_pointer.http_status, 404);
  assert.equal(proof.cms_root_pointer.usable_pointer_fields, false);
  assert.equal(proof.newness_accounting.new_hospital_mrf_bytes, 0);
  assert.equal(proof.newness_accounting.disposition_change, false);
  assert.equal(proof.newness_accounting['891_unresolved_count_change'], 0);
  assert.equal(nationwide.records.find(row => row.ccn === proof.ccn).disposition, 'pointer-discovery-incomplete');
  assert.ok(worklist.records.some(row => row.ccn === proof.ccn));
  assert.match(plan, /Wyckoff Heights Medical Center \(330221\), live route check/);
  assert.match(plan, /Shoshone search lead \(131314\) reconciliation/);
});
