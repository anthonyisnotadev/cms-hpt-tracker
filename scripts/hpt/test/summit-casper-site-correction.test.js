'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { applyResolutions } = require('../lib/reviewed-resolutions');
const { build } = require('../build-unresolved-investigation-worklist');

const audit = path.resolve(__dirname, '../../../data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-summit-casper-site-proof.json'), 'utf8'));
const resolution = JSON.parse(fs.readFileSync(path.join(audit, 'reviewed-resolutions.json'), 'utf8'))
  .find(row => row.ccn === '530034');

test('Summit Casper corrects a wrong HCA site without promoting unretained pointer bytes', () => {
  assert.equal(proof.ccn, resolution.ccn);
  assert.equal(proof.old_domain, resolution.base.domain);
  assert.equal(proof.official_domain, resolution.official.domain);
  assert.equal(proof.state_directory_sha256, resolution.evidence.identityPageSha256);
  assert.equal(proof.mrf_sample_sha256, resolution.evidence.fileSampleSha256);
  assert.equal(proof.mrf_sample_bytes, resolution.evidence.fileSampleBytes);
  assert.equal(proof.pointer_mrf_url, resolution.evidence.webPointerMrfUrl);
  assert.equal(proof.declared_address, resolution.evidence.fileDeclaredAddress);
  assert.equal(proof.declared_license_state, resolution.evidence.fileDeclaredState);
  assert.equal(proof.declared_last_updated_iso, resolution.evidence.fileDeclaredDate);
  assert.equal(proof.declared_version, resolution.evidence.fileDeclaredVersion);
  assert.equal(proof.complete_file_validated, false);
  assert.equal(proof.web_pointer_byte_sha256, null);
  const effective = applyResolutions([resolution.base], [], [], [resolution]);
  assert.deepEqual(effective.applied, ['530034']);
  assert.equal(effective.compliance[0].domain, 'summitmedicalcasper.com');
  assert.equal(effective.compliance[0].finding, 'not-assessed-site-corrected');
  assert.equal(effective.compliance[0].mrf_url, '');
  assert.equal(effective.gaps[0].seeded_domain, 'summitmedicalcasper.com');
  const reconciliation = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-reconciliation.json'), 'utf8'));
  const verification = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-verification.json'), 'utf8'));
  const queued = build(reconciliation, verification).records.find(row => row.ccn === '530034');
  assert.equal(queued.official_domain, 'summitmedicalcasper.com');
  assert.equal(queued.nationwide_disposition, 'pointer-not-retrieved');
  assert.equal(queued.current_disposition, 'corrected-site-web-pointer-visible-client-blocked-file-header-found');
  assert.equal(queued.evidence_gate, 'pointer-bytes-and-complete-file-review');
  assert.deepEqual(queued.reviewed_sources, ['summit-casper-site-proof']);
  assert.equal(queued.candidate_file_recorded, true);
  for (const change of [
    { directoryCcn: '530035' },
    { firstPartyPageAddress: 'somewhere else' },
    { webPointerMrfUrl: 'https://example.org/other.csv' },
    { fileDeclaredState: 'MO' },
  ]) {
    const altered = { ...resolution, evidence: { ...resolution.evidence, ...change } };
    assert.throws(() => applyResolutions([resolution.base], [], [], [altered]),
      /lacks current first-party identity and root-pointer evidence/);
  }
});
