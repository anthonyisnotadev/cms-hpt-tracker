'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { csvToObjects } = require('../lib/util');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('UCI Orange uses its complete pointer-linked MRF; the older bounded observation remains historical', () => {
  const proof = JSON.parse(fs.readFileSync(path.join(audit,
    'reconciliation-uci-orange-lakewood-cross-ccn-attribution-proof-2026-09-28.json'), 'utf8'));
  const ledger = JSON.parse(fs.readFileSync(path.join(audit,
    'reconciliation-manual-access-observations.json'), 'utf8'));
  const byteProof = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-file-byte-proof.json'), 'utf8'));
  const compliance = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'));
  const orange = compliance.find(row => row.ccn === '050348');
  const lakewoodReview = ledger.records.find(row => row.ccn === '050581');
  const cached = byteProof.records.find(row => row.ccns?.includes('050348')
    && row.url === proof.orange_mrf_bounded_header.url);
  const verification = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-verification.json'), 'utf8'));
  const orangeReview = verification.records.find(row => row.ccn === '050348');
  const complete = JSON.parse(fs.readFileSync(path.join(audit,
    'reconciliation-uci-orange-full-file-validation-2026-09-29.json'), 'utf8'));
  const resolutions = JSON.parse(fs.readFileSync(path.join(audit, 'reviewed-resolutions.json'), 'utf8'));
  const resolution = resolutions.find(row => row.ccn === '050348');

  assert.equal(orange.mrf_url, proof.original_source_observation.row.split(',')[10]);
  assert.equal(orange.mrf_url, proof.lakewood_protection.ccn === '050581'
    ? 'https://www.ucihealth.org/pricetransparency/952226406_uci-health-lakewood_standardcharges.json' : '');
  assert.equal(lakewoodReview.disposition, 'current-pointer-file-address-conflict');
  assert.equal(proof.disposition.startsWith('050348 remains unresolved'), true);
  assert.equal(proof.independent_facility_identity.hcai.license_number,
    proof.orange_mrf_bounded_header.declared_license_number);
  assert.equal(cached.sha256, proof.orange_mrf_bounded_header.sample_sha256);
  assert.equal(cached.raw_artifact, `cms_data/hpt/nationwide-verification/file-byte-proof/${proof.orange_mrf_bounded_header.sample_sha256}.bin`);
  assert.equal(proof.orange_mrf_bounded_header.sample_artifact_retained, false);
  assert.equal(orangeReview.disposition, 'verified-current-mrf');
  assert.equal(orangeReview.mrf_url, complete.mrf.url);
  assert.notEqual(orangeReview.mrf_url,
    'https://www.ucihealth.org/pricetransparency/952226406_uci-health-lakewood_standardcharges.json');
  assert.equal(resolution.evidence.url, complete.mrf.url);
  assert.equal(orangeReview.facility_identity, 'corroborated-by-pointer-and-header');
  assert.equal(proof.orange_mrf_bounded_header.full_file_downloaded, false);
  assert.equal(proof.orange_mrf_bounded_header.attestation_verified, false);
  assert.equal(proof.orange_mrf_bounded_header.usable_rows_verified, false);
  assert.equal(complete.finding, 'pointer-linked-current-cms-v3-mrf-identity-metadata-attestation-and-usable-rows-verified');
  assert.equal(complete.mrf.content_length, 68974005);
  assert.equal(complete.mrf.sha256, 'e6c1f35f85842031817c2a941e04590e3a3c0238cd87180c6bdd0f69bcb07d95');
  assert.equal(complete.mrf.counts.standard_charge_information_rows, 35399);
  assert.equal(complete.mrf.checks.cms_v3_schema_derived_structural_and_conditional_checks, 'passed; zero errors');
  assert.equal(resolution.base.mrf_url, proof.original_source_observation.row.split(',')[10]);
  assert.equal(resolution.evidence.url, complete.mrf.url);
  assert.equal(resolution.evidence.fileSha256, complete.mrf.sha256);
  assert.equal(complete.disposition_effect.frozen_891_membership_unresolved_change, 0);
  assert.match(proof.cohort_effect, /outside the frozen 891-membership cohort/);
});
