'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const { metadataState } = require('../build-nationwide-verification');

function ageAtSnapshot(value, snapshotTime) {
  const input = String(value || '').trim();
  let year;
  let month;
  let day;
  if (input.includes('-')) [year, month, day] = input.split('-').map(Number);
  else if (input.includes('/')) [month, day, year] = input.split('/').map(Number);
  else return null;
  const date = Date.UTC(year, month - 1, day);
  const normalized = new Date(date);
  if (normalized.getUTCFullYear() !== year || normalized.getUTCMonth() !== month - 1 ||
      normalized.getUTCDate() !== day) return null;
  return Math.floor((snapshotTime - date) / 86_400_000);
}

test('freshness is recalculated at snapshot time instead of frozen at cached header probe time', () => {
  const atSnapshot = Date.parse('2026-09-30T09:56:06.885Z');
  const stale = { mrf_last_updated: '2025-09-26', mrf_days_since_update: 354,
    mrf_stale_over_365: 'false', mrf_cms_version: '3.0.0' };
  assert.equal(metadataState(stale, atSnapshot), 'verified-stale-date');
  assert.equal(metadataState({ ...stale, mrf_last_updated: '2025-09-30', mrf_days_since_update: 365 }, atSnapshot),
    'verified-current-v3', 'the operational cutoff is strictly greater than 365 days');
  assert.equal(metadataState({ ...stale, mrf_last_updated: '2026-06-01', mrf_stale_over_365: 'yes' }, atSnapshot),
    'verified-current-v3', 'a cached stale flag cannot override a newer declared file date');
  assert.equal(metadataState({ ...stale, mrf_last_updated: '3/25/2026', mrf_days_since_update: 999 }, atSnapshot),
    'verified-current-v3', 'a US-formatted declared date is parsed instead of stale cached age');
  assert.equal(metadataState({ ...stale, mrf_last_updated: '9/26/2025', mrf_days_since_update: 354,
    mrf_stale_over_365: 'false' }, atSnapshot), 'verified-stale-date',
  'a US-formatted declared date ages past the cutoff even when cached metadata says otherwise');
});

test('four unchanged pointer-linked v3 file headers age into stale status without losing exact versions or provenance', () => {
  const proof = JSON.parse(fs.readFileSync(path.join(audit,
    'reconciliation-v3-stale-date-rechecks-2026-09-30.json'), 'utf8'));
  const verification = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-verification.json'), 'utf8'));
  const byCcn = new Map(verification.records.map(row => [row.ccn, row]));
  assert.deepEqual(proof.records.map(row => row.ccn).sort(), ['050028', '260006', '261328', '261340']);
  for (const source of proof.records) {
    const row = byCcn.get(source.ccn);
    assert.equal(source.range_unchanged, true, source.ccn);
    assert.equal(source.cms_template_version, '3.0.0', source.ccn);
    assert.equal(row.disposition, 'verified-stale-mrf', source.ccn);
    assert.equal(row.cms_template_version, source.cms_template_version, source.ccn);
    assert.equal(row.declared_last_updated, source.declared_last_updated, source.ccn);
    assert.equal(row.declared_file_age_days, source.age_days_as_of_observation, source.ccn);
    assert.equal(row.freshness_assessed_at, verification.summary.generated_at, source.ccn);
  }
  const madRiver = byCcn.get('050028');
  assert.equal(madRiver.pointer_observed_at, '2026-09-26T05:00:00Z',
    'pointer and file observation timestamps stay distinct');
  assert.equal(madRiver.observed_at, proof.observed_at);
  assert.equal(madRiver.mrf_state, 'linked-file-retrieved-metadata-limited',
    'HTTP 206 is a bounded retrieval, not a transport failure');
});

test('every current and stale classification agrees with its declared date at the snapshot time', () => {
  const verification = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-verification.json'), 'utf8'));
  const snapshotTime = Date.parse(verification.summary.generated_at);
  const current = verification.records.filter(row => row.disposition === 'verified-current-mrf');
  const stale = verification.records.filter(row => row.disposition === 'verified-stale-mrf');

  assert.equal(verification.records.length, 5419);
  assert.equal(new Set(verification.records.map(row => row.ccn)).size, 5419);
  for (const row of current) {
    const age = ageAtSnapshot(row.declared_last_updated, snapshotTime);
    assert.ok(age !== null && age >= 0 && age <= 365,
      `${row.ccn}: current disposition has invalid, future, or >365-day declared date ${row.declared_last_updated}`);
    assert.ok(['3', '3.0', '3.00', '3.0.0'].includes(String(row.cms_template_version || '').trim()),
      `${row.ccn}: current disposition is not a CMS v3 literal (${row.cms_template_version})`);
    assert.equal(row.declared_file_age_days, age, `${row.ccn}: serialized age matches the declared date`);
    assert.equal(row.freshness_assessed_at, verification.summary.generated_at, `${row.ccn}: age uses snapshot time`);
  }
  for (const row of stale) {
    const age = ageAtSnapshot(row.declared_last_updated, snapshotTime);
    assert.ok(age !== null && age > 365,
      `${row.ccn}: stale disposition does not have a valid >365-day declared date ${row.declared_last_updated}`);
  }
});
