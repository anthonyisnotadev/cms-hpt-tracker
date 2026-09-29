'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = require(path.join(audit, 'reconciliation-hackettstown-proof.json'));
const resolution = require(path.join(audit, 'reviewed-resolutions.json')).find(row => row.ccn === '310115');

test('generic AHS Corp roster maps only to exact Hackettstown pointer and CSV campus', () => {
  assert.equal(proof.roster_name, 'AHS HOSPITAL CORP');
  assert.equal(proof.roster_address, '651 WILLOW GROVE ST');
  assert.equal(proof.current_facility_name, 'Hackettstown Medical Center');
  assert.equal(proof.declared_address, '651 Willow Grove St, Hackettstown, NJ 07840');
  assert.equal(proof.declared_license_state, 'NJ');
  assert.equal(proof.declared_date, '2026-04-01');
  assert.equal(proof.pricing_page_label_updated, '2026-04-28');
  assert.equal(proof.declared_version, '3.0.0');
  assert.equal(proof.pointer_entry_without_contacts.length, 3);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, proof.retained_sample))).digest('hex'), proof.sample_sha256);
  assert.equal(resolution.action, 'replace');
  assert.equal(resolution.evidence.pointerSha256, proof.pointer_sha256);
  assert.equal(resolution.evidence.fileSha256, proof.sample_sha256);
  const view = loadReviewedView(audit);
  const row = view.compliance.find(item => item.ccn === '310115');
  assert.equal(row.finding, 'compliant-observed');
  assert.equal(row.domain, 'atlantichealth.org');
  assert.equal(row.mrf_url, proof.file_url);
  assert.equal(view.history['310115'].finding, 'not-assessed-not-named-in-file');
});
