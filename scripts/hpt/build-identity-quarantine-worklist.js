'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const sourceName = 'nationwide-reconciliation.json';
const sourcePath = path.join(audit, sourceName);
const sourceBytes = fs.readFileSync(sourcePath);
const reconciliation = JSON.parse(sourceBytes);
const records = reconciliation.records
  .filter(row => row.workstream === 'identity-quarantine')
  .sort((a, b) => a.priority - b.priority || a.ccn.localeCompare(b.ccn))
  .map(row => ({
    ccn: row.ccn,
    hospital_name: row.hospital_name,
    state: row.state,
    priority: row.priority,
    standing_finding: row.standing_finding,
    proposed_disposition: row.proposed_disposition,
    latest_observed_at: row.latest_observed_at,
    standing_checked_at: row.standing_checked_at,
    next_action: row.next_action,
  }));

const output = {
  summary: { total: records.length, workstream: 'identity-quarantine' },
  source_sha256: { [sourceName]: crypto.createHash('sha256').update(sourceBytes).digest('hex') },
  records,
};
const outputPath = path.join(audit, 'identity-quarantine-worklist.json');
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ output: outputPath, total: records.length }, null, 2));
