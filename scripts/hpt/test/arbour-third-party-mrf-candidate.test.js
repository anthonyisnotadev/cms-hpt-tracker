'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const read = name => JSON.parse(fs.readFileSync(path.join(audit, name), 'utf8'));
const proof = read('reconciliation-arbour-third-party-mrf-candidate-2026-09-30.json');
const manual = read('reconciliation-manual-access-observations.json').records.find(row => row.ccn === '224013');
const snapshot = read('nationwide-verification.json').records.find(row => row.ccn === '224013');
const reconciliation = read('nationwide-reconciliation.json').records.find(row => row.ccn === '224013');

assert.equal(proof.discovery_source.source_type, 'third-party-price-index');
assert.equal(proof.file_retrieval.content_length_bytes, 39834);
assert.match(proof.file_retrieval.sha256, /^[A-F0-9]{64}$/);
assert.equal(proof.declared_metadata.version, '3.0.0');
assert.equal(proof.structural_review.valid, true);
assert.equal(proof.structural_review.error_count, 0);
assert.equal(proof.structural_review.alert_count, 0);
assert.match(proof.source_chain_assessment, /not established/i);
assert.equal(proof.disposition_effect, 'none');
assert.equal(snapshot.disposition, 'pointer-access-denied-to-client');
assert.equal(snapshot.mrf_url, '', 'third-party candidate is not silently promoted into the nationwide file assignment');
assert.equal(manual.latest_third_party_candidate_recheck_2026_09_30.proof_file,
  'reconciliation-arbour-third-party-mrf-candidate-2026-09-30.json');
assert.equal(reconciliation.next_action, manual.latest_third_party_candidate_recheck_2026_09_30.next_action,
  'the current unresolved next action names the official linkage gate');
assert.match(reconciliation.next_action, /first-party Arbour\/UHS confirmation/i);

console.log('Arbour third-party candidate tests passed.');
