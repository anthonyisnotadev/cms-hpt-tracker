const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const proof = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/reconciliation-helen-keller-current-price-page-recheck-proof.json'), 'utf8'));

test('Helen Keller current page retains separate exact CSV lead without promotion', () => {
  assert.equal(proof.ccn, '010019');
  assert.equal(proof.linked_facility, 'Helen Keller Hospital');
  assert.match(proof.linked_mrf_url, /472323163_hellen-keller-hospital_standardcharges\.csv$/);
  assert.equal(proof.linked_mrf_fetch_status, 'transport-unverified');
  assert.equal(proof.disposition, 'facility-specific-page-and-file-lead-retained');
});

test('Helen Keller 2026-09-27 recheck distinguishes current linked URL from legacy 404 and retains uncertainty', () => {
  const latest = proof.latest_source_check_2026_09_27;
  assert.equal(latest.source_url, 'https://hh2026.cloudaccess.host/patients-visitors/price-transparency/');
  assert.equal(latest.page_content_last_updated, '2026-08-20');
  assert.match(latest.result, /separate standard-charge-file row/);
  assert.match(latest.result, /unexpected EOF before response bytes/);
  assert.match(latest.legacy_url_recheck, /returns HTTP 404/);
  assert.equal(latest.disposition, 'retain-unresolved-exact-facility-file-link-transport-unavailable');
  assert.match(latest.next_action, /Do not substitute the 404 legacy URL, Huntsville\/Red Bay files/);
  assert.match(latest.evidence_role, /no file bytes, metadata, pointer linkage, MRF promotion, or compliance conclusion/);
});

test('Helen Keller 2026-09-30 official domain migration adds a new file route without promoting unobserved bytes', () => {
  const latest = proof.latest_official_domain_migration_route_discovery_2026_09_30;
  assert.ok(latest);
  assert.match(latest.source_chain.join(' '), /https:\/\/hh\.health\/patients-visitors\/price-transparency\//);
  assert.match(latest.source_chain.join(' '), /https:\/\/hh\.health\/wp-content\/uploads\/472323163_hellen-keller-hospital_standardcharges\.csv/);
  assert.equal(latest.retrieval_observations.web_reader_file_click, 'Recognized text/csv but returned unsupported content-type before file content; no bytes or metadata captured.');
  assert.equal(latest.new_file_bytes_or_hash, false);
  assert.equal(latest.disposition_effect, 'none');
  assert.equal(latest.count_effect, 0);
  const current = proof.latest_page_file_recheck_2026_09_30;
  assert.ok(current);
  assert.equal(current.bounded_file_request.client_result, 'EAI_AGAIN');
  assert.equal(current.bounded_file_request.http_status, null);
  assert.equal(current.bounded_file_request.body_bytes, 0);
  assert.equal(current.disposition_effect, 'none; retain pointer-discovery-incomplete and the exact-file access gate');
  assert.match(latest.next_action, /retrieve that exact file and retain bytes\/hash/);
  assert.match(proof.next_action, /newly published first-party route/);

  const audit = path.join(root, 'data/hpt-audit');
  const manual = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-manual-access-observations.json'), 'utf8'))
    .records.find(row => row.ccn === '010019');
  const work = JSON.parse(fs.readFileSync(path.join(audit, 'unresolved-investigation-worklist.json'), 'utf8'))
    .records.find(row => row.ccn === '010019');
  const reconciliation = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-reconciliation.json'), 'utf8'))
    .records.find(row => row.ccn === '010019');
  assert.equal(manual.latest_official_domain_migration_route_discovery_2026_09_30.next_action, latest.next_action);
  assert.equal(manual.next_action, latest.next_action, 'source observation preserves its recorded discovery action');
  assert.equal(manual.latest_page_file_recheck_2026_09_30.observed_at, current.observed_at);
  assert.match(work.next_action, /Do not retry the unchanged hh\.health route until DNS\/access changes/);
  assert.match(work.next_action, /After recovery, retrieve https:\/\/hh\.health\/wp-content\/uploads\/472323163_hellen-keller-hospital_standardcharges\.csv/);
  assert.equal(reconciliation.next_action, work.next_action, 'effective unresolved worklist carries the current evidence-gated action');
  assert.equal(work.current_disposition, 'pointer-discovery-incomplete');
});
