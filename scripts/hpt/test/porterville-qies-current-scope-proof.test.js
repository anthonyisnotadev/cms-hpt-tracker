'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('current Porterville QIES and state-license evidence narrows scope without exempting or resolving HPT', () => {
  const proof = require(path.join(audit, 'reconciliation-porterville-qies-pos-current-scope-proof-2026-09-29.json'));
  const manual = require(path.join(audit, 'reconciliation-manual-access-observations.json')).records
    .find(row => row.ccn === '050546');
  const cohort = require(path.join(audit, 'reconciliation-891-baseline-member-roster-2026-09-27.json'));

  assert.equal(proof.selected_fields.PRVDR_NUM, '050546');
  assert.equal(proof.selected_fields.PGM_TRMNTN_CD, '00');
  assert.equal(proof.selected_fields.ELGBLTY_SW, 'Y');
  assert.equal(proof.selected_fields.PSYCH_UNIT_SW, 'N');
  assert.equal(proof.official_state_sources.hcai_license_type, 'General Acute Care Hospital');
  assert.equal(proof.official_state_sources.hcai_facility_status, 'Open');
  assert.equal(proof.scope_reference.regulatory_disposition, 'no-supported-exemption-on-current-evidence');
  assert.equal(proof.cohort_unresolved_change, 0);
  assert.equal(manual.current_qies_scope_recheck.mrf_discovered, false);
  assert.equal(manual.current_qies_scope_recheck.scope_exception_supported, false);
  assert.ok(cohort.current_crosswalk_ccns['genuinely-unresolved'].includes('050546'));
  assert.equal(cohort.summary.baseline_unresolved_still_unresolved, 541);
});
