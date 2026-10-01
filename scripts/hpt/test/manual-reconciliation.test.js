'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { reconcileManual, authoritativeDates } = require('../lib/manual-reconciliation');
const row = { ccn: '1', finding: 'compliant-observed', checked_at: '2026-09-15T12:00:00Z',
  mrf_url: 'https://hospital.test/new.csv', mrf_last_updated: '2026-09-01' };
const outreach = { '1': { correction: { checkedOn: '2026-09-10', verdict: 'failing', mrfUrl: 'https://hospital.test/old.csv' } } };
test('later verified file evidence supersedes older manual verdict and retains differences', () => {
  const result = reconcileManual([row], outreach)[0];
  assert.equal(result.disposition, 'superseded-by-later-file-evidence');
  assert.deepEqual(result.differences, ['mrf-url', 'verdict']);
});
test('newer failures cannot suppress a manual correction', () => {
  const failed = { ...row, finding: 'not-assessed-nationwide-pointer-discovery-incomplete' };
  assert.deepEqual(authoritativeDates([failed]), {});
  assert.equal(reconcileManual([failed], outreach)[0].disposition, 'evidence-review-required');
});
test('same-day manual observations are not automatically superseded', () => {
  const sameDay = { '1': { correction: { checkedOn: '2026-09-15', verdict: 'failing' } } };
  assert.equal(reconcileManual([row], sameDay)[0].disposition, 'evidence-review-required');
});
test('later reviewed pointer defect with retained dated file evidence supersedes an older manual compliance verdict', () => {
  const pointerDefect = { ...row, finding: 'pointer-lists-no-mrf-url', checked_at: '2026-09-15T12:00:00Z' };
  const result = reconcileManual([pointerDefect], outreach)[0];
  assert.equal(result.disposition, 'superseded-by-later-file-evidence');
  assert.ok(result.differences.includes('verdict'));
});
test('manual closed-facility exemption agrees with the dedicated standing scope category', () => {
  const closed = { ...row, finding: 'not-applicable-closed', mrf_url: '', mrf_last_updated: '' };
  const input = { '1': { correction: { checkedOn: '2026-09-10', verdict: 'exempt' } } };
  assert.equal(reconcileManual([closed], input)[0].disposition, 'agrees-with-standing-fields');
});
test('later exact-CCN Indian Health Program proof reconciles an older failing manual verdict without claiming an MRF', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.resolve(__dirname, '../../..');
  const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  const proof = { ...read('data/hpt-audit/reconciliation-kanakanak-indian-health-program-scope-proof-2026-09-28.json'),
    proof_file: 'reconciliation-kanakanak-indian-health-program-scope-proof-2026-09-28.json' };
  const standing = require('../lib/reviewed-resolutions').loadReviewedView(path.join(root, 'data/hpt-audit'))
    .compliance.find(row => row.ccn === '021309');
  const correction = read('cms_data/outreach.public.json')['021309'].correction;
  const result = reconcileManual([standing], { '021309': { correction } }, [proof])[0];
  assert.equal(proof.ccn, '021309');
  assert.equal(standing.finding, 'not-applicable-indian-health-program');
  assert.equal(result.disposition, 'later-observation-supports-scope-exemption');
  assert.deepEqual(result.differences, ['verdict']);
  assert.equal(result.manual_mrf_url, '');
  assert.match(result.next_action, /prior route-level 404 observations/i);
  const generated = read('data/hpt-audit/manual-correction-reconciliation.json').records.find(row => row.ccn === '021309');
  assert.equal(generated.disposition, 'later-observation-supports-scope-exemption');
});
test('a later official-page observation corroborates a factual dead-link report without adopting its legal verdict', () => {
  const standing = { ccn: '021309', hospital_name: 'KANAKANAK', finding: 'not-assessed-nationwide-pointer-not-retrieved', checked_at: '2026-09-15' };
  const input = { '021309': { correction: { verdict: 'failing', checkedOn: '2026-09-01' } } };
  const observations = [{ ccn: '021309', observed_at: '2026-09-15T15:05:00Z',
    disposition: 'current-official-page-links-dead-pricing-resource', next_action: 'Recheck exact links.' }];
  const result = reconcileManual([standing], input, observations)[0];
  assert.equal(result.disposition, 'later-observation-corroborates-factual-access-issue');
  assert.equal(result.next_action, 'Recheck exact links.');
  assert.ok(result.differences.includes('verdict'));
});
test('a bounded archive observation can corroborate a factual metadata gap without claiming full-file absence', () => {
  const standing = { ccn: '040780', hospital_name: 'EUREKA', finding: 'not-assessed-nationwide-pointer-not-retrieved', checked_at: '2026-09-15' };
  const input = { '040780': { correction: { verdict: 'failing', checkedOn: '2026-09-04' } } };
  const observations = [{ ccn: '040780', observed_at: '2026-09-15T15:10:56Z',
    disposition: 'current-official-page-links-file-with-bounded-metadata-gap', next_action: 'Inspect only after change.' }];
  const result = reconcileManual([standing], input, observations)[0];
  assert.equal(result.disposition, 'later-observation-corroborates-factual-access-issue');
  assert.equal(result.next_action, 'Inspect only after change.');
});
test('a current official workbook link and missing root pointer corroborate facts without adopting a verdict', () => {
  const standing = { ccn: '021305', hospital_name: 'WRANGELL', finding: 'not-assessed-nationwide-pointer-not-retrieved', checked_at: '2026-09-15' };
  const input = { '021305': { correction: { verdict: 'failing', checkedOn: '2026-09-01' } } };
  const observations = [{ ccn: '021305', observed_at: '2026-09-15T15:14:13Z',
    disposition: 'current-official-page-links-unsupported-workbook-with-missing-root-pointer', next_action: 'Recheck after change.' }];
  const result = reconcileManual([standing], input, observations)[0];
  assert.equal(result.disposition, 'later-observation-corroborates-factual-access-issue');
  assert.equal(result.next_action, 'Recheck after change.');
});
test('an official source page stored as pointerUrl is reconciled without changing standing evidence', () => {
  const standing = { ccn: '340041', hospital_name: 'CALDWELL', finding: 'compliant-observed', checked_at: '2026-08-28',
    mrf_url: 'https://hospital.test/caldwell.csv', mrf_last_updated: '2026-06-04', cms_template_version: '3.0.0', pointer_url: 'https://hospital.test/cms-hpt.txt' };
  const input = { '340041': { correction: { verdict: 'compliant', checkedOn: '2026-08-30',
    mrfUrl: standing.mrf_url, lastUpdatedOn: standing.mrf_last_updated, templateVersion: standing.cms_template_version,
    pointerUrl: 'https://hospital.test/standard-charges' } } };
  const observations = [{ ccn: '340041', observed_at: '2026-09-15T15:22:00Z',
    disposition: 'current-official-source-page-confirms-standing-file-and-manual-field-role',
    pricing_resource_url: standing.mrf_url, next_action: 'Retain source-page provenance.' }];
  const result = reconcileManual([standing], input, observations)[0];
  assert.equal(result.disposition, 'source-page-field-role-reconciled');
  assert.equal(result.next_action, 'Retain source-page provenance.');
  assert.deepEqual(result.differences, ['pointer-url']);
});
test('a renamed facility is not assigned the current operator main-campus file', () => {
  const standing = { ccn: '370097', hospital_name: 'SOUTHWESTERN', finding: 'not-assessed-nationwide-pointer-discovery-incomplete', checked_at: '2026-09-15' };
  const input = { '370097': { correction: { verdict: 'failing', checkedOn: '2026-09-09', pointerUrl: 'https://old.test/cms-hpt.txt' } } };
  const observations = [{ ccn: '370097', observed_at: '2026-09-15T15:34:37Z',
    disposition: 'current-operator-file-does-not-identify-former-campus', next_action: 'Require a campus-specific file.' }];
  const result = reconcileManual([standing], input, observations)[0];
  assert.equal(result.disposition, 'later-observation-corroborates-factual-access-issue');
  assert.equal(result.next_action, 'Require a campus-specific file.');
});
test('an official rates PDF and pointer 404s corroborate facts without proving MRF absence', () => {
  const standing = { ccn: '024002', hospital_name: 'API', finding: 'not-assessed-nationwide-pointer-discovery-incomplete', checked_at: '2026-09-15' };
  const input = { '024002': { correction: { verdict: 'failing', checkedOn: '2026-09-02' } } };
  const observations = [{ ccn: '024002', observed_at: '2026-09-15T15:38:00Z',
    disposition: 'current-official-page-exposes-pdf-and-pointer-paths-return-404', next_action: 'Recheck after publisher change.' }];
  const result = reconcileManual([standing], input, observations)[0];
  assert.equal(result.disposition, 'later-observation-corroborates-factual-access-issue');
  assert.equal(result.next_action, 'Recheck after publisher change.');
});

