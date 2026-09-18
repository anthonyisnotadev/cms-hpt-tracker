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
const dateFor = row => row.latest_observed_at || row.standing_checked_at || row.prior_checked_at || '';
const missing = unresolved.filter(row => !row.ccn || !dateFor(row) || !String(row.next_action || '').trim())
  .map(row => ({ ccn: row.ccn, missing: [!row.ccn && 'ccn', !dateFor(row) && 'dated_observation', !String(row.next_action || '').trim() && 'next_action'].filter(Boolean) }));
const result = {
  generated_at: new Date().toISOString(), source_sha256: crypto.createHash('sha256').update(sourceBytes).digest('hex'),
  unresolved_ccns: unresolved.length, supported_ccns: unresolved.length - missing.length,
  missing_support_count: missing.length, missing, limitation: 'A dated observation and next action establish auditability of uncertainty only; they do not establish file identity, absence, or compliance.'
};
fs.writeFileSync(path.join(audit, 'unresolved-support-audit.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ unresolved_ccns: result.unresolved_ccns, supported_ccns: result.supported_ccns, missing_support_count: result.missing_support_count }));
if (missing.length) process.exitCode = 1;

