'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('Arkansas State Hospital forensic status alone does not support a deemed-compliant scope exception', () => {
  const proof = JSON.parse(fs.readFileSync(path.join(audit,
    'reconciliation-arkansas-state-hospital-cms-state-forensic-scope-clarification-2026-09-28.json')));
  const manual = JSON.parse(fs.readFileSync(path.join(audit,
    'reconciliation-manual-access-observations.json'))).records.find(row => row.ccn === '044011');
  assert.equal(proof.ccn, '044011');
  assert.match(proof.sources.cms_hospital_price_transparency_faq.source_text, /exclusively to people in penal custody/);
  assert.match(proof.sources.arkansas_dhs_state_hospital_statistical_report_sfy_2023.source_text,
    /adult acute-care, forensic, and adolescent beds/);
  assert.equal(proof.existing_evidence_preserved.root_pointer_status, 404);
  assert.equal(proof.existing_evidence_preserved.workbook_is_cms_template_mrf, false);
  assert.match(proof.interpretation, /Do not infer a Hospital Price Transparency scope exemption/);
  assert.equal(proof.disposition_effect, 'none; retain unresolved pointer/MRF evidence gate and do not apply a state-forensic deemed-compliant classification');
  assert.match(manual.next_action, /Locate a current Arkansas State Hospital CMS-template CSV\/JSON MRF/);
  assert.doesNotMatch(manual.disposition, /scope-exempt/);
});
