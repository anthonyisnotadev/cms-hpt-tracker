'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const resolutions = require(path.join(audit, 'reviewed-resolutions.json'));

for (const [ccn, former, current, legal, kind] of [
  ['520103', 'COMMUNITY MEMORIAL HOSPITAL', 'Froedtert Menomonee Falls Hospital', 'Community Memorial Hospital of Menomonee Falls Inc', 'csv'],
  ['521307', 'CHIPPEWA VALLEY HOSPITAL', 'AdventHealth Durand', 'Adventhealth Durand', 'json'],
]) {
  test(`${ccn} Wisconsin alias is tied to exact campus and pointer file`, () => {
    const proof = require(path.join(audit, `reconciliation-wisconsin-${ccn}-proof.json`));
    const resolution = resolutions.find(row => row.ccn === ccn);
    assert.equal(proof.roster_name, former);
    assert.equal(proof.current_facility_name, current);
    assert.equal(proof.declared_hospital_name, legal);
    assert.match(proof.declared_address, /WI 5\d{4}$/);
    assert.equal(proof.declared_license_state, 'WI');
    assert.equal(proof.declared_version, '3.0.0');
    assert.equal(proof.pointer_entry_without_contacts.length, 3);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, proof.retained_sample))).digest('hex'), proof.sample_sha256);
    assert.equal(resolution.action, 'replace');
    assert.equal(resolution.evidence.pointerSha256, proof.pointer_sha256);
    assert.equal(resolution.evidence.fileSha256, proof.sample_sha256);
    assert.equal(resolution.evidence.file_kind, kind);
    const view = loadReviewedView(audit);
    const row = view.compliance.find(item => item.ccn === ccn);
    assert.equal(row.finding, 'compliant-observed');
    assert.equal(row.mrf_url.toLowerCase(), proof.file_url.toLowerCase());
    assert.equal(view.history[ccn].finding, 'not-assessed-not-named-in-file');
    if (ccn === '521307') {
      assert.equal(proof.retained_bytes, proof.file_total_bytes);
      assert.equal(proof.first_party_observations.facility_http_status_for_bounded_client, 403);
    } else {
      assert.ok(proof.retained_bytes < proof.file_total_bytes);
      assert.equal(proof.first_party_observations.pricing_page_direct_file_link, true);
    }
  });
}
