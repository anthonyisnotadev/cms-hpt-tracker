'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { applyNationwideVerification, effectiveVerifiedFinding, toAssessment, synchronizeManifest } = require('../lib/nationwide-verification-view');
const fs = require('node:fs');
const path = require('node:path');

const base = { ccn: '123456', hospital_name: 'TEST HOSPITAL', city: 'TESTVILLE', state: 'NY',
  finding: 'mrf-url-unreachable', assessable: 'yes', domain: 'old.test', pointer_url: 'https://old.test/cms-hpt.txt',
  mrf_url: 'https://old.test/old.csv', mrf_last_updated: '', mrf_days_since_update: '', cms_template_version: '', checked_at: '2026-09-01' };
const record = { ccn: base.ccn, hospital_name: base.hospital_name, city: base.city, state: base.state,
  prior_finding: base.finding, disposition: 'verified-current-mrf', official_domain: 'new.test',
  pointer_url: 'https://new.test/cms-hpt.txt|https://www.new.test/cms-hpt.txt', mrf_url: 'https://new.test/current.csv',
  declared_last_updated: '2026-08-01', cms_template_version: '3.0.0', observed_at: '2026-09-15T00:00:00Z',
  next_action: 'Recheck next crawl.' };

test('template-review finding distinguishes current v3 literals from an unobserved version', () => {
  assert.equal(effectiveVerifiedFinding({ disposition: 'verified-template-review', cms_template_version: '3.0' }), 'compliant-observed');
  assert.equal(effectiveVerifiedFinding({ disposition: 'verified-template-review', cms_template_version: '3.0.0' }), 'compliant-observed');
  assert.equal(effectiveVerifiedFinding({ disposition: 'verified-template-review', cms_template_version: '' }), null);
  assert.equal(effectiveVerifiedFinding({ disposition: 'verified-template-review' }), null);
});

test('nationwide verified evidence updates the presentation row without pipe-joining links', () => {
  const row = applyNationwideVerification([base], [record])[0];
  assert.equal(row.finding, 'compliant-observed');
  assert.equal(row.pointer_url, 'https://new.test/cms-hpt.txt');
  assert.equal(row.mrf_days_since_update, '45');
});

test('an unprobed pointer-linked file cannot erase newer reviewed standing evidence', () => {
  const prior = { ...base, finding: 'compliant-observed', checked_at: '2026-09-17T00:00:00Z' };
  const observed = { ...record, prior_finding: prior.finding,
    disposition: 'pointer-linked-file-not-probed', observed_at: '2026-09-15T00:00:00Z',
    latest_observation_superseded: true, mrf_state: 'not-assessed' };
  assert.deepEqual(applyNationwideVerification([prior], [observed]), [prior]);
});

test('CMS 3.0 counts as version 3 and corrects only a newer identity-matched observation of the same standing file', () => {
  const prior = { ...base, finding: 'compliant-observed', cms_template_version: '3.0',
    mrf_url: 'https://old.test/old.csv' };
  const observed = { ...record, prior_finding: prior.finding, disposition: 'verified-template-review',
    mrf_url: prior.mrf_url, cms_template_version: '3.0', metadata_source: 'header-observation',
    facility_identity: 'corroborated-by-pointer-and-header', header_identity_gate: 'file-name-and-address',
    mrf_http_status: '206' };
  const corrected = applyNationwideVerification([prior], [observed])[0];
  assert.equal(corrected.finding, 'compliant-observed');
  assert.equal(corrected.mrf_url, prior.mrf_url);
  assert.match(corrected.evidence, /CMS template version 3\.0/);
  for (const change of [{ mrf_url: 'https://new.test/other.csv' }, { header_identity_gate: '' },
    { cms_template_version: '3.0.1' }, { mrf_http_status: '403' }]) {
    assert.deepEqual(applyNationwideVerification([prior], [{ ...observed, ...change }]), [prior]);
  }
  const older = { ...observed, cms_template_version: '2.0' };
  assert.equal(applyNationwideVerification([prior], [older])[0].finding, 'old-template-version');
});

test('changed-file CMS 3.0 replaces a standing file only with exact pointer and header proof', () => {
  const prior = { ...base, finding: 'compliant-observed', cms_template_version: '3.0.0',
    mrf_url: 'https://old.test/old.json' };
  const next = { ...record, prior_finding: prior.finding, disposition: 'verified-template-review',
    mrf_url: 'https://new.test/current.json', cms_template_version: '3.0',
    metadata_source: 'header-observation', facility_identity: 'corroborated-by-pointer-and-header',
    header_identity_gate: 'file-name-and-address', mrf_http_status: '206',
    pointer_state: 'retrieved-facility-linked', pointer_corpus_raw_integrity: 'hash-corroborated',
    pointer_corpus_checked_url: 'https://new.test/cms-hpt.txt', pointer_corpus_sha256: 'a'.repeat(64),
    pointer_corpus_observed_at: '2026-09-15T01:00:00Z',
    evidence: { pointer_sha256s: ['a'.repeat(64)], matched_mrf_candidates: 1 } };
  const updated = applyNationwideVerification([prior], [next])[0];
  assert.equal(updated.finding, 'compliant-observed');
  assert.equal(updated.mrf_url, next.mrf_url);
  for (const change of [{ pointer_corpus_raw_integrity: 'hash-conflict' },
    { pointer_corpus_sha256: 'b'.repeat(64) }, { pointer_state: 'retrieved-facility-match-unresolved' },
    { evidence: { pointer_sha256s: ['a'.repeat(64)], matched_mrf_candidates: 2 } },
    { pointer_corpus_checked_url: 'https://other.test/cms-hpt.txt' }]) {
    assert.deepEqual(applyNationwideVerification([prior], [{ ...next, ...change }]), [prior]);
  }
});

