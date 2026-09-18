'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('Mercy Hospital Southeast replaces the unrelated clinic header with an exact pointer-linked state-field conflict', () => {
  const proof = require(path.join(audit, 'reconciliation-mercy-southeast-license-state-proof.json'));
  const resolution = require(path.join(audit, 'reviewed-resolutions.json'))
    .find(row => row.ccn === proof.ccn);
  assert.equal(proof.roster_address, '1701 LACEY ST');
  assert.equal(proof.facility_state, 'MO');
  assert.equal(proof.declared_address, '1701 Lacey St Cape Girardeau MO 63701');
  assert.equal(proof.declared_license_state, 'OK');
  assert.equal(proof.declared_date, '2026-06-11');
  assert.equal(proof.declared_version, '3.0.0');
  assert.ok(proof.pointer_entry_without_contacts.includes(`mrf-url: ${proof.file_url}`));
  assert.equal(resolution.action, 'replace-observation');
  assert.equal(resolution.evidence.observedFinding, 'mrf-license-state-field-conflicts-facility');
  const view = loadReviewedView(audit);
  assert.equal(view.compliance.find(row => row.ccn === proof.ccn).finding,
    'mrf-license-state-field-conflicts-facility');
  assert.equal(view.history[proof.ccn].finding, 'not-assessed-not-named-in-file');
  assert.equal(fs.existsSync(path.join(audit, 'pointers/mercy.net.txt')), true);
});
