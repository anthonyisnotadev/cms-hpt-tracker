'use strict';

const { effectiveDispositionCategory } = require('../build-nationwide-verification');

const STREAMS = [
  { key: 'genuinely-unresolved-investigation', label: 'Unresolved investigations',
    why: 'The reviewed evidence does not yet support a settled result.',
    action: 'Follow each hospital’s evidence gate and facility-specific next step.' },
  { key: 'standing-evidence-follow-up', label: 'Standing evidence follow-ups',
    why: 'An existing finding is retained while newer access or identity evidence needs review.',
    action: 'Reconcile the newer observation without discarding stronger standing evidence.' },
  { key: 'supported-uncertainty-monitor', label: 'Uncertainty monitoring',
    why: 'The current uncertainty is supported by evidence; these are monitoring cases.',
    action: 'Revisit the documented trigger when new evidence becomes available.' },
  { key: 'identity-quarantine', label: 'Facility identity review',
    why: 'A proposed file assignment requires more facility-specific identity evidence.',
    action: 'Verify the hospital, campus, and file before accepting the assignment.' },
  { key: 'standing-finding-discrepancy', label: 'Finding reconciliation',
    why: 'A newer observation differs from the standing finding.',
    action: 'Review the conflicting evidence and preserve the audit trail.' },
  { key: 'same-campus-ccn-review', label: 'Same-campus scope review',
    why: 'Shared campuses or identifier transitions need an enrollment scope check.',
    action: 'Confirm which CMS record and reporting scope the evidence supports.' },
  { key: 'other-reconciliation', label: 'Other evidence review',
    why: 'A documented reconciliation step remains outside the main workstreams.',
    action: 'Complete the recorded next step before changing the result.' },
];

function buildReviewedWorkQueue(nextSteps, records) {
  const byCcn = new Map(records.map(row => [row.ccn, row]));
  if (byCcn.size !== records.length) throw new Error('Duplicate CCN in reviewed work queue source');
  const counts = new Map(STREAMS.map(stream => [stream.key, 0]));
  for (const [ccn, step] of Object.entries(nextSteps)) {
    const row = byCcn.get(ccn);
    if (!row) throw new Error(`Work queue CCN is absent from reviewed records: ${ccn}`);
    if (!counts.has(step.stream)) throw new Error(`Unknown reviewed work queue stream: ${step.stream}`);
    // An effective overlay can resolve an investigation before the base
    // worklist is regenerated. Do not present that case as still unresolved.
    if (step.stream === 'genuinely-unresolved-investigation'
      && effectiveDispositionCategory(row) !== 'genuinely-unresolved') continue;
    counts.set(step.stream, counts.get(step.stream) + 1);
  }
  for (const row of records) {
    if (effectiveDispositionCategory(row) === 'genuinely-unresolved' && !nextSteps[row.ccn])
      throw new Error(`Unresolved hospital has no reviewed next step: ${row.ccn}`);
  }
  return STREAMS.map(stream => ({ ...stream, n: counts.get(stream.key) }))
    .filter(stream => stream.n > 0).sort((a, b) => b.n - a.n);
}

module.exports = { buildReviewedWorkQueue };
