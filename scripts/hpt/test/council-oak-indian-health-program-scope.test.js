'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { csvToObjects } = require('../lib/util');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('Council Oak exact CCN scope review preserves separate MRF uncertainty', () => {
  const proof = JSON.parse(fs.readFileSync(path.join(audit,
    'reconciliation-council-oak-indian-health-program-scope-proof-2026-09-28.json'), 'utf8'));
  assert.equal(proof.ccn, '370244');
  assert.equal(proof.disposition, 'scope-exempt-indian-health-program');
  assert.equal(proof.mrf_recovered, false);
  assert.match(proof.legal_basis.regulation, /180\.30\(b\)\(2\)/);
  const retained = fs.readFileSync(path.resolve(root, 'data/hpt-audit', proof.cms_provider_record.retained_response));
  assert.equal(crypto.createHash('sha256').update(retained).digest('hex'), proof.cms_provider_record.response_sha256);
  assert.equal(retained.length, proof.cms_provider_record.response_bytes);

  const row = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(item => item.ccn === '370244');
  assert.equal(row.finding, 'not-applicable-indian-health-program');
  assert.equal(row.assessable, 'no');
  assert.equal(row.pointer_url, '');
  assert.equal(row.mrf_url, '');

  const { loadReviewedView } = require('../lib/reviewed-resolutions');
  const reviewed = loadReviewedView(audit).compliance.find(item => item.ccn === '370244');
  assert.equal(reviewed.finding, 'not-applicable-indian-health-program');
  assert.equal(reviewed.assessable, 'no');

  const manual = JSON.parse(fs.readFileSync(path.join(audit,
    'reconciliation-manual-access-observations.json'), 'utf8'));
  const prior = manual.records.find(item => item.ccn === '370244'
    && item.proof_file === 'reconciliation-creekhealth-okmulgee-full-file-proof-2026-09-19.json');
  assert.equal(prior.pointer_file_declared_address, '1401 Morris Dr Okmulgee OK 74447');
  assert.equal(prior.latest_indian_health_program_scope_2026_09_28.mrf_recovered, false);
  assert.equal(prior.latest_indian_health_program_scope_2026_09_28.count_effect, -1);

  const browser = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-browser-reviews.json'), 'utf8'));
  assert.equal(browser.records.filter(item => item.ccn === '370244'
    && item.kind === 'exact-ccn-indian-health-program-operator-review').length, 1);
  const search = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-search-reviews.json'), 'utf8'));
  const searchRow = search.records.find(item => item.ccn === '370244');
  assert.equal(searchRow.status, 'official');
  assert.ok(searchRow.history.some(item => item.observed_at === '2026-09-15T00:00:00Z'));

  const plan = fs.readFileSync(path.join(audit, 'accuracy-plan.md'), 'utf8');
  assert.match(plan, /891 unresolved effect: -1; 544 → 543/);
  assert.match(plan, /Canonical rebuild checkpoint/);
  assert.match(plan, /543 unresolved \/ 15 scope-exempt/);
});
