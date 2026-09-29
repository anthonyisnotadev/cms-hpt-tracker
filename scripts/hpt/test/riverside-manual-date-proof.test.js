'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { extractDeclared, toISODate } = require('../lib/probe');
const { reconcileManual } = require('../lib/manual-reconciliation');

const root = path.resolve(__dirname, '../../..');
const read = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));

test('Riverside manual date is historical after a later same-URL, identity-matched file sample', () => {
  const proof = read('data/hpt-audit/reconciliation-riverside-manual-date-proof.json');
  const sample = fs.readFileSync(path.join(root,
    'cms_data/hpt/nationwide-verification/file-byte-proof', `${proof.retained_sample_sha256}.bin`));
  assert.equal(crypto.createHash('sha256').update(sample).digest('hex'), proof.retained_sample_sha256);
  const parsed = extractDeclared(sample, 'csv');
  assert.equal(toISODate(parsed.raw), proof.later_declared_date);
  assert.equal(parsed.address, proof.later_declared_address);
  const manual = read('cms_data/outreach.public.json')[proof.ccn];
  const reconciliation = read('data/hpt-audit/nationwide-reconciliation.json').records
    .find(row => row.ccn === proof.ccn);
  const result = read('data/hpt-audit/manual-correction-reconciliation.json').records
    .find(row => row.ccn === proof.ccn);
  assert.equal(manual.correction.lastUpdatedOn, proof.manual_date);
  assert.equal(result.disposition, 'superseded-by-later-file-evidence');
  assert.equal(result.standing_date, proof.later_declared_date);
  assert.equal(reconciliation.workstream, 'consistent');
  assert.equal(reconciliation.manual_access_observation.retained_sample_sha256, proof.retained_sample_sha256);
  const withoutProof = reconcileManual([{ ccn: proof.ccn, hospital_name: 'Riverside',
    finding: 'mrf-template-version-noncanonical', mrf_url: proof.mrf_url,
    mrf_last_updated: proof.later_declared_date, checked_at: '2026-09-06T19:56:59.258Z' }],
  { [proof.ccn]: { correction: manual.correction } });
  assert.equal(withoutProof[0].disposition, 'evidence-review-required');
});
