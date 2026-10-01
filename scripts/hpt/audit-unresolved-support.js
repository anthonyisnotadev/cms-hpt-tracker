'use strict';

// Structural audit: every unresolved CCN must retain a dated observation and
// a specific next action. A missing latest MRF check is allowed when an older
// or standing observation is dated; this does not promote or downgrade it.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const sourcePath = path.join(audit, 'nationwide-reconciliation.json');
const sourceBytes = fs.readFileSync(sourcePath);
const source = JSON.parse(sourceBytes);
const unresolved = source.records.filter(row => row.workstream === 'genuinely-unresolved-investigation');
const investigationPath = path.join(audit, 'unresolved-investigation-worklist.json');
const quarantinePath = path.join(audit, 'identity-quarantine-worklist.json');
const uncertaintyPath = path.join(audit, 'supported-uncertainty-followup-worklist.json');
const investigation = JSON.parse(fs.readFileSync(investigationPath, 'utf8'));
const quarantine = JSON.parse(fs.readFileSync(quarantinePath, 'utf8'));
const uncertainty = JSON.parse(fs.readFileSync(uncertaintyPath, 'utf8'));
const investigationIds = new Set(investigation.records.map(row => row.ccn));
const quarantineIds = new Set(quarantine.records.map(row => row.ccn));
const uncertaintyIds = new Set(uncertainty.records.map(row => row.ccn));
const latestCheckUnresolved = source.records.filter(row => (row.issues || []).includes('latest-check-unresolved'));
const latestUnresolvedIds = new Set(latestCheckUnresolved.map(row => row.ccn));
const separateQueueIds = new Set([...quarantineIds, ...uncertaintyIds]);
const separatelyRouted = latestCheckUnresolved.filter(row => separateQueueIds.has(row.ccn));
const missingQueueCoverage = latestCheckUnresolved.filter(row => !investigationIds.has(row.ccn)
  && !quarantineIds.has(row.ccn) && !uncertaintyIds.has(row.ccn));
const queueOverlap = latestCheckUnresolved.filter(row => [investigationIds, quarantineIds, uncertaintyIds]
  .filter(ids => ids.has(row.ccn)).length > 1);
const dateFor = row => row.latest_observed_at || row.standing_checked_at || row.prior_checked_at || '';
const missing = unresolved.filter(row => !row.ccn || !dateFor(row) || !String(row.next_action || '').trim())
  .map(row => ({ ccn: row.ccn, missing: [!row.ccn && 'ccn', !dateFor(row) && 'dated_observation', !String(row.next_action || '').trim() && 'next_action'].filter(Boolean) }));
const result = {
  generated_at: new Date().toISOString(), source_sha256: crypto.createHash('sha256').update(sourceBytes).digest('hex'),
  unresolved_ccns: unresolved.length, supported_ccns: unresolved.length - missing.length,
  missing_support_count: missing.length, missing,
  workstream_coverage: {
    latest_check_unresolved_ccns: latestCheckUnresolved.length,
    investigation_worklist_file: path.basename(investigationPath),
    investigation_worklist_ccns: investigationIds.size,
    identity_quarantine_worklist_file: path.basename(quarantinePath),
    identity_quarantine_worklist_ccns: quarantineIds.size,
    supported_uncertainty_worklist_file: path.basename(uncertaintyPath),
    supported_uncertainty_worklist_ccns: uncertaintyIds.size,
    separately_routed_latest_check_unresolved: separatelyRouted.map(row => ({
      ccn: row.ccn,
      hospital_name: row.hospital_name,
      workstream: row.workstream,
      reconciliation_status: row.reconciliation_status,
      latest_observed_at: row.latest_observed_at,
      next_action: row.next_action,
    })),
    covered_latest_check_unresolved_ccns: latestCheckUnresolved.length - missingQueueCoverage.length,
    missing_queue_coverage_count: missingQueueCoverage.length,
    missing_queue_coverage_ccns: missingQueueCoverage.map(row => row.ccn),
    cross_queue_overlap_count: queueOverlap.length,
    cross_queue_overlap_ccns: queueOverlap.map(row => row.ccn),
    complete: missingQueueCoverage.length === 0 && queueOverlap.length === 0
      && latestUnresolvedIds.size === latestCheckUnresolved.length,
  },
  limitation: 'A dated observation and next action establish auditability of uncertainty only; they do not establish file identity, absence, or compliance.'
};
fs.writeFileSync(path.join(audit, 'unresolved-support-audit.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ unresolved_ccns: result.unresolved_ccns, supported_ccns: result.supported_ccns,
  missing_support_count: result.missing_support_count, workstream_coverage: result.workstream_coverage }));
if (missing.length || !result.workstream_coverage.complete) process.exitCode = 1;
