'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { retainedRootMatches, addressFieldMatches } = require('../audit-nationwide-source-proof');
const path = require('path');

const root = path.resolve(__dirname, '../../..');

const record = {
  declared_hospital_name: 'Monongahela Valley Hospital',
  declared_location_name: 'Penn Highlands Mon Valley',
  declared_address: '1163 Country Club Road, Monongahela, PA 15063',
  declared_last_updated: '2026-02-02',
  cms_template_version: '3.0.0'
};

test('retained proof may use exact location identity only with agreeing address, date and version', () => {
  assert.equal(retainedRootMatches(record, {
    mrfHospitalName: 'Monogahela Valley Hospital',
    mrfLocationName: 'Penn Highlands Mon Valley',
    mrfAddress: '1163 Country Club RD. Monongahela, PA 15063',
    declaredLastUpdated: '2026-02-02',
    cmsVersion: '3.0.0'
  }), true);
});

test('retained proof treats equivalent ISO and US date encodings as the same declared date', () => {
  assert.equal(retainedRootMatches(record, {
    mrfHospitalName: 'Monongahela Valley Hospital',
    mrfLocationName: 'Penn Highlands Mon Valley',
    mrfAddress: '1163 Country Club Road, Monongahela, PA 15063',
    declaredLastUpdated: '2/2/2026',
    cmsVersion: '3.0.0'
  }), true);
});

test('retained location identity cannot hide a conflicting street address', () => {
  assert.equal(retainedRootMatches(record, {
    mrfHospitalName: 'Monogahela Valley Hospital',
    mrfLocationName: 'Penn Highlands Mon Valley',
    mrfAddress: '999 Different Street, Monongahela, PA 15063',
    declaredLastUpdated: '2026-02-02',
    cmsVersion: '3.0.0'
  }), false);
});

test('retained proof can match one explicitly listed location in a multi-location root', () => {
  assert.equal(retainedRootMatches({ ...record,
    declared_hospital_name: 'Mount Sinai Morningside',
    declared_location_name: 'Mount Sinai West',
    declared_address: '1000 Tenth Avenue, New York, NY 10019' }, {
    mrfHospitalName: 'Mount Sinai Morningside',
    mrfLocationName: 'Mount Sinai Morningside|Mount Sinai West',
    mrfAddress: '1111 Amsterdam Ave, New York, NY 10025|1000 Tenth Avenue, New York, NY 10019',
    declaredLastUpdated: '2026-02-02',
    cmsVersion: '3.0.0'
  }), true);
});

test('multi-location proof cannot lend a sibling name with a different address', () => {
  assert.equal(retainedRootMatches({ ...record,
    declared_hospital_name: 'Mount Sinai Morningside',
    declared_location_name: 'Unlisted Sibling Hospital',
    declared_address: '999 Different Street, New York, NY 10019' }, {
    mrfHospitalName: 'Mount Sinai Morningside',
    mrfLocationName: 'Mount Sinai Morningside|Mount Sinai West',
    mrfAddress: '1111 Amsterdam Ave, New York, NY 10025|1000 Tenth Avenue, New York, NY 10019',
    declaredLastUpdated: '2026-02-02',
    cmsVersion: '3.0.0'
  }), false);
});

test('source-proof audit compares a facility address to members of a multi-campus header', () => {
  const audit = require(path.join(root, 'data/hpt-audit/nationwide-source-proof-audit.json'));
  const springMountain = audit.records.find(item => item.ccn === '294011');
  assert.ok(springMountain);
  assert.equal(springMountain.issues.includes('source-field-disagreement:declared_address'), false);
  assert.equal(springMountain.identity_source, 'byte-proof');
  // The distinct directional discrepancy against the CMS roster remains
  // visible pending a facility-specific reviewed address-equivalence record.
  assert.equal(springMountain.issues.includes('street-evidence-review'), true);
});

