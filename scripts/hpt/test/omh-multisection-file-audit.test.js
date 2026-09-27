'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { build, parseSections } = require('../audit-omh-multisection-file');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const read = name => JSON.parse(fs.readFileSync(path.join(audit, name), 'utf8'));
const proofFile = 'reconciliation-omh-multisection-file-audit-2026-09-27.json';
const proof = read(proofFile);
const rawFile = fs.readFileSync(path.join(audit, '.domain-discovery/reconciliation/omh-shared/file.bin'));

test('quote-aware parser discovers all independent OMH facility sections, not just the first metadata block', () => {
  const sections = parseSections(rawFile);
  assert.equal(crypto.createHash('sha256').update(rawFile).digest('hex'), proof.source.current_full_file_sha256);
  assert.equal(sections.length, 20);
  assert.equal(sections[0].section_name, 'Greater Binghamton Mental Health Facility');
  const elmira = sections.find(section => section.section_name === 'Elmira Psychiatric Center');
  assert.ok(elmira);
  assert.equal(elmira.location_name, 'Elmira');
  assert.equal(elmira.address, '100 Washington Street, Elmira, NY 14901');
  assert.equal(elmira.declared_date_raw, '5/28/2026');
  assert.equal(elmira.version, '3.0.0');
  assert.equal(elmira.attestation, true);
  assert.equal(elmira.columns, 51);
  assert.equal(elmira.data_rows, 101);
  assert.deepEqual(elmira.row_widths, [51]);
  assert.equal(elmira.malformed_row_widths, 0);
  assert.ok(elmira.usable_gross_charge_rows > 0);
  assert.equal(elmira.license_state, 'NY');
});
test('the complete historical OMH unresolved cohort is crosswalked to exact sections and conservative residuals', () => {
  const generated = build();
  assert.deepEqual(generated, proof);
  assert.deepEqual(proof.counts, {
    historical_unresolved_ccns_reviewed: 14,
    exact_facility_sections_confirmed: 11,
    already_supported_reviewed_findings: 5,
    newly_supported_reviewed_findings: 6,
    remain_unresolved: 3,
  });
  const confirmed = proof.records.filter(record => record.finding === 'facility-specific-current-mrf-section-confirmed');
  assert.deepEqual(confirmed.map(record => record.ccn).sort(), [
    '334003', '334013', '334015', '334021', '334043', '334045', '334046', '334052', '334053', '334064', '334065',
  ]);
  const creedmoor = proof.records.find(record => record.ccn === '334004');
  assert.equal(creedmoor.checks.file_address_matches_cms_or_first_party_identity, false);
  assert.match(creedmoor.file_section.address, /79-25 Winchester/);
  assert.match(creedmoor.cms_address, /80-45 WINCHESTER/);
  assert.match(creedmoor.next_action, /79-25 Winchester Boulevard.*80-45 Winchester Blvd, Building B/);
  assert.deepEqual(proof.records.filter(record => record.ccn === '334060' || record.ccn === '334061')
    .map(record => record.file_section), [null, null]);
});

test('reviewed overlays promote six new cases, refresh five prior findings, and later reconcile one historical residual', () => {
  const ledger = read('reviewed-resolutions.json');
  const resolutions = ledger.filter(record => proof.records.some(item => item.ccn === record.ccn));
  assert.equal(resolutions.length, 12);
  assert.equal(resolutions.filter(record => record.evidence_run === 'omh-multisection-current-pointer-file-cms-roster-crosswalk-2026-09-27').length, 11);
  assert.equal(resolutions.filter(record => record.prior_review).length, 5);
  assert.ok(resolutions.every(record => record.finding === 'verified-current-mrf'
    && record.evidence?.fileSha256.toLowerCase() === proof.source.current_full_file_sha256
    && record.evidence?.fileSectionCount === 20
    && record.evidence?.attestationPresent === true
    && !Object.hasOwn(record.evidence || {}, 'declared_npi')));
  for (const ccn of ['334004', '334060', '334061'])
    assert.ok(!resolutions.some(record => record.ccn === ccn && record.evidence_run === 'omh-multisection-current-pointer-file-cms-roster-crosswalk-2026-09-27'));

  const manual = read('reconciliation-manual-access-observations.json');
  const latest = new Map();
  for (const record of manual.records) {
    const prior = latest.get(record.ccn);
    if (!prior || Date.parse(record.observed_at || '') >= Date.parse(prior.observed_at || '')) latest.set(record.ccn, record);
  }
  for (const item of proof.records) {
    const expectedProof = item.ccn === '334004'
      ? 'reconciliation-creedmoor-current-enrollment-address-proof-2026-09-27.json'
      : proofFile;
    assert.equal(latest.get(item.ccn)?.proof_file, expectedProof);
  }

  const browser = read('nationwide-browser-reviews.json');
  assert.ok(browser.records.some(record => record.kind === 'mrf-multisection-audit'
    && record.target === proof.source.shared_file_url && record.file_sha256 === proof.source.current_full_file_sha256));
  assert.ok(browser.records.filter(record => record.target === proof.source.shared_file_url
    && record.kind === 'mrf' && record.superseded_interpretation_by === proofFile).length >= 1);
});
