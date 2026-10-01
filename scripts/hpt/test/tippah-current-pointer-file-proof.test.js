'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { csvToObjects } = require('../lib/util');
const { sha } = require('../lib/recovery-transport');

const ROOT = path.resolve(__dirname, '../../..');
const AUDIT = path.join(ROOT, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(AUDIT, 'reconciliation-tippah-current-pointer-file-proof-2026-09-30.json'), 'utf8'));
const raw = fs.readFileSync(path.join(ROOT, proof.retained_file));
const file = JSON.parse(raw.toString('utf8'));
const pointer = fs.readFileSync(path.join(ROOT, proof.retained_pointer), 'utf8');

test('Tippah current pointer and complete CMS v3 file are retained and identity-bound', () => {
  const base = csvToObjects(fs.readFileSync(path.join(AUDIT, 'compliance.csv'), 'utf8')).find(row => row.ccn === '251337');
  assert.deepEqual([base.hospital_name, base.city, base.state], ['TIPPAH COUNTY HOSPITAL', 'RIPLEY', 'MS']);
  assert.equal(sha(raw), proof.mrf_sha256);
  assert.equal(raw.length, proof.mrf_total_bytes);
  assert.equal(proof.mrf_total_bytes, proof.mrf_content_length);
  assert.equal(file.hospital_name.toLowerCase(), base.hospital_name.toLowerCase());
  assert.equal(file.last_updated_on, '2026-09-14');
  assert.equal(file.version, '3.0.0');
  assert.deepEqual(file.hospital_address, ['1005 City Avenue North, Ripley, MS 38663']);
  assert.equal(file.license_information.state, 'MS');
  assert.equal(file.license_information.license_number, '11159');
  assert.deepEqual(file.type_2_npi, ['1730578600']);
  assert.equal(file.attestation.confirm_attestation, true);
  assert.equal(proof.complete_file_cms_validator_run, false);
  assert.equal(proof.legal_compliance_conclusion, false);
});

test('the current homepage, rendered pricing link, and hash-retained root pointer form the recorded source chain', () => {
  const official = fs.readFileSync(path.join(ROOT, proof.retained_official_site));
  const pricing = fs.readFileSync(path.join(ROOT, proof.retained_source_page));
  const pointerArtifact = fs.readFileSync(path.join(ROOT, proof.retained_pointer));
  assert.equal(sha(official), proof.official_site_sha256);
  assert.equal(sha(pricing), proof.source_page_sha256);
  assert.equal(sha(pointerArtifact), proof.pointer_sha256);
  assert.ok(official.toString('utf8').includes(proof.official_site_linked_pricing_page));
  assert.match(pointer, /location-name:\s*Tippah County Hospital/i);
  assert.ok(pointer.includes(`source-page-url: ${proof.source_page_url}`));
  assert.ok(pointer.includes(`mrf-url: ${proof.mrf_url}`));
  assert.equal(proof.pointer_sha256, 'd819d1e69211dccf048359b4f325e7d60997052a917635427d465de2327f179b');
});

test('reviewed correction preserves the older 2.0.0 CSV as history rather than confusing it with the current JSON', () => {
  const ledger = JSON.parse(fs.readFileSync(path.join(AUDIT, 'reviewed-resolutions.json'), 'utf8'));
  const row = ledger.find(value => value.ccn === '251337');
  assert.ok(row);
  assert.equal(row.action, 'replace');
  assert.equal(row.finding, 'verified-current-mrf');
  assert.equal(row.evidence.version, '3.0.0');
  assert.equal(row.evidence.fileSha256, proof.mrf_sha256);
  assert.equal(row.evidenceHistory, undefined);
  assert.ok(row.evidence_history.some(item => item.version === '2.0.0' && item.date === '2025-07-29'));
  assert.ok(row.note.includes('No CMS validator run'));
  const reconciliation = JSON.parse(fs.readFileSync(path.join(AUDIT, 'nationwide-reconciliation.json'), 'utf8'))
    .records.find(value => value.ccn === '251337');
  assert.equal(reconciliation.proposed_disposition, 'verified-current-mrf');
  assert.equal(reconciliation.latest_observation_superseded, true);
  assert.equal(reconciliation.reconciliation_status, 'consistent-superseded-by-reviewed-resolution');
  assert.deepEqual(reconciliation.issues, []);
  const readable = JSON.parse(fs.readFileSync(path.join(AUDIT, 'readable-history-rewrites.json'), 'utf8'));
  assert.match(readable.findings['251337'].summary, /2026-09-14.*3\.0\.0/);
  assert.ok(readable.assessments['251337'].some(item => /2026 09 14/.test(item.summary) && /3\.0\.0/.test(item.summary)));
  assert.ok(readable.assessments['251337'].some(item => /2025-07-29/.test(item.summary) && /2\.0\.0/.test(item.summary)));
  const manual = JSON.parse(fs.readFileSync(path.join(AUDIT, 'reconciliation-manual-access-observations.json'), 'utf8'));
  const observation = manual.records.find(value => value.ccn === '251337');
  assert.ok(observation);
  assert.equal(observation.file_sha256, proof.mrf_sha256);
  assert.equal(observation.cms_template_version, '3.0.0');
});
