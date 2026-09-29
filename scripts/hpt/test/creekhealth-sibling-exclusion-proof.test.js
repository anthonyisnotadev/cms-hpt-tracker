'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parsePayload } = require('../lib/recovery-transport');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('Creekhealth Okmulgee pointer file is not assigned to Tulsa or Okemah CCNs', async () => {
  const proof = require(path.join(audit, 'reconciliation-creekhealth-sibling-exclusion-proof.json'));
  const ledger = require(path.join(audit, 'reconciliation-manual-access-observations.json')).records;
  const verification = require(path.join(audit, 'nationwide-verification.json')).records;
  const worklist = require(path.join(audit, 'unresolved-investigation-worklist.json')).records;
  const tracker = loadReviewedView(audit).compliance;
  const sample = fs.readFileSync(path.join(root, proof.retained_sample));
  assert.equal(crypto.createHash('sha256').update(sample).digest('hex'), proof.sample_sha256);
  assert.equal(sample.length, 262144);
  assert.equal(proof.pointer_entry_without_contacts.length, 3);
  assert.ok(proof.pointer_entry_without_contacts.includes(`mrf-url: ${proof.pointer_file_url}`));
  const parsed = (await parsePayload(sample, 'text/csv')).parsed.find(item => item.innerKind === 'csv');
  assert.equal(parsed.mrfHospitalName, 'MUSCOGEE (CREEK) NATION MEDICAL CENTER');
  assert.equal(parsed.mrfAddress, '1401 Morris Dr Okmulgee OK 74447');
  assert.equal(parsed.mrfLicenseState, 'OK');
  assert.equal(parsed.declaredLastUpdated, '2026-01-24');
  assert.equal(parsed.cmsVersion, '3.00');
  assert.match(proof.pricing_page_file_lead_url, /\.xlsx$/);
  for (const ccn of ['370244', '371333']) {
    const page = proof.facility_pages.find(item => item.ccn === ccn);
    const observation = ledger.find(item => item.ccn === ccn);
    const nationwide = verification.find(item => item.ccn === ccn);
    const queued = worklist.find(item => item.ccn === ccn);
    const row = tracker.find(item => item.ccn === ccn);
    assert.equal(nationwide.pointer_corpus_sha256, proof.pointer_sha256);
    assert.notEqual(page.address, proof.file_declared_address);
    assert.equal(observation.official_facility_address, page.address);
    assert.equal(observation.pointer_file_sample_sha256, proof.sample_sha256);
    if (ccn === '370244') {
      assert.equal(queued, undefined, 'scope-exempt CCN is no longer in the unresolved MRF worklist');
      assert.equal(nationwide.disposition, 'scope-exempt-indian-health-program');
      assert.equal(row.finding, 'not-applicable-indian-health-program');
      assert.equal(observation.latest_indian_health_program_scope_2026_09_28.mrf_recovered, false);
    } else {
      assert.equal(queued.current_disposition, observation.disposition);
      assert.equal(queued.nationwide_disposition, nationwide.disposition);
      assert.equal(queued.evidence_gate, 'facility-specific-pointer-and-file');
      assert.match(queued.next_action, /do not assign the Okmulgee file/);
      assert.equal(row.finding, 'not-assessed-nationwide-pointer-facility-match-unresolved');
    }
    assert.notEqual(row.mrf_url, proof.pointer_file_url);
  }
});
