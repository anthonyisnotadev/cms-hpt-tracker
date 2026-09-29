'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const { records } = require(path.join(audit, 'reconciliation-ochsner-mississippi-state-proofs.json'));
const ledger = require(path.join(audit, 'reviewed-resolutions.json'));

test('Ochsner Mississippi campuses remain distinct with their LA license-field conflict', () => {
  assert.deepEqual(new Set(records.map(row => row.ccn)), new Set(['250069', '250162']));
  assert.equal(new Set(records.map(row => row.mrf_url)).size, 2);
  assert.equal(new Set(records.map(row => row.mrf_sample_sha256)).size, 2);
  const view = loadReviewedView(audit);
  for (const proof of records) {
    const sample = fs.readFileSync(path.join(root, proof.retained_sample));
    assert.equal(sample.length, 262144);
    assert.equal(crypto.createHash('sha256').update(sample).digest('hex'), proof.mrf_sample_sha256);
    assert.match(sample.toString('utf8', 0, 250), /license_number\|LA/);
    assert.equal(proof.roster_state, 'MS');
    assert.equal(proof.declared_license_state, 'LA');
    const resolution = ledger.find(row => row.ccn === proof.ccn);
    assert.equal(resolution.action, 'replace-observation');
    assert.equal(resolution.evidence.pointerUrl, proof.pointer_url);
    assert.equal(resolution.evidence.url, proof.mrf_url);
    assert.equal(resolution.evidence.observedFinding, 'mrf-license-state-field-conflicts-facility');
    const standing = view.compliance.find(row => row.ccn === proof.ccn);
    assert.equal(standing.finding, 'mrf-license-state-field-conflicts-facility');
    assert.equal(standing.mrf_url, proof.mrf_url);
    assert.equal(standing.domain, 'ochsner.org');
  }
  assert.match(records.find(row => row.ccn === '250162').hancock_address_suffix_caveat, /Blvd.*Road/);
});
