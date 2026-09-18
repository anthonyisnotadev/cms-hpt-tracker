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
    assert.match(row.next_action, /do not borrow a sibling file/i);
    assert.equal(view.compliance.find(item => item.ccn === row.ccn).mrf_url, '');
  }
});