test('CCN-specific Sutter proof artifacts reproduce retained primary-MRF samples', () => {
  const auditDir = path.join(root, 'data/hpt-audit');
  const audit = JSON.parse(fs.readFileSync(path.join(auditDir, 'nationwide-source-proof-audit.json'), 'utf8'));
  for (const [ccn, expectedSha] of [
    ['050043', 'e203295293b8f6fbafff0082d8b623569c232f089e404c3cf4c4498740f27ff6'],
    ['050305', '207d3c4aba5c6dfc60d48ba50ba4d44f97e3fe2d5be9e481d83a43d46c13100c'],
  ]) {
    const row = audit.records.find(item => item.ccn === ccn);
    assert.equal(row?.status, 'proof-audit-complete');
    assert.equal(row?.identity_source, 'browser');
    assert.equal(row?.file_byte_proof?.bytes, 65536);
    assert.equal(row?.file_byte_proof?.sha256, expectedSha);
    assert.match(row?.file_byte_proof?.reconciliation_proof_file || '', new RegExp(ccn));
    const artifactPath = path.resolve(root, row.file_byte_proof.raw_artifact);
    assert.ok(artifactPath.startsWith(root + path.sep));
    const bytes = fs.readFileSync(artifactPath);
    assert.equal(bytes.length, 65536);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), expectedSha);
  }
});

test('UHS manual page-file metadata aliases reconcile with the retained exact-byte proofs', () => {
  const auditDir = path.join(root, 'data/hpt-audit');
  const audit = JSON.parse(fs.readFileSync(path.join(auditDir, 'nationwide-source-proof-audit.json'), 'utf8'));
  for (const [ccn, date, version, sha] of [
    ['154041', '2026-05-12', '3.0.0', '4aa2c9f43cb2dabd2b18f86ddcf987c39bd33d01ed6086d98b1b669c60bfceae'],
    ['154024', '2026-05-12', '3.0.0', 'bd86bf03da026fca067827b4d78b5a15f6303d824abe08798d2ca3dfc9ad343c'],
  ]) {
    const row = audit.records.find(item => item.ccn === ccn);
    assert.equal(row?.status, 'proof-audit-complete');
    assert.deepEqual(row?.issues, []);
    assert.equal(row?.file_byte_proof?.sha256, sha);
    assert.equal(row?.file_byte_proof?.candidate?.declaredLastUpdated, date);
    assert.equal(row?.file_byte_proof?.candidate?.cmsVersion, version);
  }
});

test('source-proof field comparison matches one address within a declared multi-campus value', () => {
  const aggregate = '1710 Harrison St, Batesville, AR 72501|2106 East Main Street, Mountain View, ARKANSAS 72560';
  assert.equal(addressFieldMatches(aggregate, '2106 East Main Street, Mountain View AR 72560'), true);
  assert.equal(addressFieldMatches(aggregate, '999 Different Road, Mountain View AR 72560'), false);
});

test('source-proof field comparison ignores punctuation-only address variants', () => {
  assert.equal(addressFieldMatches('1200 W Maple Ave Geneva AL 36340', '1200 W Maple Ave, Geneva, AL 36340'), true);
});

test('Banner Phoenix current claim has a reproducible exact-file sample and complete source audit', () => {
  const auditDir = path.join(root, 'data/hpt-audit');
  const audit = JSON.parse(fs.readFileSync(path.join(auditDir, 'nationwide-source-proof-audit.json'), 'utf8'));
  const proof = JSON.parse(fs.readFileSync(path.join(auditDir, 'nationwide-file-byte-proof.json'), 'utf8'));
  const row = audit.records.find(item => item.ccn === '030002');
  const sample = proof.records.find(item => item.ccns?.includes('030002') && item.url
    === 'https://images.pricetransparency.healthcare/public-mrfs/banner/270036499_banner-university-medical-center-phoenix_standardcharges.csv');
  assert.equal(row?.disposition, 'verified-current-mrf');
  assert.deepEqual(row?.issues, []);
  assert.equal(row?.file_byte_proof?.bytes, 262144);
  assert.equal(sample?.http_status, 206);
  assert.equal(sample?.bytes_retained, 262144);
  assert.equal(sample?.parsed_root_candidates?.[0]?.mrfLicenseState, 'AZ');
  const artifactPath = path.resolve(root, sample.raw_artifact);
  assert.ok(artifactPath.startsWith(root + path.sep));
  const bytes = fs.readFileSync(artifactPath);
  assert.equal(bytes.length, sample.bytes_retained);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), sample.sha256);
});
