'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const audit = path.resolve(__dirname, '../../../data/hpt-audit');
const read = name => JSON.parse(fs.readFileSync(path.join(audit, name), 'utf8'));

test('CMS exact-CCN address and complete pointer file reconcile Skagit roster', () => {
  const disposition = read('reconciliation-reviewed-header-dispositions.json').records
    .find(row => row.ccn === '500003');
  const reconciled = read('nationwide-reconciliation.json').records.find(row => row.ccn === '500003');
  assert.match(disposition.cms_2025_ccn_address_url, /cms\.gov\/files\/document\/2025-reporting-cycle/);
  assert.match(disposition.cms_2025_ccn_address_observation, /exact CCN 500003.*1415 E Kincaid/);
  assert.match(disposition.cms_enrollment_snapshot_query_url, /filter%5BCCN%5D=500003/);
  assert.match(disposition.cms_enrollment_snapshot_observation, /One exact CCN 500003.*1415 E Kincaid/);
  assert.match(disposition.candidate, /1450 E Kincaid/);
  assert.equal(reconciled.proposed_disposition, 'mrf-facility-identity-unresolved');
  assert.equal(reconciled.workstream, 'consistent');
  assert.deepEqual(reconciled.reviewed_header_disposition, disposition);
});
