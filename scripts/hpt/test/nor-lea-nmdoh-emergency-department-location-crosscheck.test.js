'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const readJson = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const proof = readJson('data/hpt-audit/reconciliation-nor-lea-nmdoh-emergency-department-location-crosscheck-2026-09-29.json');
const manual = readJson('data/hpt-audit/reconciliation-manual-access-observations.json');
const worklist = readJson('data/hpt-audit/unresolved-investigation-worklist.json');

test('Nor-Lea NMDOH emergency-department address corroboration does not resolve the MRF conflict', () => {
  assert.equal(proof.ccn, '321305');
  assert.equal(proof.source.agency, 'New Mexico Department of Health');
  assert.equal(proof.source.publication_date, '2025-02-11');
  assert.match(proof.source.observation, /Emergency Department at 1600 Main Street/);
  assert.equal(proof.comparison.pointer_linked_mrf_address_literal,
    '1900 North Main Avenue, Lovington, NM 88260-2813');
  assert.equal(proof.comparison.pointer_linked_mrf_sha256,
    '549aeebd73a2ec8cb6ba28c75e1af7b31380db81b6597d042c8b0a821dcc151e');
  assert.equal(proof.disposition, 'address-conflict-reinforced-still-unresolved');
  assert.equal(proof.count_effect, 0);
  assert.equal(proof.new_mrf_bytes_retrieved, false);

  const record = manual.records.find(row => row.ccn === '321305');
  assert.equal(record.nmdoh_emergency_department_location_crosscheck_2026_09_29.proof_file,
    'reconciliation-nor-lea-nmdoh-emergency-department-location-crosscheck-2026-09-29.json');
  const queued = worklist.records.find(row => row.ccn === '321305');
  assert.equal(queued.current_disposition, 'linked-mrf-header-unmatched');
  assert.match(queued.next_action, /1900 North Main/);
});