test('a documented facility relocation and current pointer 404s remain factual observations', () => {
  const standing = { ccn: '014012', hospital_name: 'Mary S Harper', finding: 'not-assessed-nationwide-pointer-not-retrieved', checked_at: '2026-09-15' };
  const input = { '014012': { correction: { verdict: 'failing', checkedOn: '2026-09-04' } } };
  const observations = [{ ccn: '014012', observed_at: '2026-09-15T16:02:00Z',
    disposition: 'current-official-page-confirms-relocated-identity-with-no-visible-mrf-and-pointer-404s', next_action: 'Recheck after publisher change.' }];
  const result = reconcileManual([standing], input, observations)[0];
  assert.equal(result.disposition, 'later-observation-corroborates-factual-access-issue');
  assert.equal(result.next_action, 'Recheck after publisher change.');
});

test('a publisher statement that its MRF is not yet posted remains a factual observation', () => {
  const standing = { ccn: '040781', hospital_name: 'Helena Regional', finding: 'not-assessed-nationwide-pointer-not-retrieved', checked_at: '2026-09-15' };
  const input = { '040781': { correction: { verdict: 'failing', checkedOn: '2026-09-04' } } };
  const observations = [{ ccn: '040781', observed_at: '2026-09-15T16:10:00Z',
    disposition: 'current-official-pricing-page-says-machine-readable-file-not-yet-posted-and-pointer-404s', next_action: 'Recheck the exact page after it changes.' }];
  const result = reconcileManual([standing], input, observations)[0];
  assert.equal(result.disposition, 'later-observation-corroborates-factual-access-issue');
  assert.equal(result.next_action, 'Recheck the exact page after it changes.');
});

