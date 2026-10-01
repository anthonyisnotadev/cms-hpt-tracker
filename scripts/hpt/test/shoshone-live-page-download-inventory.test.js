'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit,
  'reconciliation-shoshone-live-page-download-inventory-2026-09-28.json'), 'utf8'));
const ledger = JSON.parse(fs.readFileSync(path.join(audit,
  'reconciliation-manual-access-observations.json'), 'utf8'));
const worklist = JSON.parse(fs.readFileSync(path.join(audit,
  'unresolved-investigation-worklist.json'), 'utf8'));
const row = ledger.records.find(record => record.ccn === proof.ccn);
const queued = worklist.records.find(record => record.ccn === proof.ccn);
const plan = fs.readFileSync(path.join(audit, 'accuracy-plan.md'), 'utf8');

assert.equal(proof.ccn, '131314');
assert.equal(proof.live_browser_observation.machine_readable_link_url,
  'https://www.shoshonehealth.com/wp-content/uploads/2019/12/2020-Charge-Master.csv');
assert.equal(proof.live_browser_observation.separate_current_cms_csv_json_zip_link_exposed, false);
assert.equal(proof.browser_recheck_2026_09_29.separate_current_cms_csv_json_zip_link_exposed, false);
assert.equal(proof.browser_recheck_2026_09_29.root_pointer_browser_attempt.browser_result, 'net::ERR_BLOCKED_BY_CLIENT');
assert.match(proof.browser_recheck_2026_09_29.root_pointer_browser_attempt.interpretation, /not evidence that the pointer changed or is absent/);
assert.match(proof.finding, /prior direct HTTP 200 pointer capture remains authoritative/);
assert.equal(proof.previously_retained_file_facts.new_file_bytes_recovered, false);
assert.equal(proof.latest_third_party_raw_file_and_hpi_fallback_check_2026_09_30.linked_raw_file_http_status, 404);
assert.match(proof.latest_third_party_raw_file_and_hpi_fallback_check_2026_09_30.linked_raw_file_url,
  /826003924-1043215437_west-shoshone-hospital-district-1_standardcharges\.csv$/);
assert.equal(proof.latest_third_party_raw_file_and_hpi_fallback_check_2026_09_30.publisher_hpi_fallback_browser_final_url,
  'https://search.hospitalpriceindex.com/facility-not-found');
assert.equal(proof.latest_third_party_raw_file_and_hpi_fallback_check_2026_09_30.mrf_bytes_recovered, false);
assert.equal(proof.disposition_effect, 'none');
assert.equal(proof.count_effect, 'none');
assert.match(proof.interpretation, /proof that no MRF is available/i);
assert.ok(row.latest_live_page_download_inventory_2026_09_28);
assert.equal(row.latest_third_party_raw_file_and_hpi_fallback_check_2026_09_30.observed_at,
  proof.latest_third_party_raw_file_and_hpi_fallback_check_2026_09_30.observed_at);
assert.match(row.next_action, /do not repeat the exact ShowTheBill blob URL or HPI machineReadable route/i);
assert.match(row.next_action, /CMS 3\.0\.0/);
assert.equal(queued.current_disposition, 'mrf-request-unsuccessful');
assert.match(queued.next_action,
  /https:\/\/search\.hospitalpriceindex\.com\/hpi2\/machineReadable\/ShoshoneMedicalCenter\/7852/);
assert.match(queued.next_action,
  /https:\/\/sthpiprd\.blob\.core\.windows\.net\/machine-readable-files\/7852\/826003924-1043215437_west-shoshone-hospital-district-1_standardcharges\.csv/);
assert.match(queued.next_action, /CMS 3\.0\.0/);
assert.match(row.latest_live_page_download_inventory_2026_09_28.next_action,
  /materially new publisher-managed route/i);
assert.match(plan, /Shoshone live-page download inventory/);
assert.match(plan, /disposition and count effect \*\*0\*\*/);

console.log('Shoshone live-page download inventory tests passed.');
