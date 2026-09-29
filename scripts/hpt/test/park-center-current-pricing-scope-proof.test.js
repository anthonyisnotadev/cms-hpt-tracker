'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));

test('Park Center keeps sibling Parkview files excluded after live pricing-page recheck', () => {
  const proof = read('data/hpt-audit/reconciliation-park-center-current-pricing-scope-proof.json').record;
  const recheck = proof.latest_browser_recheck;
  assert.equal(proof.ccn, '154060');
  assert.equal(recheck.pricing_page.http_status, 200);
  assert.equal(recheck.pricing_page.bytes, 108094);
  assert.match(recheck.pricing_page.browser_observation, /No Park Center or 1909 Carew Street file link/);
  assert.equal(recheck.facility_page.http_status, 200);
  assert.match(recheck.facility_page.browser_observation, /1909 Carew St, Fort Wayne, IN 46805/);
  assert.equal(recheck.root_pointer.sha256, '4e7a785a10276d3e4789f740aa37e89070c47b4566b251c454a1734c5907089f');
  assert.equal(recheck.disposition, 'reconfirmed-system-page-omits-park-center-specific-mrf');
  assert.equal(recheck.count_change, 0);
});
