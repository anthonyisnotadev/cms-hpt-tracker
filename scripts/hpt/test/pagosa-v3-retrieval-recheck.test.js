'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit,
  'reconciliation-pagosa-springs-current-portal-mrf-proof.json'), 'utf8'));
const recheck = JSON.parse(fs.readFileSync(path.join(audit,
  'reconciliation-pagosa-mrf-retrieval-recheck-2026-09-30.json'), 'utf8'));
const worklist = JSON.parse(fs.readFileSync(path.join(audit, 'unresolved-investigation-worklist.json'), 'utf8'));
const reconciliation = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-reconciliation.json'), 'utf8'));
const plan = fs.readFileSync(path.join(audit, 'accuracy-plan.md'), 'utf8');
const row = worklist.records.find(record => record.ccn === '061328');
const reconciled = reconciliation.records.find(record => record.ccn === '061328');

assert.equal(proof.mrf_declared_version, '3.0.0');
assert.equal(recheck.ccn, proof.ccn);
assert.equal(recheck.mrf_url, proof.mrf_url);
assert.equal(recheck.http_status, 404);
assert.equal(recheck.bytes_retrieved, 0);
assert.equal(recheck.expected_prior_sha256, proof.mrf_sha256);
assert.equal(recheck.current_mrf_validation, 'not-performed-no-file-bytes');
assert.equal(recheck.disposition_effect, 'none');
assert.equal(recheck.count_effect, 'none');
assert.equal(recheck.pointer_observation.kept_separate, true);
assert.match(row.next_action, /materially new official portal URL or publisher-provided current file bytes/i);
assert.match(row.next_action, /CMS validator against v3\.0/);
assert.equal(reconciled.next_action, row.next_action,
  'reconciliation and prioritized worklist use the same current action for Pagosa');
assert.match(plan, /CMS version 3 requirement and Pagosa retrieval recheck/);
assert.match(plan, /not proof the MRF is absent/i);

console.log('Pagosa v3 retrieval recheck tests passed.');
