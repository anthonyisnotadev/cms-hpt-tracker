'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const highland = require(path.join(audit, 'reconciliation-highland-hills-transition-proof.json'));
const northwest = require(path.join(audit, 'reconciliation-northwest-ms-transition-proof.json'));

test('Highland Hills is a current separate publisher with a hash-bound pointer file', () => {
  const sample = fs.readFileSync(path.join(root, highland.retained_sample));
  assert.equal(sample.length, 262144);
  assert.equal(crypto.createHash('sha256').update(sample).digest('hex'), highland.mrf_sample_sha256);
  assert.match(sample.toString('utf8', 0, 250), /license_number\|MS/);
  assert.equal(highland.declared_address, '401 Getwell Dr, Senatobia, MS 38668');
  assert.equal(highland.declared_date, '2026-03-27');
  assert.equal(highland.version, '3.0.0');
  const view = loadReviewedView(audit);
  const row = view.compliance.find(item => item.ccn === '250172');
  assert.equal(row.domain, 'highlandhillsmc.com');
  assert.equal(row.pointer_url, highland.pointer_url);
  assert.equal(row.mrf_url, highland.mrf_url);
  assert.equal(row.finding, 'compliant-observed');
  assert.equal(view.history['250172'].domain, 'deltahealthsystem.org');
});

test('Northwest successor site preserves the former quarantine while current verified evidence is selected', () => {
  const oldPointer = fs.readFileSync(path.join(root, northwest.former_pointer_artifact));
  assert.equal(crypto.createHash('sha256').update(oldPointer).digest('hex'), northwest.former_pointer_sha256);
  assert.doesNotMatch(oldPointer.toString('utf8'), /Northwest|Clarksdale|1970 Hospital/i);
  assert.notEqual(northwest.price_page_file_url, northwest.linked_txt_declared_file_url);
  assert.equal(northwest.pointer_and_file_bytes_verified, false);
  assert.equal(northwest.current_site_requests.length, 6);
  for (const response of northwest.current_site_requests) {
    assert.equal(response.http_status, 202);
    assert.equal(response.response_kind, 'html-security-challenge');
    assert.match(response.response_sha256, /^[a-f0-9]{64}$/);
  }
  const view = loadReviewedView(audit);
  const row = view.compliance.find(item => item.ccn === '250042');
  assert.equal(row.domain, 'nwmrmc.org');
  assert.equal(row.finding, 'compliant-observed');
  assert.match(row.pointer_url, /price_3_1389799598\.txt/);
  assert.match(row.mrf_url, /646001574_NORTHWEST-MISS-REGIONAL-MEDICAL-CENTER_standardcharges\.zip/);
  assert.equal(view.history['250042'].domain, 'deltahealthsystem.org');
});
