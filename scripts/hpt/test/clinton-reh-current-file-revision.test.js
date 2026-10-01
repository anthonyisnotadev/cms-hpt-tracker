'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = require(path.join(audit, 'reconciliation-clinton-reh-current-mrf-revision-proof-2026-09-29.json'));
const previous = require(path.join(audit, 'reconciliation-clinton-reh-transition-proof.json'));
const manual = require(path.join(audit, 'reconciliation-manual-access-observations.json')).records;
const resolutions = require(path.join(audit, 'reviewed-resolutions.json'));
const cohort = require(path.join(audit, 'reconciliation-891-baseline-member-roster-2026-09-27.json'));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

test('changed Clinton REH MRF is retained for successor CCN only and does not resolve former CCN', () => {
  assert.equal(proof.ccn, '370784');
  assert.equal(proof.current_scope, 'Current rural emergency hospital CCN 370784 only; not historical acute-care CCN 370245.');
  assert.equal(proof.root_pointer_sha256, previous.pointer_sha256);
  assert.equal(proof.root_pointer_entry_without_contacts.length, 3);
  assert.equal(proof.root_pointer_entry_without_contacts[2], `mrf-url: ${proof.mrf_url}`);
  assert.equal(proof.cms_enrollment_sha256, previous.cms_current_enrollment_response_sha256);
  assert.equal(proof.cms_current_enrollment.ccn, '370784');
  assert.equal(proof.cms_current_enrollment.former_hospital_ccn, '370245');
  assert.equal(proof.cms_current_enrollment.reh_conversion_date, '2025-12-02');

  assert.equal(proof.previous_revision.bytes, 3871397);
  assert.equal(proof.previous_revision.sha256, 'd00b4865ffb24203334c32a55f25742d25a67e06f93d686d8876d8d12209ff06');
  assert.equal(proof.current_revision.bytes, 5496900);
  assert.equal(proof.current_revision.sha256, 'd254c5499608cc6da36079958c1364845c817d480fa62a35b88f8c6a82e8b404');
  assert.equal(proof.current_revision.declared_date, '2026-07-28');
  assert.equal(proof.current_revision.version, '3.0.0');
  assert.equal(proof.current_revision.charge_entries, 5089);
  assert.equal(proof.comparison.bytes_delta, 1625503);
  assert.equal(proof.comparison.charge_entry_delta, 328);
  assert.equal(proof.comparison.declared_date_changed, false);

  const rawPath = path.resolve(root, proof.current_revision.raw_artifact);
  assert.ok(rawPath.startsWith(path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof') + path.sep));
  const raw = fs.readFileSync(rawPath);
  assert.equal(raw.length, proof.current_revision.bytes);
  assert.equal(hash(raw), proof.current_revision.sha256);
  const mrf = JSON.parse(raw.toString('utf8'));
  assert.equal(mrf.hospital_name, 'Clinton Regional Hospital');
  assert.equal(mrf.hospital_address[0], '100 North 30th Street, Clinton, OK 73601');
  assert.equal(mrf.license_information.state, 'OK');
  assert.equal(mrf.type_2_npi[0], proof.cms_current_enrollment.npi);
  assert.equal(mrf.standard_charge_information.length, 5089);

  const former = manual.find(row => row.ccn === '370245');
  const current = manual.find(row => row.ccn === '370784');
  assert.match(former.next_action, /do not assign the current REH file to 370245/i);
  assert.equal(current.latest_complete_file_revision.sha256, proof.current_revision.sha256);
  assert.equal(current.latest_complete_file_revision.previous_sha256, previous.file_sha256);
  assert.equal(resolutions.find(row => row.ccn === '370784').evidence.fileSha256, proof.current_revision.sha256);
  assert.equal(resolutions.some(row => row.ccn === '370245'), false);

  assert.ok(cohort.current_crosswalk_ccns['genuinely-unresolved'].includes('370245'));
  assert.ok(!cohort.current_crosswalk_ccns['genuinely-unresolved'].includes('370784'));
  assert.equal(cohort.summary.current_effective_categories['genuinely-unresolved'], 541);
});
