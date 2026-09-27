'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const read = name => JSON.parse(fs.readFileSync(path.join(audit, name), 'utf8'));

test('PRWCH current full-file refresh preserves page-linked evidence and root-pointer uncertainty', () => {
  const proof = read('reconciliation-prwch-current-page-file-proof-2026-09-21.json');
  const latest = proof.latest_full_file_recheck_2026_09_27;
  assert.equal(proof.ccn, '400138');
  assert.equal(latest.http_status, 200);
  assert.equal(latest.content_type, 'text/csv');
  assert.equal(latest.bytes, 5221625);
  assert.notEqual(latest.sha256, latest.prior_sha256);
  assert.equal(latest.csv_data_rows, 47349);
  assert.equal(latest.csv_header_columns, 25);
  assert.equal(latest.malformed_data_row_widths, 0);
  assert.equal(latest.declared_hospital_name, 'PR WOMEN AND CHILDREN HOSPITAL');
  assert.equal(latest.declared_license_state, 'PR');
  assert.equal(latest.cms_template_version, '3.0.0');
  assert.match(latest.pointer_recheck.result, /fetch failed before an HTTP response/);
  assert.equal(latest.disposition_effect, 'none; current page-linked MRF evidence refreshed, root pointer remains unavailable');

  const ledger = read('reviewed-resolutions.json').find(row => row.ccn === '400138');
  assert.equal(ledger.finding, 'verified-current-mrf');
  assert.equal(ledger.evidence.fileSha256, latest.sha256);
  assert.equal(ledger.evidence.priorFileSha256, latest.prior_sha256);
  assert.equal(ledger.evidence.fullFileAudit.malformedDataRowWidths, 0);
  const effective = loadReviewedView(audit).compliance.find(row => row.ccn === '400138');
  assert.equal(effective.finding, 'compliant-observed');
  assert.equal(effective.mrf_url, proof.mrf_url);
});
