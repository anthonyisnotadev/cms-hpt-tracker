'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = require(path.join(audit, 'reconciliation-secaucus-proof.json'));
const resolution = require(path.join(audit, 'reviewed-resolutions.json')).find(row => row.ccn === '310118');

test('Secaucus former name and legal entity map only to exact pointer and CSV campus', () => {
  assert.equal(proof.roster_name, 'HUDSON REGIONAL HOSPITAL');
  assert.equal(proof.roster_address, '55 MEADOWLANDS PKWY');
  assert.equal(proof.current_facility_name, 'Secaucus University Hospital');
  assert.equal(proof.declared_hospital_name, 'NJMHMC LLC');
  assert.equal(proof.declared_address, '55 Meadowlands Pkwy Secaucus NJ 07094');
  assert.equal(proof.declared_license_state, 'NJ');
  assert.equal(proof.declared_date, '2026-01-19');
  assert.equal(proof.declared_version, '3.0.0');
  assert.match(proof.pricing_page_observation, /no direct Secaucus MRF link/i);
  assert.equal(proof.pointer_entry_without_contacts.length, 3);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, proof.retained_sample))).digest('hex'), proof.sample_sha256);
  assert.equal(resolution.action, 'replace');
  assert.equal(resolution.evidence.pointerSha256, proof.pointer_sha256);
  assert.equal(resolution.evidence.fileSha256, proof.sample_sha256);
  const view = loadReviewedView(audit);
  const row = view.compliance.find(item => item.ccn === '310118');
  assert.equal(row.finding, 'compliant-observed');
  assert.equal(row.domain, 'hudsonregionalhospital.com');
  assert.equal(row.mrf_url, proof.file_url);
  assert.equal(view.history['310118'].finding, 'not-assessed-not-named-in-file');
});
