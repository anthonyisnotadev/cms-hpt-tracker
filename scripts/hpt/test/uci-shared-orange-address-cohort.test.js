const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const audit = path.join(__dirname, '..', '..', '..', 'data', 'hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-uci-shared-orange-address-metadata-cohort-2026-09-27.json'), 'utf8'));

const currentAddressCrosscheck = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-uci-lakewood-cms-reporting-cycle-address-crosscheck-2026-09-28.json'), 'utf8'));
const currentRecheck = currentAddressCrosscheck.current_recheck_2026_09_28;
assert.equal(currentAddressCrosscheck.ccn, '050581');
assert.equal(currentRecheck.current_pricing_page_http_status, 200);
assert.equal(currentRecheck.page_still_lists_exact_lakewood_filename, true);
assert.equal(currentRecheck.http_status, 206);
assert.equal(currentRecheck.content_range, 'bytes 0-131071/67053227');
assert.equal(currentRecheck.sample_sha256, currentAddressCrosscheck.retained_mrf_basis.sample_sha256);
assert.equal(currentRecheck.header.hospital_address[0], '101 City Drive South, Orange, CA 92868');
assert.equal(currentRecheck.official_hcai_lakewood_address, '3700 South Street, Lakewood, CA 90712');
assert.equal(currentRecheck.official_hcai_orange_address, currentRecheck.header.hospital_address[0]);
assert.equal(currentAddressCrosscheck.disposition, 'official-identity-corroboration-address-field-conflict-retained-unresolved');
assert.match(currentAddressCrosscheck.next_action, /publisher correction or explanation specifically for the Lakewood JSON hospital_address field/);

assert.equal(proof.latest_exact_file_bounded_rechecks_2026_09_27.length, 3);
assert.deepEqual(
  proof.latest_exact_file_bounded_rechecks_2026_09_27.map(row => row.ccn),
  ['050570', '050551', '050581'],
);
for (const row of proof.latest_exact_file_bounded_rechecks_2026_09_27) {
  assert.equal(row.http_status, 206);
  assert.equal(row.sample_bytes, 131072);
  assert.match(row.sample_sha256, /^[a-f0-9]{64}$/);
  assert.equal(row.declared_hospital_name, row.declared_location_name);
  assert.equal(row.declared_hospital_address, '101 City Drive South, Orange, CA 92868');
  assert.equal(row.declared_last_updated, '2026-04-01');
  assert.equal(row.cms_template_version, '3.0.0');
}
assert.equal(proof.disposition, 'shared-publisher-address-field-conflict-unresolved-no-reassignment');
assert.match(proof.next_action, /corrected MRF or dated publisher clarification/);
assert.match(proof.live_source_verification_2026_09_27.cms_json_dictionary_observation, /physical addresses corresponding/);
assert.match(proof.live_source_verification_2026_09_27.cms_faq_observation, /same order/);
assert.match(proof.live_source_verification_2026_09_27.uci_lakewood_facility_page_observation, /3700 E\. South St\., Lakewood, CA 90712/);
assert.match(proof.live_source_verification_2026_09_27.web_tool_limitations, /full JSON/);

console.log('UCI shared Orange-address cohort evidence validated; no reassignment or resolution is encoded.');

const nppes = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-uci-lakewood-official-nppes-crosscheck-2026-09-28.json'), 'utf8'));
const manual = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-manual-access-observations.json'), 'utf8'))
  .records.find(row => row.ccn === '050581');
