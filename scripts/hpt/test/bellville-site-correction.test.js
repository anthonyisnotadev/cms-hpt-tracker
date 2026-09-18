'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const root = path.resolve(__dirname, '../../..');
const proof = require(path.join(root, 'data/hpt-audit/reconciliation-bellville-site-correction-proof.json'));
const resolutions = require(path.join(root, 'data/hpt-audit/reviewed-resolutions.json'));
const verification = require(path.join(root, 'data/hpt-audit/nationwide-verification.json')).records;
const reconciliation = require(path.join(root, 'data/hpt-audit/nationwide-reconciliation.json')).records;
const observations = require(path.join(root, 'data/hpt-audit/reconciliation-manual-access-observations.json')).records;
const { loadReviewedView } = require('../lib/reviewed-resolutions');

test('Bellville wrong-state site correction retains pointer/file review without a clean promotion', () => {
  assert.equal(proof.ccn, '450253');
  assert.equal(proof.old_assigned_domain, 'sjhsyr.org');
  assert.deepEqual(proof.old_pointer_location_names, ['St Josephs Hospital Health Ctr']);
  assert.equal(proof.official_domain, 'midcoasthealthsystem.org');
  assert.equal(proof.pointer_location_name, 'Bellville Medical Center');
  assert.equal(proof.file_declared_address, '44 North Cummings St , Bellville, TX 77418');
  assert.equal(proof.file_declared_license_state, 'TX');
  assert.equal(proof.file_declared_update, '2025-06-01');
  assert.equal(proof.file_declared_version, '2.0.0');
  assert.equal(proof.pointer_file_sample_bytes, 262144);
  assert.match(proof.pointer_file_sample_sha256, /^[a-f0-9]{64}$/);
  const resolution = resolutions.find(row => row.ccn === '450253');
  assert.equal(resolution.action, 'correct-site');
  assert.equal(resolution.evidence.rootPointerResponseKind, 'structured-facility-pointer');
  assert.equal(resolution.evidence.rootPointerFileTargetSha256, proof.pointer_file_url_sha256);
  const latest = verification.find(row => row.ccn === '450253');
  assert.equal(latest.official_domain, proof.official_domain);
  assert.equal(latest.pointer_state, 'retrieved-facility-linked-manual-review');
  assert.equal(latest.disposition, 'pointer-linked-file-review-pending');
  assert.equal(latest.standing_mrf_url, '');
  const standing = reconciliation.find(row => row.ccn === '450253');
  assert.equal(standing.standing_finding, 'not-assessed-site-corrected');
  assert.equal(standing.workstream, 'genuinely-unresolved-investigation');
  assert.equal(observations.find(row => row.ccn === '450253').proof_file,
    'reconciliation-bellville-site-correction-proof.json');
  const gap = loadReviewedView(path.join(root, 'data/hpt-audit')).gaps.find(row => row.ccn === '450253');
  assert.equal(gap.seeded_domain, 'midcoasthealthsystem.org');
  assert.equal(gap.remediation, 'corrected-site-follow-up');
  assert.equal(gap.pointer_status, 'reviewed-pointer-file-follow-up');
  const html = fs.readFileSync(path.join(root, 'tracker.html'), 'utf8');
  const marker = '<script id="tracker-data" type="application/json">';
  const begin = html.indexOf(marker) + marker.length;
  const data = JSON.parse(html.slice(begin, html.indexOf('</script>', begin)));
  assert.ok(data.gapRows.some(row => row[0] === '450253'));
  assert.match(data.investigationNextSteps['450253'].nextAction, /Do not reuse the unrelated New York/);
});
