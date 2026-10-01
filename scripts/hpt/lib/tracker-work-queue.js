'use strict';

const { effectiveDispositionCategory } = require('../build-nationwide-verification');

// Labels are read by the public tracker, so they name the situation a reader
// sees, not the internal workstream. The keys stay the workstream names.
const STREAMS = [
  { key: 'genuinely-unresolved-investigation', label: 'Still unresolved',
    why: 'The evidence so far does not support a result either way.',
    action: 'Follow each hospital’s recorded next step until the evidence settles it.' },
  { key: 'standing-evidence-follow-up', label: 'Newer evidence to weigh',
    why: 'The current result stands, but a later check found a file, name, or address that may contradict it.',
    action: 'Decide whether the newer evidence replaces the result, belongs to a different facility, or can be set aside.' },
  { key: 'standing-evidence-access-retry', label: 'Recheck could not finish',
    why: 'The current result stands. A later check could not reach or fully read the file, which is not evidence against it.',
    action: 'Retry through a permitted route. The result stays until a check reads the file.' },
  { key: 'supported-uncertainty-monitor', label: 'Watching for a change',
    why: 'The evidence supports leaving these unresolved for now.',
    action: 'Revisit when the recorded trigger occurs, such as the hospital publishing a new file.' },
  { key: 'identity-quarantine', label: 'Facility match unproven',
    why: 'A file may belong to this hospital, but the facility match is not yet proven.',
    action: 'Verify the hospital, campus, and file before accepting the assignment.' },
  { key: 'standing-finding-discrepancy', label: 'Conflicting observations',
    why: 'A newer observation differs from the current result.',
    action: 'Review the conflicting evidence and keep the audit trail.' },
  { key: 'same-campus-ccn-review', label: 'Shared-campus check',
    why: 'Hospitals sharing a campus or a changed CMS number need their records separated.',
    action: 'Confirm which CMS record the evidence belongs to.' },
  { key: 'other-reconciliation', label: 'Other follow-up',
    why: 'A recorded next step sits outside the main groups.',
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
    const category = effectiveDispositionCategory(row);
    const retainedButUnresolved = category === 'standing-evidence-retained'
      && row.reconciliation_workstream === 'genuinely-unresolved-investigation';
    if (step.stream === 'genuinely-unresolved-investigation'
      && category !== 'genuinely-unresolved' && !retainedButUnresolved) continue;
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
