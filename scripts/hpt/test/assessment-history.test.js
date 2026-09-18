'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAssessmentHistory } = require('../lib/assessment-history');
const resolution = { ccn: '001234', action: 'replace', evidence: {
  checked_at: '2026-09-15T14:00:00Z', identity: 'corroborated', http_status: 206, date: '2026-04-01', version: '3.0.0'
} };
test('newer applied resolution is selected while older failed observation remains in history', () => {
  const result = buildAssessmentHistory([], [{ ccn: '001234', observed_at: '2026-09-15T12:00:00Z', disposition: 'mrf-request-unsuccessful' }], [resolution], ['001234']);
  assert.equal(result.assessments['001234'].source, 'Applied reviewed resolution');
  assert.equal(result.assessmentHistory['001234'].length, 2);
});
test('later failed retry remains visible without changing standing evidence', () => {
  const result = buildAssessmentHistory([], [{ ccn: '001234', observed_at: '2026-09-16', disposition: 'mrf-request-unsuccessful' }], [resolution], ['001234']);
  assert.equal(result.assessments['001234'].disposition, 'mrf-request-unsuccessful');
  assert.equal(result.assessmentHistory['001234'][1].metadata, '2026-04-01 / CMS 3.0.0');
});
test('unapplied ledger entries are excluded; dated legacy observations outrank undated nationwide rows', () => {
  const result = buildAssessmentHistory([{ ccn: '001234', checked_at: '2026-09-09' }], [{ ccn: '001234' }], [resolution], []);
  assert.equal(result.assessments['001234'].source, 'Earlier assessment');
  assert.equal(result.assessmentHistory['001234'].length, 2);
});
test('domain-only correction does not claim pointer-to-file verification', () => {
  const correction = { ccn: '054078', action: 'correct-site', official: { domain: 'lasencinashospital.com' },
    evidence: { checked_at: '2026-09-16T12:35:42Z', rootPointerHttpStatus: 404 }, note: 'Root pointer pending' };
  const result = buildAssessmentHistory([], [], [correction], ['054078']);
  const current = result.assessments['054078'];
  assert.match(current.website, /lasencinashospital\.com/);
  assert.match(current.pointer, /HTTP 404/);
  assert.match(current.file_access, /unverified/);
  assert.doesNotMatch(current.pointer, /pointer-to-file linkage/);
});
test('site correction can retain a bounded file lead without hiding the client block', () => {
  const correction = { ccn: '530034', action: 'correct-site', official: { domain: 'summitmedicalcasper.com' },
    evidence: { checked_at: '2026-09-17T12:48:44Z', rootPointerHttpStatus: 403,
      rootPointerResponseKind: 'client-access-denied-web-visible-pointer',
      identityAuthority: 'wyoming-state-directory-and-current-first-party-web',
      fileSampleUrl: 'https://example.org/mrf', fileSampleBytes: 262144,
      fileDeclaredDate: '2026-03-25', fileDeclaredVersion: '3.0.0' } };
  const current = buildAssessmentHistory([], [], [correction], ['530034']).assessments['530034'];
  assert.match(current.pointer, /pointer bytes not retained/);
  assert.match(current.identity, /Wyoming directory/);
  assert.match(current.file_access, /262144 bytes sampled/);
  assert.match(current.metadata, /2026-03-25 \/ CMS 3\.0\.0; complete file unverified/);
  assert.doesNotMatch(current.pointer, /Reviewed pointer-to-file linkage/);
});
test('page-linked replacement file is not described as pointer-to-file linkage', () => {
  const indirect = { ccn: '070010', action: 'replace-observation', evidence: {
    checked_at: '2026-09-16T12:51:55Z', pointerMrfUrl: 'https://example.org/old.csv',
    url: 'https://example.org/current.csv', http_status: 206,
    date: '2026-01-01', version: '3.0.0' } };
  const current = buildAssessmentHistory([], [], [indirect], ['070010']).assessments['070010'];
  assert.match(current.pointer, /different URL/);
  assert.match(current.file_access, /separately linked file/);
  assert.doesNotMatch(current.pointer, /Reviewed pointer-to-file linkage/);
});
