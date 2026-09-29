'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const audit = path.resolve(__dirname, '../../../data/hpt-audit');
const read = name => JSON.parse(fs.readFileSync(path.join(audit, name), 'utf8'));

test('dated Oregon state-license proof distinguishes satellite relationship from Medicare CCN status', () => {
  const proof = read('reconciliation-asante-ashland-state-license-proof.json');
  assert.deepEqual(proof.ccns, ['380005', '380018']);
  for (const document of [proof.licensed_hospitals, proof.licensed_satellites]) {
    assert.equal(document.file_updated_on, '2026-07-30');
    assert.match(document.sha256, /^[a-f0-9]{64}$/);
    assert.ok(document.bytes > 0 && document.bytes < 1000000);
    assert.match(document.url, /^https:\/\/www\.oregon\.gov\/.*\.pdf$/);
  }
  assert.match(proof.licensed_satellites.satellite, /14-0451-8.*280 Maple Street/);
  assert.match(proof.licensed_hospitals.observation, /not a Medicare CCN termination record/);
  const rows = new Map(read('nationwide-reconciliation.json').records.map(row => [row.ccn, row]));
  const former = rows.get('380005'), parent = rows.get('380018');
  assert.equal(former.workstream, 'genuinely-unresolved-investigation');
  assert.equal(parent.standing_finding, 'compliant-observed');
  assert.equal(parent.workstream, 'standing-evidence-follow-up');
  assert.match(former.next_action, /effective-dated post-2026-05-22 CMS\/MAC status record/);
  assert.match(parent.next_action, /Asante Ashland satellite coverage/);
  assert.notEqual(former.standing_mrf_url, parent.standing_mrf_url);
  assert.equal(proof.cms_live_api_pair_recheck.records.length, 2);
  const api = new Map(proof.cms_live_api_pair_recheck.records.map(row => [row.ccn, row]));
  assert.equal(api.get('380005').practice_location_type, 'OTHER HOSPITAL PRACTICE LOCATION');
  assert.equal(api.get('380018').practice_location_type, 'MAIN/PRIMARY HOSPITAL LOCATION');
  assert.match(proof.cms_live_api_pair_recheck.interpretation, /no effective termination date/);
  const standing = read('standing-evidence-followup-worklist.json').records.find(row => row.ccn === '380018');
  assert.equal(standing.next_action, parent.manual_access_observation.next_action);
});

test('third-party Asante MRF index lead is retained without importing prices or changing CCN scope', () => {
  const proof = read('reconciliation-asante-ashland-third-party-mrf-index-recheck-2026-09-28.json');
  const manual = read('reconciliation-manual-access-observations.json').records.find(row => row.ccn === '380005');
  const newest = manual.latest_third_party_mrf_index_recheck_2026_09_28;
  assert.equal(newest.proof_file, 'reconciliation-asante-ashland-third-party-mrf-index-recheck-2026-09-28.json');
  assert.equal(proof.third_party_index_observation.raw_file_link_target, newest.download_link_target);
  assert.equal(proof.third_party_index_observation.link_target_is_publisher_hosted, true);
  assert.match(proof.retrieval_attempts[0].content_type_limitation, /unsupported content-type/);
  assert.equal(proof.retrieval_attempts[1].result, 'net::ERR_BLOCKED_BY_CLIENT');
  assert.equal(proof.disposition_effect, 'none; preserve CCN 380005 as unresolved for post-transition CMS status and shared-file content/scope; do not import third-party prices or infer closure, compliance, or MRF identity.');
  const reconciled = read('nationwide-reconciliation.json').records.find(row => row.ccn === '380005');
  assert.equal(reconciled.workstream, 'genuinely-unresolved-investigation');
  assert.match(reconciled.next_action, /effective-dated post-2026-05-22 CMS\/MAC status record/);
  assert.match(proof.next_action, /genuinely separate byte-serving source/);
});
