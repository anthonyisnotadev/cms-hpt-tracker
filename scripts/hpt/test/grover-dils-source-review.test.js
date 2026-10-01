'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = require(path.join(audit, 'reconciliation-grover-dils-source-review.json'));
const currentPortalProof = require(path.join(audit, 'reconciliation-grover-dils-current-pricing-portal-route-audit-2026-09-27.json'));

test('Grover Dils keeps the current ZIP, legacy CSV and portal distinct', () => {
  const pointer = fs.readFileSync(path.join(root, proof.retained_pointer_artifact));
  const sample = fs.readFileSync(path.join(root, proof.retained_home_file_sample));
  assert.equal(crypto.createHash('sha256').update(pointer).digest('hex'), proof.pointer_sha256);
  assert.equal(crypto.createHash('sha256').update(sample).digest('hex'), proof.home_file_sample_sha256);
  assert.notEqual(proof.pointer_mrf_url, proof.home_file_url);
  assert.notEqual(proof.pointer_mrf_url, proof.home_pricing_portal_url);
  assert.equal(proof.home_file_declared_date, '2023-11-06');
  assert.equal(proof.home_file_cms_version_observed, false);
  assert.equal(proof.pointer_file_client_status, 0);
  assert.equal(proof.pointer_file_browser_error_code, 'ERR_NAME_NOT_RESOLVED');
  assert.equal(proof.home_portal_export_http_status, 204);
  assert.equal(proof.current_pointer_file_bytes_verified, false);
  assert.equal(currentPortalProof.pointer_sha256, proof.pointer_sha256);
  assert.match(currentPortalProof.official_homepage_price_transparency_link, /^https:\/\/rca\.elevatepfs\.com\/ptapp\//);
  assert.equal(currentPortalProof.disposition, 'unresolved-current-portal-found-pointer-mrf-not-recovered');
  assert.match(currentPortalProof.portal_browser_observation, /Selecting Grover C Dils Medical Center in the Facility selector exposes an Export > All data menu item/);
  assert.match(currentPortalProof.portal_browser_observation, /did not produce a browser download, a navigable file URL, or file bytes/);
  assert.equal(currentPortalProof.third_party_lead.classification, 'unverified-third-party-route-lead');
  assert.match(currentPortalProof.next_action, /permitted publisher-supported path/);
  const row = require(path.join(audit, 'unresolved-investigation-worklist.json')).records
    .find(item => item.ccn === '291312');
  assert.equal(row.reviewed_follow_up, true);
  assert.equal(row.current_disposition, 'pointer-facility-match-unresolved');
  assert.equal(row.candidate_file_recorded, true);
  assert.equal(row.latest_review_at, '2026-09-27T22:16:00Z');
  assert.equal(row.next_action, currentPortalProof.next_action);
});
