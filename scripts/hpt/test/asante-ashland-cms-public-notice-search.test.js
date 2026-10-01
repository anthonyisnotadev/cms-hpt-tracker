'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit,
  'reconciliation-asante-ashland-cms-public-notice-search-2026-09-28.json'), 'utf8'));
const manual = JSON.parse(fs.readFileSync(path.join(audit,
  'reconciliation-manual-access-observations.json'), 'utf8'));
const row = manual.records.find(record => record.ccn === proof.ccn);
const plan = fs.readFileSync(path.join(audit, 'accuracy-plan.md'), 'utf8');

assert.equal(proof.ccn, '380005');
assert.equal(proof.browser_searches.length, 2);
assert.ok(proof.browser_searches.every(search => search.result_count === 0));
assert.equal(proof.source.dynamic_table_entries_before_filter, 321);
assert.equal(proof.mrf_bytes_recovered, false);
assert.equal(proof.disposition_effect, 'none');
assert.equal(proof.count_effect, 'none');
assert.match(proof.interpretation, /does not establish continued active Medicare enrollment, termination, or transfer/i);
assert.ok(row.latest_cms_public_notice_search_2026_09_28);
assert.match(row.latest_cms_public_notice_search_2026_09_28.next_action, /effective-dated CMS\/MAC status evidence/i);
assert.match(plan, /Asante Ashland CMS public-notice search/);
assert.match(plan, /No disposition, 891 cohort count, or nationwide count changed/);

console.log('Asante Ashland CMS public-notice search evidence tests passed.');
