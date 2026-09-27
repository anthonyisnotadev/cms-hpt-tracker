const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const audit = path.join(__dirname, '..', '..', '..', 'data', 'hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-uci-shared-orange-address-metadata-cohort-2026-09-27.json'), 'utf8'));

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
