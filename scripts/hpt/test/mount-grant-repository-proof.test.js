const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const proof = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/reconciliation-mount-grant-current-page-pdf-proof.json'), 'utf8'));
const fullFileProof = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/reconciliation-mount-grant-historical-full-file-proof-2026-09-27.json'), 'utf8'));

test('Mount Grant deleted pointer target remains distinct from custom PDF evidence', () => {
  assert.equal(proof.ccn, '291300');
  assert.equal(proof.pointer_mrf_http_status, 404);
  assert.equal(proof.page_file_role, 'official shoppable-services/custom PDF, not a current CMS-template CSV/JSON MRF');
  assert.equal(proof.latest_publisher_repository_recheck.disposition, 'publisher-link-deletion-retained-no-mrf-promotion');
  assert.match(proof.latest_publisher_repository_recheck.observed_result, /deleted in commit c60d9c9/);
  assert.match(proof.latest_publisher_repository_recheck.interpretation, /does not establish current file absence/);
  assert.equal(fullFileProof.historical_file_http_status, 200);
  assert.equal(fullFileProof.historical_file_bytes, 40941755);
  assert.equal(fullFileProof.historical_file_sha256, '7c28d9c0057b7a0458c5e009785e7a4ec895ed4cbd9ea253e61adb82037035e7');
  assert.equal(fullFileProof.content_validation.standard_charge_information_entries, 3415);
  assert.equal(fullFileProof.content_validation.cms_template_version, '2.0.0');
  assert.equal(fullFileProof.current_pointer_target_status, 404);
  assert.equal(fullFileProof.deletion_event.commit, 'c60d9c9b5edcae7eb58595a37439c03d9597f3b9');
  const resolution = require(path.join(root, 'data/hpt-audit/reviewed-resolutions.json'))
    .find(row => row.ccn === '291300');
  const {csvToObjects} = require(path.join(root, 'scripts/hpt/lib/util'));
  const {applyResolutions} = require(path.join(root, 'scripts/hpt/lib/reviewed-resolutions'));
  const base = csvToObjects(fs.readFileSync(path.join(root, 'data/hpt-audit/compliance.csv'), 'utf8'))
    .find(row => row.ccn === '291300');
  const applied = applyResolutions([base], [], [], [resolution]);
  assert.equal(applied.compliance[0].finding, 'mrf-stale-over-365-days');
  assert.equal(applied.compliance[0].mrf_last_updated, '2025-09-10');
  assert.equal(applied.compliance[0].mrf_url, fullFileProof.historical_file_url);
  assert.equal(applied.history['291300'].finding, 'mrf-url-unreachable');
});
