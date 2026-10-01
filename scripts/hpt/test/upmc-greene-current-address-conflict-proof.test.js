'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const read = name => JSON.parse(fs.readFileSync(path.join(audit, name), 'utf8'));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const { parseCSV } = require('../lib/util');

test('UPMC Greene address conflict blocks current verification without changing the 891 cohort', () => {
  const proof = read('reconciliation-upmc-greene-current-address-conflict-proof-2026-09-29.json');
  const fullProof = read('reconciliation-upmc-greene-current-full-file-recheck-2026-09-30.json');
  const sample = fs.readFileSync(path.join(root, proof.mrf.sample_path));
  const fullFile = fs.readFileSync(path.join(root, fullProof.mrf.retained_file));
  const currentManual = read('reconciliation-manual-access-observations.json').records
    .find(row => row.ccn === proof.ccn && row.latest_exact_full_file_recheck_2026_09_30);
  const current = read('nationwide-verification.json').records.find(row => row.ccn === proof.ccn);
  const reconciled = read('nationwide-reconciliation.json').records.find(row => row.ccn === proof.ccn);
  const work = read('unresolved-investigation-worklist.json').records.find(row => row.ccn === proof.ccn);
  const roster = read('reconciliation-891-baseline-member-roster-2026-09-27.json');
  const crosscheck = read('reconciliation-891-worklist-membership-crosscheck-2026-09-28.json');
  const tracker = fs.readFileSync(path.join(root, 'tracker.html'), 'utf8');
  const marker = '<script id="tracker-data" type="application/json">';
  const start = tracker.indexOf(marker);
  const end = tracker.indexOf('</script>', start);
  const data = JSON.parse(tracker.slice(start + marker.length, end));
  const trackerRow = data.rows.find(row => row[0] === proof.ccn);

  assert.equal(sample.length, proof.mrf.sample_bytes);
  assert.equal(hash(sample), proof.mrf.sample_sha256);
  assert.match(sample.toString('utf8'), /250 Bonor Avenue\s+Waynesburg, PA/);
  assert.equal(fullFile.length, fullProof.mrf.complete_bytes);
  assert.equal(hash(fullFile), fullProof.mrf.complete_sha256);
  assert.equal(fullProof.mrf.complete_sha256, '640ae1d398b080736e83000a78d814c8d03d91a6a01ff8e39faf63449c9b09ab');
  assert.equal(fullProof.mrf.declared_address, '250 Bonor Avenue  Waynesburg, PA');
  assert.equal(fullProof.mrf.cms_template_version, '3.0.0');
  assert.equal(fullProof.mrf.declared_date, '2026-03-06');
  assert.equal(fullProof.mrf.parsed_data_rows, 334726);
  assert.equal(fullProof.mrf.rows_with_unexpected_column_count, 0);
  assert.equal(currentManual.latest_exact_full_file_recheck_2026_09_30.complete_sha256,
    fullProof.mrf.complete_sha256);
  assert.equal(proof.cms_general_information.address, '350 BONAR AVENUE, WAYNESBURG, PA 15370');
  assert.equal(current.disposition, 'linked-mrf-header-unmatched');
  assert.equal(current.declared_address, '250 Bonor Avenue, Waynesburg, PA');
  assert.equal(work.reviewed_follow_up, true);
  assert.match(work.next_action, /250 Bonor Avenue/);
  assert.equal(reconciled.next_action, work.next_action);
  assert.equal(Object.values(roster.current_crosswalk_ccns)
    .some(ccns => Array.isArray(ccns) && ccns.includes(proof.ccn)), false);
  assert.equal(crosscheck.comparison.historical_cohort_memberships, 891);
  assert.equal(crosscheck.comparison.cohort_genuinely_unresolved_ccns, 541);
  assert.ok(crosscheck.comparison.worklist_ccns_outside_historical_cohort.includes(proof.ccn));
  assert.ok(trackerRow);
  assert.equal(data.dict.findings[trackerRow[5]], 'not-assessed-nationwide-linked-mrf-header-unmatched');
});
