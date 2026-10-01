'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const readJson = file => JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit', file), 'utf8'));

test('HSS third-party fingerprint remains a lead, not local source-file verification or resolution', () => {
  const proof = readJson('reconciliation-hss-third-party-exact-file-audit-trail-lead-2026-09-28.json');
  const report = readJson('nationwide-verification.json');
  const queue = readJson('unresolved-investigation-worklist.json');
  const manual = readJson('reconciliation-manual-access-observations.json');
  const browser = readJson('nationwide-browser-reviews.json');
  const search = readJson('nationwide-search-reviews.json');
  const liveCheck = readJson('reconciliation-hss-live-page-pointer-recheck-2026-09-29.json');

  const record = report.records.find(item => item.ccn === proof.ccn);
  assert.equal(proof.ccn, '330270');
  assert.equal(proof.mrf_url, record.mrf_url);
  assert.equal(proof.third_party_claimed_file_sha256, '4651f43af8951420cb76cf1fe47f3e05cf02f461d1048eb106704731b7e6c2ee');
  assert.equal(proof.third_party_claimed_file_bytes, 4869712272);
  assert.equal(proof.third_party_parse_status, 'parsed');
  assert.equal(proof.local_source_bytes_retrieved, false);
  assert.equal(proof.official_cms_header_verified_locally, false);
  assert.equal(proof.tracker_imported, false);
  assert.equal(proof.disposition_changed, false);
  assert.equal(proof.cohort_unresolved_count_change, 0);
  assert.equal(queue.records.some(item => item.ccn === proof.ccn), true);

  const proofName = 'reconciliation-hss-third-party-exact-file-audit-trail-lead-2026-09-28.json';
  assert.equal(manual.records.find(item => item.ccn === proof.ccn)
    ?.latest_third_party_audit_trail_lead_2026_09_28?.proof_file, proofName);
  assert.equal(browser.records.some(item => item.ccn === proof.ccn && item.proof_file === proofName), true);
  assert.equal(search.records.some(item => item.ccn === proof.ccn && item.proof_file === proofName), true);

  assert.equal(liveCheck.ccn, proof.ccn);
  assert.equal(liveCheck.official_price_page.http_status, 200);
  assert.equal(liveCheck.official_pointer.http_status, 200);
  assert.equal(liveCheck.official_pointer.response_sha256, '50bc16f049f7606c91d38625f32508869d871bf9fa726ce4098cab8215dc30ce');
  const cachedPointer = fs.readFileSync(path.join(root, 'cms_data/hpt/pointer-corpus/raw/hss.edu-7db864155fa3.txt'));
  assert.equal(crypto.createHash('sha256').update(cachedPointer).digest('hex'), liveCheck.official_pointer.response_sha256);
  assert.equal(liveCheck.official_pointer.main_hospital_target_present, true);
  assert.equal(liveCheck.access_retry_policy.main_hospital_file_retried, false);
  assert.equal(liveCheck.disposition_changed, false);
  assert.equal(liveCheck.count_effect, 0);
  assert.equal(manual.records.find(item => item.ccn === proof.ccn)
    ?.latest_live_page_pointer_recheck_2026_09_29?.proof_file,
  'reconciliation-hss-live-page-pointer-recheck-2026-09-29.json');
  assert.equal(Date.parse(queue.records.find(item => item.ccn === proof.ccn)?.latest_review_at), Date.parse(liveCheck.observed_at));
});
