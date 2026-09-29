'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const observations = require('../../../data/hpt-audit/reconciliation-manual-access-observations.json').records;
const { loadReviewedView } = require('../lib/reviewed-resolutions');

test('Freedom facility pages do not promote unlisted shared-pointer siblings', () => {
  const view = loadReviewedView(require('node:path').resolve(__dirname, '../../../data/hpt-audit'));
  const expected = ['194083', '194119', '194121'];
  const scoped = observations.filter(row => expected.includes(row.ccn));
  assert.deepEqual(scoped.map(row => row.ccn), expected);
  assert.equal(new Set(scoped.map(row => row.pointer_sha256)).size, 1);
  assert.equal(new Set(scoped.map(row => row.official_pricing_page_sha256)).size, 1);
  for (const row of scoped) {
    assert.equal(row.pointer_http_status, 206);
    assert.equal(row.pointer_location_names.length, 3);
    assert.ok(row.pointer_location_names.every(name => !new RegExp(row.ccn === '194083' ? 'Bastrop' : row.ccn === '194119' ? 'Ferriday' : 'Leesville', 'i').test(name)));
    assert.match(row.next_action, /specific pointer|facility-specific|shared-pointer|sibling/i);
    assert.equal(view.compliance.find(item => item.ccn === row.ccn).mrf_url, '');
  }

  for (const ccn of ['194119', '194121']) {
    const row = scoped.find(item => item.ccn === ccn);
    assert.equal(row.latest_scope_recheck.observed_at, '2026-09-28T09:58:33Z');
    assert.equal(row.latest_scope_recheck.proof_file, 'reconciliation-freedom-ferriday-leesville-page-pointer-recheck-2026-09-28.json');
    assert.equal(row.latest_scope_recheck.facility_file_link_set_changed, false);
    assert.equal(row.latest_scope_recheck.pointer_bytes_changed_since_prior_review, false);
    assert.equal(row.latest_scope_recheck.new_mrf_bytes, false);
  }
});
