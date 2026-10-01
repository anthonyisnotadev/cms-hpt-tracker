'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const read = name => JSON.parse(fs.readFileSync(path.join(audit, name), 'utf8'));
const proof = read('reconciliation-centro-medico-noreste-third-party-source-link-trace-2026-09-29.json');
const manualData = read('reconciliation-manual-access-observations.json');
const manualRows = Array.isArray(manualData) ? manualData : Object.values(manualData).flat();
const manual = manualRows.find(row => row.ccn === '400141'
  && row.proof_file === 'reconciliation-centro-medico-noreste-qies-transition-proof-2026-09-29.json');
const queue = read('nationwide-reconciliation-queue.json').find(row => row.ccn === '400141');
const cohort = read('reconciliation-891-baseline-member-roster-2026-09-27.json');

test('third-party 400141 price claim is traced to the known sibling source file', () => {
  assert.equal(proof.ccn, '400141');
  assert.equal(proof.browser_observation.observed_destination, 'https://caribbeanmedicalcenter.com/wp-content/uploads/2026/01/660559417_Caribbean_Medical_Center_standarcharges1.csv');
  assert.equal(proof.known_file_sha256, '1e6cc38a1a32e634bdde757fd018f920a2cf1cfc1d74bbde58588e3a09a5c9ba');
  assert.equal(proof.known_file_identity.declared_license_number, '400131|PR');
  assert.equal(proof.cms_target_identity.facility_id, '400141');
  assert.match(proof.interpretation, /does not independently prove the third party derived all displayed prices/);
  assert.equal(proof.newness_accounting.new_mrf_bytes, false);
  assert.equal(proof.newness_accounting.disposition_changed, false);
  assert.equal(proof.newness_accounting.cohort_count_effect, 0);
});

test('the dated attribution lead is carried into the manual record and generated investigation queue', () => {
  assert.ok(manual);
  assert.ok(queue);
  const trace = manual.latest_third_party_source_link_trace_2026_09_29;
  assert.equal(trace.proof_file, 'reconciliation-centro-medico-noreste-third-party-source-link-trace-2026-09-29.json');
  assert.equal(queue.manual_access_observation.latest_third_party_source_link_trace_2026_09_29.proof_file, trace.proof_file);
  assert.equal(queue.proposed_disposition, 'pointer-facility-match-unresolved');
  assert.equal(cohort.baseline_unresolved_ccns.includes('400141'), true);
});
