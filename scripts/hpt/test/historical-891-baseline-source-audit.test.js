'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '../../..');
const auditPath = path.join(root, 'data/hpt-audit/reconciliation-891-baseline-source-recoverability-audit-2026-09-27.json');
const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
const rosterPath = path.join(root, 'data/hpt-audit/reconciliation-891-baseline-member-roster-2026-09-27.json');
const roster = JSON.parse(fs.readFileSync(rosterPath, 'utf8'));
const relative = 'data/hpt-audit/nationwide-verification.json';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const membershipHash = ccns => hash(Buffer.from([...ccns].sort().join(',')));

test('historical 891 baseline audit binds available snapshots without inventing members', () => {
  assert.equal(593 + 298, 891);
  assert.equal(audit.result.exact_sep_25_snapshot_found, true);
  assert.equal(audit.result.exact_891_member_ccn_roster_found, false);
  assert.equal(audit.result.exact_category_membership_roster_found, true);
  assert.equal(audit.result.unique_sep_25_ccns, 720);
  assert.equal(audit.result.overlap_ccns, 171);
  assert.equal(audit.result.closure_credit_awarded, 0);
  for (const snapshot of audit.recoverable_snapshot_sources) {
    let bytes;
    if (snapshot.ref === 'working-tree-current') bytes = fs.readFileSync(path.join(root, relative));
    else bytes = execFileSync('git', ['show', `${snapshot.ref}:${relative}`], {
      cwd: root,
      maxBuffer: 64 * 1024 * 1024
    });
    assert.equal(hash(bytes), snapshot.sha256, `snapshot hash for ${snapshot.ref}`);
    const data = JSON.parse(bytes.toString('utf8'));
    assert.equal(data.records.length, 5419);
    assert.equal(data.summary.generated_at, snapshot.generated_at);
    assert.deepEqual(data.summary.effective_counts, snapshot.effective_counts);
    assert.equal(data.summary.counts['pointer-access-denied-to-client'], snapshot.pointer_access_denied_raw);
  }
  const report = fs.readFileSync(path.join(root, audit.other_dated_report.path), 'utf8');
  assert.equal(hash(Buffer.from(report)), audit.other_dated_report.sha256);
  assert.match(report, /Historical snapshot: 2026-09-15/);
  assert.match(report, /not the current tracker totals/);
  assert.match(report, /\[current nationwide snapshot\]\(nationwide-verification\.json\)/);
  assert.match(report, /Generated from the reconciled local evidence snapshot on 2026-09-15/);
  assert.match(report, /\| Genuinely unresolved latest assessment \| 1,100 \|/);
  assert.match(report, /`pointer-access-denied-to-client` \| 296 \|/);
  assert.match(audit.result.conclusion, /do not substitute the overall current 548 unresolved count/);
});

