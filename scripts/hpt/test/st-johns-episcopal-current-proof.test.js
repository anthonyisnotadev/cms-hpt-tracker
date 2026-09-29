'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '../../..');
const proof = require(path.join(root, 'data/hpt-audit/reconciliation-st-johns-episcopal-current-proof.json'));
const resolutions = require(path.join(root, 'data/hpt-audit/reviewed-resolutions.json'));
const verification = require(path.join(root, 'data/hpt-audit/nationwide-verification.json')).records;
const reconciliation = require(path.join(root, 'data/hpt-audit/nationwide-reconciliation.json')).records;

test('St Johns Episcopal current pointer/file supersedes unrelated Northwell assignment', () => {
  assert.equal(proof.ccn, '330395');
  assert.equal(proof.old_assigned_domain, 'northwell.edu');
  assert.equal(proof.old_pointer_has_far_rockaway_hospital, false);
  assert.equal(proof.current_domain, 'ehs.org');
  assert.equal(proof.pointer_entry_without_contacts[0], 'location-name: Episcopal Health Services');
  assert.equal(proof.pricing_page_links_exact_mrf, true);
  assert.equal(proof.file_declared_name, 'St Johns Episcopal Hospital');
  assert.equal(proof.file_declared_address, '327 Beach 19th St,Far Rockaway,NY,11691');
  assert.equal(proof.file_declared_license_state, 'NY');
  assert.equal(proof.file_declared_update, '2026-04-07');
  assert.equal(proof.file_declared_version, '3.0.0');
  assert.equal(proof.retained_bytes, 262144);
  const sample = fs.readFileSync(path.join(root, proof.retained_sample));
  assert.equal(crypto.createHash('sha256').update(sample).digest('hex'), proof.sample_sha256);
  assert.match(proof.limitation, /not a complete-file/);
  const resolution = resolutions.find(row => row.ccn === '330395');
  assert.equal(resolution.action, 'replace');
  assert.equal(resolution.evidence.fileSha256, proof.sample_sha256);
  assert.equal(resolution.evidence.pointerUrl, proof.pointer_url);
  const current = verification.find(row => row.ccn === '330395');
  assert.equal(current.official_domain, 'ehs.org');
  assert.equal(current.standing_finding, 'compliant-observed');
  assert.equal(current.latest_observation_superseded, true);
  assert.equal(current.standing_mrf_url, proof.pointer_file_url);
  assert.equal(reconciliation.find(row => row.ccn === '330395').workstream, 'consistent');
  const html = fs.readFileSync(path.join(root, 'tracker.html'), 'utf8');
  const marker = '<script id="tracker-data" type="application/json">';
  const begin = html.indexOf(marker) + marker.length;
  const tracker = JSON.parse(html.slice(begin, html.indexOf('</script>', begin)));
  const publicRow = tracker.rows.find(row => row[0] === '330395');
  assert.equal(publicRow[8], proof.pointer_file_url);
  assert.equal(publicRow[9], proof.pointer_url);
  assert.equal(tracker.auditHistory['330395'].domain, 'northwell.edu');
});