assert.equal(nppes.source.url, 'https://npiregistry.cms.hhs.gov/api/?number=1184655581&version=2.1');
assert.equal(nppes.source.http_status, 200);
assert.match(nppes.source.response_sha256, /^[a-f0-9]{64}$/);
assert.equal(nppes.npi.location_address, '3700 SOUTH ST, LAKEWOOD, CA 90712-1419');
assert.equal(nppes.npi.taxonomy_license_number, '930000046');
assert.equal(nppes.npi.taxonomy_license_state, 'CA');
assert.equal(nppes.crosscheck.pointer_declared_file_npi_matches_registry_record, true);
assert.match(nppes.crosscheck.remaining_conflict, /Orange UCI Medical Center address/);
assert.equal(nppes.crosscheck.disposition_effect, 'none; preserve 050581 as unresolved for the facility-address metadata conflict');
assert.equal(manual.latest_official_nppes_crosscheck_2026_09_28.proof_file,
  'reconciliation-uci-lakewood-official-nppes-crosscheck-2026-09-28.json');
assert.equal(manual.latest_official_nppes_crosscheck_2026_09_28.count_effect,
  'none; keep CCN 050581 unresolved pending a corrected hospital_address or publisher explanation');

const nppesCrosschecks = proof.latest_official_nppes_crosschecks_2026_09_28;
assert.deepEqual(nppesCrosschecks.map(row => row.ccn), ['050570', '050551', '050581']);
assert.deepEqual(nppesCrosschecks.map(row => row.location_address), [
  '17100 EUCLID ST, FOUNTAIN VALLEY, CA 92708-4004',
  '3751 KATELLA AVE, LOS ALAMITOS, CA 90720-3101',
  '3700 SOUTH ST, LAKEWOOD, CA 90712-1419',
]);
for (const row of nppesCrosschecks) {
  assert.equal(row.http_status, 200);
  assert.equal(row.registry_status, 'A');
  assert.equal(row.taxonomy_license_state, 'CA');
  assert.match(row.response_sha256, /^[a-f0-9]{64}$/);
  assert.match(row.registry_last_updated, /^2024-/);
}
assert.equal(nppesCrosschecks[0].taxonomy_license_number, '06000109');
assert.equal(nppesCrosschecks[1].taxonomy_license_number, '060000142');
assert.equal(nppesCrosschecks[2].taxonomy_license_number, '930000046');
assert.equal(nppesCrosschecks[2].mrf_declared_npi_match, true);
assert.match(proof.interpretation, /do not reconcile the files' Orange hospital_address value/);

const cmsCrosscheck = JSON.parse(fs.readFileSync(path.join(audit,
  'reconciliation-uci-lakewood-cms-reporting-cycle-address-crosscheck-2026-09-28.json'), 'utf8'));
const licenseTransition = JSON.parse(fs.readFileSync(path.join(audit,
  'reconciliation-uci-lakewood-california-license-transition-2026-09-29.json'), 'utf8'));
assert.equal(cmsCrosscheck.ccn, '050581');
assert.equal(cmsCrosscheck.disposition, 'official-identity-corroboration-address-field-conflict-retained-unresolved');
assert.match(cmsCrosscheck.sources[2].observation, /provider number 050581.*3700 E\. South St\./);
assert.equal(cmsCrosscheck.retained_mrf_basis.declared_hospital_address, '101 City Drive South, Orange, CA 92868');
assert.match(cmsCrosscheck.finding, /The MRF hospital_address conflict remains/);
assert.equal(licenseTransition.ccn, '050581');
assert.equal(licenseTransition.sources[0].recent_history[0].license, '930000046');
assert.equal(licenseTransition.sources[0].recent_history[0].expires, '2026-03-06');
assert.equal(licenseTransition.sources[1].recent_history[0].license, '060000148');
assert.equal(licenseTransition.sources[1].recent_history[0].effective, '2026-03-07');
assert.equal(licenseTransition.sources[3].observed_mrf_metadata.license_number, '060000148');
assert.equal(licenseTransition.disposition_changed, false);
assert.match(licenseTransition.interpretation, /must not be treated as an Orange-only identifier/);
assert.match(cmsCrosscheck.license_transition_follow_up_2026_09_29.finding, /is supported for Lakewood/);
assert.match(cmsCrosscheck.next_action, /specifically for the Lakewood JSON hospital_address field/);