test('nationwide unresolved evidence stays not assessed and retains original links', () => {
  const unresolved = { ...record, disposition: 'pointer-discovery-incomplete' };
  const row = applyNationwideVerification([base], [unresolved])[0];
  assert.equal(row.finding, 'not-assessed-nationwide-pointer-discovery-incomplete');
  assert.equal(row.assessable, 'no');
  assert.equal(row.mrf_url, base.mrf_url);
});

test('nationwide closed scope exemption clears active file links', () => {
  const closed = { ...record, disposition: 'scope-exempt-closed' };
  const row = applyNationwideVerification([base], [closed])[0];
  assert.equal(row.finding, 'not-applicable-closed');
  assert.equal(row.assessable, 'no');
  assert.equal(row.pointer_url, '');
  assert.equal(row.mrf_url, '');
});

test('nationwide state-hospital scope exemption clears active file links', () => {
  const exempt = { ...record, disposition: 'scope-exempt-state-hospital' };
  const row = { ...base, finding: 'not-assessed-domain-search-pending', assessable: 'no' };
  const result = applyNationwideVerification([row], [exempt])[0];
  assert.equal(result.finding, 'not-applicable-state-hospital');
  assert.equal(result.assessable, 'no');
  assert.equal(result.pointer_url, '');
  assert.equal(result.mrf_url, '');
});

test('nationwide overlay is ignored after identity or prior finding drift', () => {
  assert.deepEqual(applyNationwideVerification([{ ...base, finding: 'compliant-observed' }], [record]), [{ ...base, finding: 'compliant-observed' }]);
  assert.deepEqual(applyNationwideVerification([{ ...base, city: 'OTHER' }], [record]), [{ ...base, city: 'OTHER' }]);
  assert.throws(() => applyNationwideVerification([base], [record, record]), /Duplicate/);
});

test('nationwide assessment keeps evidence stages separate', () => {
  const assessment = toAssessment({ ...record, website_state: 'recorded-official-domain', pointer_state: 'retrieved-facility-linked',
    facility_identity: 'corroborated-by-pointer-and-header', mrf_state: 'verified-current-v3', mrf_http_status: '206' });
  assert.equal(assessment.pointer, 'retrieved-facility-linked');
  assert.equal(assessment.file_access, 'HTTP 206');
  assert.match(assessment.metadata, /CMS 3\.0\.0/);
});

test('checked pointer provenance stays separate from an assigned facility pointer', () => {
  const assessment = toAssessment({ ...record, pointer_state: 'retrieved-facility-match-unresolved',
    pointer_url: '', pointer_corpus_checked_url: 'https://example.org/cms-hpt.txt',
    pointer_corpus_final_url: 'https://example.org/other-hospital/cms-hpt.txt',
    pointer_corpus_sha256: 'a'.repeat(64), pointer_corpus_observed_at: '2026-09-15T00:00:00Z' });
  assert.equal(assessment.pointer_checked_url, 'https://example.org/cms-hpt.txt');
  assert.equal(assessment.pointer_final_url, 'https://example.org/other-hospital/cms-hpt.txt');
  assert.equal(assessment.pointer_corpus_observed_at, '2026-09-15T00:00:00Z');
  assert.equal(assessment.pointer_corpus_sha256, 'a'.repeat(64));
  assert.equal(toAssessment({ ...record, pointer_state: 'retrieved-facility-match-unresolved',
    pointer_corpus_checked_url: 'javascript:alert(1)' }).pointer_checked_url, undefined);
});

test('conflicting retained pointer bytes remain visible for linked and unlinked checks', () => {
  for (const pointer_state of ['retrieved-facility-match-unresolved', 'retrieved-facility-linked']) {
    assert.equal(toAssessment({ ...record, pointer_state,
      pointer_corpus_raw_integrity: 'hash-conflict' }).pointer_raw_integrity, 'hash-conflict');
  }
  assert.equal(toAssessment({ ...record, pointer_corpus_raw_integrity: 'hash-corroborated' }).pointer_raw_integrity, undefined);
});

