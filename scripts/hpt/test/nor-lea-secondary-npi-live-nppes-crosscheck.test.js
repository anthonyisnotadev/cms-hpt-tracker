'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const readJson = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const proof = readJson('data/hpt-audit/reconciliation-nor-lea-secondary-npi-live-nppes-crosscheck-2026-09-28.json');
const manual = readJson('data/hpt-audit/reconciliation-manual-access-observations.json');
const worklist = readJson('data/hpt-audit/unresolved-investigation-worklist.json');

test('Nor-Lea secondary NPI evidence strengthens but does not erase the MRF address conflict', () => {
  assert.equal(proof.ccn, '321305');
  assert.equal(proof.source.npi, '1598899874');
  assert.equal(proof.source.http_status, 200);
  assert.equal(proof.source.response_bytes, 1429);
  assert.equal(proof.source.response_sha256, 'a725b8c24a383ff5a8410b228446e7979cfa5e26679c067a3f284acd5114d6b4');
  assert.equal(proof.source.organization_name, 'NOR-LEA HOSPITAL DISTRICT');
  assert.equal(proof.source.location_address, '1600 NORTH MAIN, LOVINGTON, NM 88260-2813');
  assert.equal(proof.source.record_last_updated, '2009-12-18');
  assert.equal(proof.mrf_comparison.mrf_declared_address, '1900 North Main Avenue, Lovington, NM 88260-2813');
  assert.equal(proof.disposition, 'address-conflict-strengthened-secondary-npi-record-stale-still-unresolved');
  assert.equal(proof.count_effect, 0);
  assert.equal(proof.new_mrf_bytes_retrieved, false);

  const record = manual.records.find(row => row.ccn === '321305');
  assert.equal(record.secondary_npi_live_nppes_crosscheck_2026_09_28.proof_file,
    'reconciliation-nor-lea-secondary-npi-live-nppes-crosscheck-2026-09-28.json');
  const queued = worklist.records.find(row => row.ccn === '321305');
  assert.equal(queued.current_disposition, 'linked-mrf-header-unmatched');
  assert.match(queued.next_action, /1900 North Main/);
});
