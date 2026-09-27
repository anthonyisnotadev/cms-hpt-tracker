'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { build } = require('../build-unresolved-investigation-worklist');

const audit = path.resolve(__dirname, '../../../data/hpt-audit');
const read = name => fs.readFileSync(path.join(audit, name));

test('unresolved investigation worklist covers each live CCN with a specific evidence gate', () => {
  const reconciliation = JSON.parse(read('nationwide-reconciliation.json'));
  const verification = JSON.parse(read('nationwide-verification.json'));
  const saved = JSON.parse(read('unresolved-investigation-worklist.json'));
  const fresh = build(reconciliation, verification);
  assert.deepEqual(saved.summary, fresh.summary);
  assert.deepEqual(saved.records, fresh.records);
  assert.equal(saved.records.length, reconciliation.records.filter(row =>
    row.workstream === 'genuinely-unresolved-investigation').length);
  assert.equal(new Set(saved.records.map(row => row.ccn)).size, saved.records.length);
  assert.equal(Object.values(saved.summary.by_tier).reduce((sum, count) => sum + count, 0), saved.records.length);
  assert.ok(saved.records.every(row => row.evidence_gate && row.next_action && row.next_action.length > 20));
  assert.ok(saved.records.every(row => typeof row.candidate_file_recorded === 'boolean'));
  assert.equal(saved.records.find(row => row.ccn === '190241').candidate_file_recorded, true);
  const parkCenter = saved.records.find(row => row.ccn === '154060');
  const parkCenterEvidence = JSON.parse(read('reconciliation-manual-access-observations.json'))
    .records.find(row => row.ccn === '154060');
  assert.equal(parkCenter.current_disposition, 'pointer-facility-match-unresolved');
  assert.deepEqual(parkCenter.reviewed_sources, ['manual-access']);
  assert.equal(parkCenter.candidate_file_recorded, false);
  assert.equal(parkCenterEvidence.pointer_location_names.length, 11);
  assert.ok(parkCenterEvidence.pointer_location_names.every(name => !/Park Center/i.test(name)));
  assert.match(parkCenter.next_action, /do not borrow any of the 11 other Parkview location files/);
  assert.ok(!/https?:\/\//i.test(JSON.stringify(saved.records)));
  for (const name of ['nationwide-reconciliation.json', 'nationwide-verification.json',
    'reconciliation-independence-health-access-proof.json',
    'reconciliation-coal-county-page-file-proof.json',
    'reconciliation-reedsburg-pointer-case-proof.json',
    'reconciliation-houston-county-address-conflict-proof.json',
    'reconciliation-creekhealth-sibling-exclusion-proof.json',
    'reconciliation-grand-view-page-file-lead-proof.json',
    'reconciliation-avera-three-site-access-proof.json',
    'reconciliation-summit-casper-site-proof.json']) {
    assert.equal(saved.source_sha256[name], crypto.createHash('sha256').update(read(name)).digest('hex'));
  }
});

test('manual rechecks cannot hide behind an older top-level observation timestamp', () => {
  const manual = JSON.parse(read('reconciliation-manual-access-observations.json'));
  const reconciliation = JSON.parse(read('nationwide-reconciliation.json'));
  const verification = JSON.parse(read('nationwide-verification.json'));
  const worklist = new Map(build(reconciliation, verification).records.map(row => [row.ccn, row]));
  const collectDates = (value, out = []) => {
    if (!value || typeof value !== 'object') return out;
    if (Array.isArray(value)) {
      value.forEach(item => collectDates(item, out));
      return out;
    }
    for (const [key, nested] of Object.entries(value)) {
      if (typeof nested === 'string' && /(observed|reviewed|checked|updated|retrieved|recheck|at$)/i.test(key)
        && /^\d{4}-\d\d-\d\dT/.test(nested)) out.push(nested);
      else if (nested && typeof nested === 'object') collectDates(nested, out);
    }
    return out;
  };
  const violations = [];
  for (const record of manual.records) {
    if (!worklist.has(record.ccn)) continue;
    const nested = collectDates(record).map(Date.parse).filter(Number.isFinite);
    const latest = Math.max(...nested);
    const queued = Date.parse(worklist.get(record.ccn)?.latest_review_at || '');
    if (Number.isFinite(latest) && (!Number.isFinite(queued) || queued < latest)) {
      violations.push(record.ccn);
    }
  }
  assert.deepEqual(violations, []);
});

test('Grand View and Avera source reviews narrow four gates without overstating file verification', () => {
  const reconciliation = JSON.parse(read('nationwide-reconciliation.json'));
  const verification = JSON.parse(read('nationwide-verification.json'));
  const rows = new Map(build(reconciliation, verification).records.map(row => [row.ccn, row]));
  const grandView = rows.get('390057');
  assert.equal(grandView, undefined);
  const standing = JSON.parse(read('standing-evidence-followup-worklist.json'));
  const grandViewStanding = standing.records.find(row => row.ccn === '390057');
  assert.equal(grandViewStanding.standing_finding, 'root-pointer-omits-facility-page-file-found');
  assert.equal(grandViewStanding.current_disposition, 'pointer-facility-match-unresolved');
  assert.equal(grandViewStanding.reviewed_follow_up, true);
  assert.match(grandViewStanding.next_action, /recheck complete-file usability/);
  for (const ccn of ['431308', '431313', '431318']) {
    const row = rows.get(ccn);
    assert.equal(row.current_disposition, 'first-party-labeled-file-client-access-denied');
    assert.equal(row.nationwide_disposition, 'pointer-facility-match-unresolved');
    assert.equal(row.evidence_gate, 'exact-file-access-and-campus-attribution');
    assert.deepEqual(row.reviewed_sources, ['manual-access', 'avera-access-proof']);
    assert.equal(row.candidate_file_recorded, true);
    assert.match(row.next_action, /Do not repeat the denied browser request/);
  }
  assert.match(rows.get('431308').next_action, /202 J Ave nursing site against the 200 J Ave hospital/);
  const changed = structuredClone(verification);
  changed.records.find(row => row.ccn === '390057').pointer_corpus_sha256 = 'changed';
  changed.records.find(row => row.ccn === '431308').pointer_corpus_sha256 = 'changed';
  const staleRows = new Map(build(reconciliation, changed).records.map(row => [row.ccn, row]));
  assert.equal(staleRows.get('390057'), undefined);
  assert.equal(staleRows.get('431308').current_disposition, 'pointer-facility-match-unresolved');
});

test('Independence Health access review narrows remaining unresolved gates without promoting a file', () => {
  const reconciliation = JSON.parse(read('nationwide-reconciliation.json'));
  const verification = JSON.parse(read('nationwide-verification.json'));
  const rows = new Map(build(reconciliation, verification).records.map(row => [row.ccn, row]));
  // Clarion (390093) and Latrobe (390219) now have separately reviewed
  // complete page-linked files; only Butler Memorial remains access-gated.
  assert.equal(rows.get('390093'), undefined);
  assert.equal(rows.get('390219'), undefined);
  for (const ccn of ['390168']) {
    const row = rows.get(ccn);
    assert.equal(row.current_disposition, 'first-party-labeled-file-client-access-denied');
    assert.equal(row.nationwide_disposition, 'pointer-facility-match-unresolved');
    assert.deepEqual(row.reviewed_sources, ['manual-access', 'independence-access-proof']);
    assert.equal(row.candidate_file_recorded, true);
    assert.match(row.next_action, /byte-backed header/);
  }
  assert.equal(rows.get('390168').evidence_gate, 'file-access-and-url-equivalence');
  const tampered = structuredClone(verification);
  tampered.records.find(row => row.ccn === '390168').pointer_corpus_sha256 = 'changed';
  assert.equal(build(reconciliation, tampered).records.find(row => row.ccn === '390168').current_disposition,
    'pointer-facility-match-unresolved');
});

test('reviewed cases remain actionable but sort behind untouched cases within their tier', () => {
  const reconciliation = {
    records: [
      { ccn: '000002', hospital_name: 'B', state: 'AA', workstream: 'genuinely-unresolved-investigation',
        proposed_disposition: 'mrf-request-unsuccessful', next_action: 'Retry the exact file.',
        manual_access_observation: { observed_at: '2026-09-16T00:00:00Z', next_action: 'Wait for a changed publisher file.' } },
      { ccn: '000003', hospital_name: 'C', state: 'AA', workstream: 'genuinely-unresolved-investigation',
        proposed_disposition: 'mrf-request-unsuccessful', next_action: 'Try the current exact file.' },
      { ccn: '000001', hospital_name: 'A', state: 'AA', workstream: 'genuinely-unresolved-investigation',
        proposed_disposition: 'mrf-request-unsuccessful',
        reviewed_header_disposition: { next_action: 'Wait for a corrected publisher version.' },
        next_action: 'Wait for a corrected publisher version.' },
    ],
  };
  const verification = { records: [{ ccn: '000002', official_domain: 'example.org' },
    { ccn: '000003', official_domain: 'example.net' },
    { ccn: '000001', official_domain: 'example.com' }] };
  const rows = build(reconciliation, verification).records;
  assert.deepEqual(rows.map(row => row.ccn), ['000003', '000001', '000002']);
  assert.deepEqual(rows[1].reviewed_sources, ['reviewed-header']);
  assert.equal(rows[2].next_action, 'Wait for a changed publisher file.');
});

test('a documented browser HTTP denial replaces an identical browser retry, not a reviewed action', () => {
  const reconciliation = { records: [
    { ccn: '000001', hospital_name: 'A', state: 'NY', workstream: 'genuinely-unresolved-investigation',
      proposed_disposition: 'mrf-request-unsuccessful',
      next_action: 'Retry the exact pointer-declared MRF in a browser/download-capable client.' },
    { ccn: '000002', hospital_name: 'B', state: 'NY', workstream: 'genuinely-unresolved-investigation',
      proposed_disposition: 'mrf-request-unsuccessful',
      next_action: 'Retry the exact pointer-declared MRF in a browser/download-capable client.',
      manual_access_observation: { observed_at: '2026-09-16T00:00:00Z', next_action: 'Use a specific reviewed recovery route.' } },
  ] };
  const verification = { records: [
    { ccn: '000001', browser_mrf_status: 'http-denied', browser_mrf_observed_at: '2026-09-15T00:00:00Z' },
    { ccn: '000002', browser_mrf_status: 'http-denied', browser_mrf_observed_at: '2026-09-15T00:00:00Z' },
  ] };
  const byCcn = new Map(build(reconciliation, verification).records.map(row => [row.ccn, row]));
  assert.match(byCcn.get('000001').next_action, /browser already observed HTTP denial/);
  assert.match(byCcn.get('000001').next_action, /publisher-corrected pointer/);
  assert.equal(byCcn.get('000001').last_browser_file_observed_at, '2026-09-15T00:00:00Z');
  assert.equal(byCcn.get('000002').next_action, 'Use a specific reviewed recovery route.');
});
