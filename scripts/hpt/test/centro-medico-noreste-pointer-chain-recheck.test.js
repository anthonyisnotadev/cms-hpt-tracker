'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const auditDir = path.join(root, 'data/hpt-audit');
const proofPath = path.join(auditDir, 'reconciliation-centro-medico-noreste-pointer-chain-recheck-2026-09-27.json');
const directoryProofPath = path.join(auditDir, 'reconciliation-centro-medico-noreste-firstmedical-april-2026-directory-recheck-2026-09-28.json');
const manualPath = path.join(auditDir, 'reconciliation-manual-access-observations.json');
const proof = JSON.parse(fs.readFileSync(proofPath, 'utf8'));
const manualRows = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
const manual = (Array.isArray(manualRows) ? manualRows : Object.values(manualRows).flat())
  .find(row => row.ccn === '400141');

test('current Centro Médico del Noreste root-pointer evidence is hash-bound to the excluded sibling route', () => {
  assert.equal(proof.ccn, '400141');
  assert.equal(proof.http_status, 200);
  assert.equal(proof.response_bytes, 317);
  assert.match(proof.response_sha256, /^[a-f0-9]{64}$/);
  assert.equal(proof.sanitized_pointer_fields.location_name, 'Caribbean Medical Center');
  assert.equal(proof.sanitized_pointer_fields.mrf_url,
    'https://caribbeanmedicalcenter.com/wp-content/uploads/2026/01/660559417_Caribbean_Medical_Center_standarcharges1.csv');
  assert.equal(proof.www_alias.same_body, true);
  assert.equal(proof.sibling_file_crosscheck.proof_file,
    'reconciliation-centro-medico-noreste-full-file-sibling-proof-2026-09-26.json');
  assert.equal(proof.disposition, 'unresolved-sibling-pointer-and-file-excluded');
  assert.doesNotMatch(JSON.stringify(proof), /luis\.torres|@caribbeanmedicalcenter\.com/i);
  assert.ok(manual, 'manual access row for exact CCN 400141 exists');
  assert.equal(manual.latest_root_pointer_chain_recheck_2026_09_27.response_sha256, proof.response_sha256);
  assert.match(manual.next_action, /Do not repeat the generic root pointer or confirmed sibling CSV/);
});

test('April 2026 payer directory corroborates separate Fajardo facilities without assigning a file or reducing unresolved count', () => {
  const directory = JSON.parse(fs.readFileSync(directoryProofPath, 'utf8'));
  assert.equal(directory.ccn, '400141');
  assert.equal(directory.source.listed_page_number, 114);
  assert.equal(directory.entries.find(entry => entry.name === 'CENTRO MÉDICO DEL NORESTE').address,
    'Ave General Valero 404, Fajardo, PR');
  assert.equal(directory.entries.find(entry => entry.name === 'CARIBBEAN MEDICAL CENTER').address,
    'Ave Osvaldo Molina 151, Fajardo, PR');
  assert.equal(directory.count_effect, 0);
  assert.equal(directory.disposition, 'unresolved-sibling-file-excluded');
  assert.deepEqual(directory.evidence_classification.not_gained, [
    'No Centro Médico del Noreste CMS pointer or MRF bytes',
    'No CCN-to-payer-directory explicit mapping',
    'No publisher clarification of the shared first-party site and pricing page',
  ]);
});