test('recovered Sep. 25 roster binds both overlapping category memberships and deduplicates CCNs', () => {
  const unresolved = new Set(roster.baseline_unresolved_ccns);
  const denied = new Set(roster.baseline_pointer_denied_ccns);
  const union = new Set([...unresolved, ...denied]);
  const overlap = [...unresolved].filter(ccn => denied.has(ccn));
  assert.equal(roster.source_snapshot.generated_at, '2026-09-25T14:28:24.129Z');
  assert.equal(roster.source_snapshot.ccns, 5419);
  assert.equal(roster.baseline_unresolved_ccns.length, 593);
  assert.equal(roster.baseline_pointer_denied_ccns.length, 298);
  assert.equal(overlap.length, 171);
  assert.equal(union.size, 720);
  assert.equal(roster.summary.category_membership_sum, 891);
  assert.equal(roster.summary.unique_ccns, 720);
  assert.equal(membershipHash(unresolved), roster.matching_snapshot_validation.unresolved_membership_sha256);
  assert.equal(membershipHash(denied), roster.matching_snapshot_validation.pointer_denied_membership_sha256);
  assert.equal(membershipHash(union), roster.matching_snapshot_validation.union_membership_sha256);
  assert.equal(roster.matching_snapshot_validation.matching_snapshots, 28);
  assert.equal(roster.matching_snapshot_validation.all_category_memberships_identical, true);
  assert.deepEqual(roster.summary.current_effective_categories, {
    'genuinely-unresolved': 547,
    'active-verification-claim': 18,
    'standing-evidence-retained': 72,
    'superseded-by-reviewed-resolution': 67,
    'scope-exempt': 16
  });
  const currentCategories = roster.current_crosswalk_ccns;
  const currentUnion = new Set(Object.entries(currentCategories)
    .filter(([category]) => category !== 'current_pointer_access_denied_ccns'
      && !category.startsWith('baseline_unresolved_now_'))
    .flatMap(([, ccns]) => ccns));
  assert.equal(currentUnion.size, 720);
  assert.deepEqual(Object.fromEntries(Object.keys(roster.summary.current_effective_categories)
    .map(category => [category, currentCategories[category].length])), roster.summary.current_effective_categories);
  assert.equal(currentCategories.current_pointer_access_denied_ccns.length, 229);
  assert.deepEqual(currentCategories['scope-exempt'], ['030071', '030074', '030084', '030113', '030195', '031307', '241358', '370173', '454000', '454006', '454008', '454009', '454011', '454084', '454088', '454100']);
  assert.equal(currentCategories.baseline_unresolved_now_active_ccns.length, 16);
  assert.equal(currentCategories.baseline_unresolved_now_superseded_ccns.length, 14);
  assert.deepEqual(currentCategories.baseline_unresolved_now_scope_exempt_ccns,
    ['030071', '030074', '030084', '030113', '030195', '031307', '241358', '370173', '454000', '454006', '454008', '454009', '454011', '454084', '454088', '454100']);
  assert.equal(roster.summary.baseline_unresolved_still_unresolved, 547);
  const texasProof = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/reconciliation-texas-state-hospital-scope-proof-2026-09-27.json'), 'utf8'));
  assert.equal(texasProof.facility_dispositions.filter(item => item.ccn.startsWith('454')).length, 8);
  assert.match(texasProof.rio_grande_address_discrepancy, /78552.*78550|78550.*78552/);
  assert.match(texasProof.rio_grande_rate_schedule_source, /2025-ffy-psych-hosp-perdiem\.pdf/);
  assert.match(texasProof.no_pricing_claim, /No pointer URL, MRF URL, bytes/);

  let sourceBytes;
  try {
    sourceBytes = execFileSync('git', ['cat-file', 'blob', roster.source_snapshot.git_blob_sha1], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  } catch {
    // The standalone member lists remain auditable if a future clone omits this unreachable Git object.
  }
  if (sourceBytes) {
    assert.equal(hash(sourceBytes), roster.source_snapshot.sha256);
    const source = JSON.parse(sourceBytes.toString('utf8'));
    assert.equal(source.summary.effective_counts['genuinely-unresolved'], 593);
    assert.equal(source.summary.counts['pointer-access-denied-to-client'], 298);
    assert.deepEqual(source.records.filter(record => !record.latest_observation_superseded
      && !record.standing_evidence_retained && !record.supported_identity_uncertainty
      && !/^verified-|^scope-exempt/.test(record.disposition)).map(record => record.ccn).sort(), [...unresolved].sort());
    assert.deepEqual(source.records.filter(record => record.disposition === 'pointer-access-denied-to-client')
      .map(record => record.ccn).sort(), [...denied].sort());
  }

  const currentPath = path.join(root, relative);
  const currentBytes = fs.readFileSync(currentPath);
  if (hash(currentBytes) === roster.current_snapshot.sha256) {
    const current = JSON.parse(currentBytes.toString('utf8'));
    const currentByCcn = new Map(current.records.map(record => [record.ccn, record]));
    const effectiveCategory = record => /^scope-exempt/.test(record.disposition) ? 'scope-exempt'
      : record.latest_observation_superseded ? 'superseded-by-reviewed-resolution'
      : record.standing_evidence_retained ? 'standing-evidence-retained'
        : record.supported_identity_uncertainty ? 'supported-identity-uncertainty'
          : /^verified-/.test(record.disposition) ? 'active-verification-claim'
            : /^scope-exempt/.test(record.disposition) ? 'scope-exempt' : 'genuinely-unresolved';
    const counts = {};
    for (const ccn of union) {
      const category = effectiveCategory(currentByCcn.get(ccn));
      counts[category] = (counts[category] || 0) + 1;
    }
    assert.deepEqual(counts, roster.summary.current_effective_categories);
    for (const [category, ccns] of Object.entries(currentCategories)) {
      if (category.startsWith('baseline_unresolved_now_')) continue;
      const expected = category === 'current_pointer_access_denied_ccns'
        ? [...union].filter(ccn => currentByCcn.get(ccn).disposition === 'pointer-access-denied-to-client').sort()
        : [...union].filter(ccn => effectiveCategory(currentByCcn.get(ccn)) === category).sort();
      assert.deepEqual(ccns, expected, `current crosswalk membership for ${category}`);
    }
    assert.deepEqual(currentCategories.baseline_unresolved_now_active_ccns,
      [...unresolved].filter(ccn => effectiveCategory(currentByCcn.get(ccn)) === 'active-verification-claim').sort());
    assert.deepEqual(currentCategories.baseline_unresolved_now_superseded_ccns,
      [...unresolved].filter(ccn => effectiveCategory(currentByCcn.get(ccn)) === 'superseded-by-reviewed-resolution').sort());
  }
});