test('a complete identity-matched file with pointer linkage pending closes the generic manual conflict only', () => {
  const standing = { ccn: '024001', hospital_name: 'North Star', finding: 'not-assessed-nationwide-pointer-discovery-incomplete', checked_at: '2026-09-15' };
  const input = { '024001': { correction: { verdict: 'compliant', checkedOn: '2026-09-01', mrfUrl: 'https://files.test/northstar.csv' } } };
  const observations = [{ ccn: '024001', observed_at: '2026-09-15T14:50:53Z',
    disposition: 'direct-file-identity-corroborated-pointer-linkage-pending', next_action: 'Require exact pointer linkage.' }];
  const result = reconcileManual([standing], input, observations)[0];
  assert.equal(result.disposition, 'later-observation-supports-explicit-uncertainty');
  assert.equal(result.next_action, 'Require exact pointer linkage.');
  assert.ok(result.differences.includes('mrf-url'));
});

test('a later applied Royal Oak review reconciles the manual pointer URL without calling it the campus file', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.resolve(__dirname, '../../..');
  const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  const resolution = read('data/hpt-audit/reviewed-resolutions.json').find(row => row.ccn === '230130');
  const standing = require('../lib/reviewed-resolutions').loadReviewedView(path.join(root, 'data/hpt-audit'))
    .compliance.find(row => row.ccn === '230130');
  const correction = read('cms_data/outreach.public.json')['230130'].correction;
  const input = { '230130': { correction } };
  const resolved = reconcileManual([standing], input, [], [resolution])[0];
  assert.equal(resolved.disposition, 'reviewed-pointer-file-role-reconciled');
  assert.equal(resolved.manual_url_role, 'pointer-declared file with different facility identity');
  assert.equal(resolved.standing_url_role, 'separately first-party-page-linked file for this campus');
  assert.equal(resolved.next_action, resolution.evidence.next_action);
  assert.equal(reconcileManual([standing], input)[0].disposition, 'evidence-review-required');
  const wrongFile = { ...resolution, evidence: { ...resolution.evidence, pointerMrfUrl: 'https://example.test/wrong.csv' } };
  assert.equal(reconcileManual([standing], input, [], [wrongFile])[0].disposition, 'evidence-review-required');
  const generated = read('data/hpt-audit/manual-correction-reconciliation.json').records.find(row => row.ccn === '230130');
  const reconciliation = read('data/hpt-audit/nationwide-reconciliation.json');
  assert.equal(generated.disposition, 'reviewed-pointer-file-role-reconciled');
  assert.equal(reconciliation.records.find(row => row.ccn === '230130').workstream, 'standing-evidence-follow-up');
  assert.equal(reconciliation.summary.workstreams['other-reconciliation'] || 0,
    reconciliation.records.filter(row => row.workstream === 'other-reconciliation').length);
});
