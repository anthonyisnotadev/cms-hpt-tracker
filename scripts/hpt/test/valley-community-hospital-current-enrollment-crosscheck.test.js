'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('current CMS enrollment evidence narrows Valley Community status without resolving HPT publication', () => {
  const proof = JSON.parse(fs.readFileSync(path.join(audit,
    'reconciliation-valley-community-hospital-closure-scope-proof-2026-09-23.json'), 'utf8'));
  const august = JSON.parse(fs.readFileSync(path.join(audit,
    'reconciliation-valley-community-hospital-august-enrollment-recheck-2026-09-29.json'), 'utf8'));
  const record = proof.cms_current_enrollment_recheck_2026_09_29;
  const manual = JSON.parse(fs.readFileSync(path.join(audit,
    'reconciliation-manual-access-observations.json'), 'utf8')).records.find(row => row.ccn === '370243');

  assert.equal(record.dataset_release, 'May 2026');
  assert.equal(record.http_status, 200);
  assert.equal(record.response_bytes, 1230);
  assert.equal(record.response_sha256, 'd8409fb8cfd8284563c57bf47e9a0ddad4d4634e949609d940ac054b1fa15246');
  assert.equal(record.exact_result_count, 1);
  assert.equal(record.selected_fields.CCN, '370243');
  assert.equal(record.selected_fields.NPI, '1053997338');
  assert.equal(record.selected_fields['ORGANIZATION NAME'], 'SOUTHERN PLAINS MEDICAL CENTER OF GARVIN COUNTY LLC');
  assert.equal(record.selected_fields['DOING BUSINESS AS NAME'], 'VALLEY COMMUNITY HOSPITAL');
  assert.equal(record.selected_fields['SUBGROUP - SWING-BED APPROVED'], 'Y');
  assert.equal(record.disposition_changed, false);
  assert.match(record.next_action, /publisher-confirmed current official domain/i);
  assert.match(record.interpretation, /does not establish status after the release cutoff/i);
  assert.ok(manual);
  assert.equal(manual.cms_current_enrollment_recheck_2026_09_29.response_sha256, record.response_sha256);
  const latest = manual.latest_august_enrollment_csv_recheck_2026_09_29;
  assert.equal(latest.proof_file, 'reconciliation-valley-community-hospital-august-enrollment-recheck-2026-09-29.json');
  assert.equal(latest.csv_sha256, august.source.sha256);
  assert.equal(latest.csv_bytes, 2516958);
  assert.equal(latest.exact_ccn_rows, 1);
  assert.equal(latest.file_date, '2026-07-31');
  assert.equal(latest.npi, '1053997338');
  assert.equal(latest.disposition_changed, false);
  assert.equal(august.match.organization_name, 'SOUTHERN PLAINS MEDICAL CENTER OF GARVIN COUNTY LLC');
  assert.equal(august.match.doing_business_as_name, 'VALLEY COMMUNITY HOSPITAL');
  assert.match(august.interpretation, /does not establish that hospital services were operating on every date/i);
  assert.equal(manual.disposition, 'official-website-not-identified-closure-scope-conflict');
});
