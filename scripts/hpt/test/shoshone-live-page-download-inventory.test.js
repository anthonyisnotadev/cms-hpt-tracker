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
const row = ledger.records.find(record => record.ccn === proof.ccn);
const plan = fs.readFileSync(path.join(audit, 'accuracy-plan.md'), 'utf8');

assert.equal(proof.ccn, '131314');
assert.equal(proof.live_browser_observation.machine_readable_link_url,
  'https://www.shoshonehealth.com/wp-content/uploads/2019/12/2020-Charge-Master.csv');
assert.equal(proof.live_browser_observation.separate_current_cms_csv_json_zip_link_exposed, false);
assert.equal(proof.previously_retained_file_facts.new_file_bytes_recovered, false);
assert.equal(proof.disposition_effect, 'none');
assert.equal(proof.count_effect, 'none');
assert.match(proof.interpretation, /does not prove that no MRF is available/i);
assert.ok(row.latest_live_page_download_inventory_2026_09_28);
assert.match(row.latest_live_page_download_inventory_2026_09_28.next_action,
  /materially new publisher-managed route/i);
assert.match(plan, /Shoshone live-page download inventory/);
assert.match(plan, /disposition and count effect \*\*0\*\*/);

console.log('Shoshone live-page download inventory tests passed.');
