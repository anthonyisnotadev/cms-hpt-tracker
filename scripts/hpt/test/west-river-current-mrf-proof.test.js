'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { parseCSV } = require('../lib/util');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const readJson = file => JSON.parse(fs.readFileSync(path.join(audit, file), 'utf8'));

test('West River CCN 351330 uses the complete page-linked MRF and preserves its mismatched pointer as a separate issue', () => {
  const proofFile = 'reconciliation-west-river-regional-current-mrf-proof-2026-09-29.json';
  const proof = readJson(proofFile);
  assert.equal(proof.ccn, '351330');
  assert.equal(proof.pointer.status, 200);
  assert.equal(proof.pointer.bytes, 274);
  assert.equal(proof.pointer.sha256, 'ecf675f569011871fc1498cac94c8bc4dda2a667debd1b2617e1ffe053ce4f14');
  assert.notEqual(proof.pointer.declared_mrf_url, proof.mrf.url);
  assert.equal(proof.pointer.declared_target_status, 404);
  assert.equal(proof.mrf.status, 200);
  assert.equal(proof.mrf.bytes, 10251599);
  assert.equal(proof.mrf.sha256, '42194caeb94291a56f9a79442f39542715498ed554e2893aeb30d8e8c11b2668');
  assert.equal(proof.mrf.cms_template_version, '3.0.0');
  assert.equal(proof.mrf.declared_last_updated, '2026-02-18');
  assert.equal(proof.mrf.declared_attestation, true);

  const bytes = fs.readFileSync(path.join(root, proof.mrf.retained_file));
  assert.equal(bytes.length, proof.mrf.bytes);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), proof.mrf.sha256);
  const rows = parseCSV(bytes.toString('utf8'));
  assert.equal(rows.length, proof.mrf.parsed_data_rows + 3);
  assert.equal(rows[2].length, 33);
  assert.ok(rows.slice(3).every(row => row.length === 33));
  assert.equal(rows[1][0], 'West River Health Services');
  assert.equal(rows[1][4], '1000 Highway 12, Hetting, ND 58639');
  assert.equal(rows[1][5].split('|').includes('1588763247'), true);
  assert.equal(rows[1][8], 'TRUE');
  for (const field of ['standard_charge | gross', 'standard_charge | discounted_cash', 'payer_name', 'standard_charge | negotiated_dollar']) {
    const column = rows[2].indexOf(field);
    assert.notEqual(column, -1, `${field} column exists`);
    assert.equal(rows.slice(3).filter(row => row[column]?.trim()).length, proof.mrf.parsed_data_rows, `${field} populated for every data row`);
  }

  const cms = proof.cms_enrollment.record;
  assert.equal(cms.CCN, proof.ccn);
  assert.equal(cms.NPI, '1588763247');
  assert.equal(cms['MULTIPLE NPI FLAG'], 'Y');
  assert.equal(cms['ORGANIZATION NAME'], 'WEST RIVER HEALTH SERVICES');
  assert.equal(cms['DOING BUSINESS AS NAME'], 'WEST RIVER REGIONAL MEDICAL CENTER');
  assert.equal(cms['ADDRESS LINE 1'], '1000 HIGHWAY 12');
  assert.equal(cms.CITY, 'HETTINGER');
  assert.equal(cms.STATE, 'ND');

  const ledger = readJson('reviewed-resolutions.json');
  const resolution = ledger.find(row => row.ccn === proof.ccn);
  assert.ok(resolution);
  assert.equal(resolution.finding, 'verified-current-mrf');
  assert.equal(resolution.evidence.fileSha256, proof.mrf.sha256);
  assert.equal(resolution.evidence.pointerMrfStatus, 404);
  const manual = readJson('reconciliation-manual-access-observations.json');
  assert.ok(manual.records.some(row => row.ccn === proof.ccn && row.proof_file === proofFile
    && row.disposition === 'verified-current-mrf'));
  const browser = readJson('nationwide-browser-reviews.json');
  assert.ok(browser.records.some(row => row.ccn === proof.ccn && row.proof_file === proofFile
    && row.file_sha256 === proof.mrf.sha256));
  const byteProof = readJson('nationwide-file-byte-proof.json');
  assert.ok(byteProof.records.some(row => row.ccns?.includes(proof.ccn)
    && row.sha256 === proof.mrf.sha256 && row.bytes_retained === proof.mrf.bytes));

  const oldProof = readJson('reconciliation-west-river-regional-current-page-file-proof-2026-09-20.json');
  assert.equal(oldProof.file_sample_bytes, 262144, 'retain earlier bounded sample as dated history');
  const roster = readJson('reconciliation-891-baseline-member-roster-2026-09-27.json');
  assert.ok(roster.baseline_unresolved_ccns.includes(proof.ccn));
  assert.ok(!roster.current_crosswalk_ccns['genuinely-unresolved'].includes(proof.ccn));
  assert.ok(roster.current_crosswalk_ccns['superseded-by-reviewed-resolution'].includes(proof.ccn));
  assert.equal(roster.summary.category_membership_sum, 891);
  assert.equal(roster.summary.unique_ccns, 720);
  assert.equal(roster.summary.current_effective_categories['genuinely-unresolved'], 541);
  assert.equal(roster.summary.current_effective_categories['superseded-by-reviewed-resolution'], 29);
});
