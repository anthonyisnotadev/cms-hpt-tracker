'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const auditDir = path.resolve(__dirname, '../../../data/hpt-audit');
const readJson = file => JSON.parse(fs.readFileSync(path.join(auditDir, file), 'utf8'));
const proof = readJson('reconciliation-foundation-surgical-site-address-crosswalk-2026-09-27.json');
const manual = readJson('reconciliation-manual-access-observations.json');
const verification = readJson('nationwide-verification.json');
const fullFile = readJson('reconciliation-foundation-surgical-full-file-recheck-proof-2026-09-25.json');

test('Foundation site address is cross-attributed to the distinct CCN 670112 without reassigning either file', () => {
  assert.equal(proof.ccn, '670054');
  assert.equal(proof.ccn_670054.cms_hospital_enrollments_dataset_id, proof.ccn_670112.cms_hospital_enrollments_dataset_id);
  assert.equal(proof.ccn_670054.npi, '1932284411');
  assert.equal(proof.ccn_670054.full_mrf_metadata.address, '9522 Huebner Rd, San Antonio, TX 78240');
  assert.equal(proof.ccn_670112.cms_enrollment_row.npi, '1568848059');
  assert.equal(proof.ccn_670112.cms_enrollment_row.address, '5330 NORTH LOOP 1604 W, SAN ANTONIO, TX 78249-4383');
  assert.equal(proof.ccn_670112.existing_current_mrf_source.current_disposition, 'verified-current-mrf');
  assert.equal(proof.ccn_670112.existing_current_mrf_source.mrf_npi, '1568848059');
  assert.equal(proof.disposition, 'official-page-address-conflict-narrowed-by-distinct-ccn-crosswalk-retained');
  assert.equal(proof.count_effect, 'none; retain CCN 670054 as unresolved pending publisher confirmation of the Foundation site address and practice-location scope');

  const foundation = verification.records.find(row => row.ccn === '670054');
  const sibling = verification.records.find(row => row.ccn === '670112');
  assert.equal(fullFile.mrf_url, proof.ccn_670054.full_mrf_url);
  assert.equal(fullFile.declared_metadata.type_2_npi[0], '1932284411');
  assert.match(sibling.declared_address, /5330 N Loop 1604 W/);
  assert.equal(sibling.mrf_url, proof.ccn_670112.existing_current_mrf_source.mrf_url);

  const record = manual.records.find(row => row.ccn === '670054');
  assert.equal(record.latest_sibling_ccn_address_crosswalk_2026_09_27.proof_file,
    'reconciliation-foundation-surgical-site-address-crosswalk-2026-09-27.json');
  assert.match(record.next_action, /Obtain publisher clarification or correction/);
});