test('historical pointer capture is shown separately from failed later access', () => {
  const assessment = toAssessment({ ...record, pointer_state: 'access-denied-or-rate-limited-to-client',
    pointer_historical_checked_url: 'https://example.org/cms-hpt.txt',
    pointer_historical_observed_at: '2026-09-07T00:00:00Z',
    pointer_historical_raw_integrity: 'hash-corroborated' });
  assert.equal(assessment.pointer_historical_checked_url, 'https://example.org/cms-hpt.txt');
  assert.equal(assessment.pointer_historical_observed_at, '2026-09-07T00:00:00Z');
  assert.equal(assessment.pointer_checked_url, undefined);
});

test('failed retry preserves a dated successful finding and its metadata', () => {
  const prior = { ...base, finding: 'compliant-observed', mrf_last_updated: '2026-08-01', cms_template_version: '3.0.0' };
  for (const disposition of ['pointer-discovery-incomplete', 'linked-mrf-header-unmatched', 'verified-facility-metadata-unresolved']) {
    assert.deepEqual(applyNationwideVerification([prior], [{ ...record, prior_finding: prior.finding, disposition }]), [prior]);
  }
});

test('incomplete root-pointer retry preserves a reviewed page-file finding', () => {
  const prior = { ...base, finding: 'root-pointer-html-page-with-official-page-file',
    mrf_url: 'https://hospital.test/current.csv', mrf_last_updated: '2026-04-01',
    cms_template_version: '3.0.0', checked_at: '2026-09-16T09:41:54Z' };
  const retry = { ...record, prior_finding: prior.finding, disposition: 'pointer-not-retrieved',
    observed_at: '2026-09-17T00:00:00Z' };
  assert.deepEqual(applyNationwideVerification([prior], [retry]), [prior]);
});

test('page-file-only recheck does not replace the reviewed source-page link with pointer candidates', () => {
  const prior = { ...base, finding: 'compliant-observed',
    pointer_url: 'https://hospital.test/pricing', mrf_url: 'https://files.test/current.json' };
  const pageFile = { ...record, prior_finding: prior.finding, disposition: 'verified-current-mrf',
    metadata_source: 'manual-page-file-recheck',
    pointer_url: 'https://hospital.test/cms-hpt.txt|https://www.hospital.test/cms-hpt.txt',
    mrf_url: prior.mrf_url, source_page_url: prior.pointer_url,
    observed_at: '2026-09-17T00:00:00Z' };
  const result = applyNationwideVerification([prior], [pageFile])[0];
  assert.equal(result.pointer_url, prior.pointer_url);
  assert.equal(result.mrf_url, prior.mrf_url);
});

test('a superseded undated coverage gap cannot erase a newer reviewed page-linked file', () => {
  const reviewed = { ...base, finding: 'official-page-mrf-root-pointer-unavailable',
    domain: 'hospital.test', pointer_url: 'https://hospital.test/cms-hpt.txt',
    mrf_url: 'https://files.test/actual.csv', mrf_last_updated: '2026-04-01',
    cms_template_version: '3.0.0', checked_at: '2026-09-16T09:41:54Z' };
  const olderGap = { ...record, prior_finding: reviewed.finding, disposition: 'pointer-not-retrieved',
    observed_at: '', latest_observation_superseded: true };
  assert.deepEqual(applyNationwideVerification([reviewed], [olderGap]), [reviewed]);
});

test('explicit standing-evidence retention also blocks incomplete overlays', () => {
  const prior = { ...base, finding: 'not-applicable-closed' };
  const retry = { ...record, prior_finding: prior.finding, disposition: 'pointer-not-retrieved',
    standing_evidence_retained: true };
  assert.deepEqual(applyNationwideVerification([prior], [retry]), [prior]);
});

test('older evidence and generic nationwide evidence cannot undo a quarantine', () => {
  assert.deepEqual(applyNationwideVerification([base], [{ ...record, observed_at: '2026-08-15' }]), [base]);
  const prior = { ...base, finding: 'not-assessed-identity-conflict' };
  assert.deepEqual(applyNationwideVerification([prior], [{ ...record, prior_finding: prior.finding }]), [prior]);
});

test('file summaries follow standing rows and discard measurements for replaced files', () => {
  const old = { ...base, mrf_bytes: '500', mrf_format: 'json', source_page_url: 'https://old.test/pricing' };
  const replacement = { ...base, mrf_url: 'https://new.test/file.csv', mrf_last_updated: '2026-08-01',
    mrf_days_since_update: '45', cms_template_version: '3.0.0' };
  const result = synchronizeManifest([old], [replacement])[0];
  assert.equal(result.mrf_url, replacement.mrf_url);
  assert.equal(result.mrf_cms_version, '3.0.0');
  assert.equal(result.mrf_bytes, '');
  assert.equal(result.mrf_format, '');
  assert.equal(result.source_page_url, '');
  assert.equal(synchronizeManifest([], [replacement]).length, 1);
  assert.equal(synchronizeManifest([old], [{ ...replacement, mrf_url: '' }]).length, 0);
});
