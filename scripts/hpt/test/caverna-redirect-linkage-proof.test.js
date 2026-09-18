'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '../../..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));

test('Caverna first-party pointer archive has bounded identity metadata proof', () => {
  const proof = read('data/hpt-audit/reconciliation-caverna-redirect-linkage-proof.json');
  const pointer = fs.readFileSync(path.join(root, proof.retained_pointer_file));
  assert.equal(crypto.createHash('sha256').update(pointer).digest('hex'), proof.pointer_sha256);
  assert.ok(pointer.toString().includes(proof.pointer_mrf_url));
  assert.ok(pointer.toString().includes(proof.pointer_location_name));
  assert.equal(proof.pointer_mrf_head_status, 302);
  assert.equal(proof.pointer_mrf_get_status_without_follow, 302);
  assert.equal(proof.page_link_curl_first_redirect_path, '/charges/mcc/');
  assert.equal(proof.pointer_mrf_redirect_host, proof.page_link_web_click_redirect_host);
  assert.equal(proof.pointer_mrf_redirect_path, proof.page_link_web_click_redirect_path);
  assert.equal(proof.current_archive_http_status, 200);
  assert.equal(proof.current_archive_bytes_retained, 31545894);
  assert.equal(proof.current_zip_member, '610920842_The-Medical-Center-at-Caverna_standardcharges.json');
  assert.equal(proof.current_declared_address, '1501 S. Dixie St. Horse Cave, KY 42749');
  assert.equal(proof.current_declared_license_state, 'KY');
  assert.equal(proof.current_declared_last_updated, '2026-04-01');
  assert.equal(proof.current_declared_cms_version, '3.0.0');
  const reconciliation = read('data/hpt-audit/nationwide-reconciliation.json').records
    .find(row => row.ccn === proof.ccn);
  const queue = read('data/hpt-audit/unresolved-investigation-worklist.json').records
    .find(row => row.ccn === proof.ccn);
  const ledger = read('data/hpt-audit/reviewed-resolutions.json').find(row => row.ccn === proof.ccn);
  assert.equal(reconciliation.workstream, 'consistent');
  assert.equal(queue, undefined);
  assert.equal(ledger.action, 'replace');
  assert.equal(ledger.evidence.observedFinding, 'compliant-observed');
  assert.equal(ledger.evidence_run, 'caverna-current-pointer-archive-header-2026-09-17');
});
