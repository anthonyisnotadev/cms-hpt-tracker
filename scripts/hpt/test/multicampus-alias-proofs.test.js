'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const ledger = require(path.join(audit, 'reviewed-resolutions.json'));
const view = loadReviewedView(audit);

for (const [ccn, name, street] of [
  ['141335', 'Mercyhealth Hospital & Medical Center - Harvard', '901 Grant Street'],
  ['360041', 'University Hospitals Parma Medical Center', '7007 Powers Boulevard'],
  ['360075', 'University Hospitals Regional Hospitals - Geauga Medical Center', '13207 Ravenna Road'],
  ['361307', 'University Hospitals Geneva Medical Center', '870 West Main Street'],
]) {
  test(`${ccn} uses only its distinct campus entry within multi-location evidence`, () => {
    const proof = require(path.join(audit, `reconciliation-multicampus-${ccn}-proof.json`));
    const resolution = ledger.find(item => item.ccn === ccn);
    assert.equal(proof.matched_location_name, name);
    assert.ok(proof.matched_address.startsWith(street));
    assert.ok(proof.declared_location_names.includes(name));
    assert.ok(proof.declared_addresses.includes(proof.matched_address));
    assert.equal(proof.pointer_entry_without_contacts.length, 3);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, proof.retained_sample))).digest('hex'), proof.sample_sha256);
    assert.equal(resolution.action, 'replace');
    assert.equal(resolution.evidence.pointerSha256, proof.pointer_sha256);
    assert.equal(resolution.evidence.fileSha256, proof.sample_sha256);
    const row = view.compliance.find(item => item.ccn === ccn);
    assert.equal(row.finding, 'compliant-observed');
    assert.equal(row.mrf_url, proof.file_url);
    assert.equal(view.history[ccn].finding, 'not-assessed-not-named-in-file');
  });
}

test('360098 shared Lake West/TriPoint file is bound to CMS CCN and Auburn Road TriPoint location only', () => {
  const proof = require(path.join(audit, 'reconciliation-lake-health-shared-campus-proof.json'));
  const resolution = ledger.find(item => item.ccn === '360098');
  assert.equal(proof.roster_address, '7590 AUBURN ROAD');
  assert.equal(proof.matched_location_name, 'University Hospitals Tripoint Medical Center');
  assert.equal(proof.shared_pointer_entry_count, 2);
  assert.equal(proof.cms_additional_address, '36000 Euclid Avenue, Willoughby, OH 44094');
  assert.match(proof.matched_address, /^7590 Auburn Road, Painesville OH/);
  assert.match(proof.city_wording_difference, /Concord/);
  assert.ok(proof.declared_location_names.includes('University Hospitals Lake West Medical Center'));
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, proof.retained_sample))).digest('hex'), proof.sample_sha256);
  assert.equal(resolution.action, 'replace');
  assert.equal(resolution.evidence.pointerSha256, proof.pointer_sha256);
  assert.equal(resolution.evidence.fileSha256, proof.sample_sha256);
  const row = view.compliance.find(item => item.ccn === '360098');
  assert.equal(row.finding, 'compliant-observed');
  assert.equal(row.mrf_url, proof.file_url);
  assert.equal(view.history['360098'].finding, 'not-assessed-not-named-in-file');
});
