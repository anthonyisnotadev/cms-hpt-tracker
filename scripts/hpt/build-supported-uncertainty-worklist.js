'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const reconciliationPath = path.join(audit, 'nationwide-reconciliation.json');
const resolutionsPath = path.join(audit, 'reviewed-resolutions.json');
const conflictsPath = path.join(audit, 'reconciliation-browser-file-address-conflicts.json');
const outputPath = path.join(audit, 'supported-uncertainty-followup-worklist.json');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function build(reconciliation, resolutions) {
  const reviewed = new Map(resolutions.map(row => [row.ccn, row]));
  const observedConflicts = {
    'mrf-address-field-conflicts-facility': {
      gate: 'reviewed-file-address-conflict', priority: 1,
      action: 'Obtain publisher clarification or a corrected file address; recheck the exact pointer-linked file and compare its declared address with the independently verified facility address.'
    },
    'mrf-license-state-field-conflicts-facility': {
      gate: 'reviewed-file-license-state-conflict', priority: 1,
      action: 'Obtain publisher clarification or a corrected license-state field; recheck the exact file and compare that field with first-party or state facility evidence.'
    },
    'mrf-address-field-incomplete': {
      gate: 'reviewed-file-address-incomplete', priority: 2,
      action: 'Recheck whether the publisher expanded the incomplete address field in the exact file; retain the literal field and independently verified campus address meanwhile.'
    }
  };
  const supported = reconciliation.records.filter(row => row.workstream === 'supported-uncertainty-monitor')
    .map(row => {
      const resolution = reviewed.get(row.ccn);
      const gate = row.reconciliation_status === 'supported-current-file-address-conflict'
        ? 'file-address-conflict' : row.reconciliation_status === 'supported-identity-uncertainty'
          ? 'identity-and-pointer-linkage' : '';
      const conflict = row.browser_file_address_conflict;
      if (!gate || !row.next_action || !row.standing_finding
          || (gate === 'identity-and-pointer-linkage' && (resolution?.action !== 'quarantine' || !resolution.proof))
          || (gate === 'file-address-conflict' && conflict?.disposition !== 'current-file-address-conflicts-official-facility-address'))
        throw new Error(`Unsupported or incomplete uncertainty follow-up ${row.ccn}`);
      const manual = row.manual_access_observation;
      const nextAction = manual?.next_action && Date.parse(manual.observed_at) >= Date.parse(row.standing_checked_at || '1970-01-01')
        ? manual.next_action : row.next_action;
      return {
        ccn: row.ccn, hospital_name: row.hospital_name, state: row.state,
        priority: gate === 'file-address-conflict' ? 1 : 2,
        evidence_gate: gate, reconciliation_status: row.reconciliation_status,
        standing_finding: row.standing_finding,
        reviewed_resolution_action: resolution?.action || '',
        reviewed_at: resolution?.reviewed_at || (conflict?.observed_on ? conflict.observed_on + 'T23:59:59Z' : ''),
        latest_observed_at: manual?.observed_at || row.latest_observed_at || '',
        next_action: nextAction
      };
    });
  const reviewedFileConflicts = reconciliation.records.filter(row =>
    row.workstream === 'consistent' && observedConflicts[row.standing_finding])
    .map(row => {
      const resolution = reviewed.get(row.ccn);
      const finding = row.standing_finding;
      const kind = observedConflicts[finding];
      const evidence = resolution?.evidence;
      if (resolution?.action !== 'replace-observation' || evidence?.observedFinding !== finding
          || !evidence?.url || !evidence?.pointerUrl || !evidence?.declared_address
          || !evidence?.checked_at || !resolution.reviewed_at)
        throw new Error(`Reviewed file conflict lacks source-bound follow-up ${row.ccn}`);
      const detail = finding === 'mrf-address-field-conflicts-facility'
        ? ` Declared address: ${evidence.declared_address}; facility address: ${evidence.facility_address}.`
        : finding === 'mrf-license-state-field-conflicts-facility'
          ? ` Declared license state: ${evidence.declared_license_state}; facility state: ${evidence.facility_state}.`
          : ` Missing address component: ${evidence.missing_address_component}.`;
      return {
        ccn: row.ccn, hospital_name: row.hospital_name, state: row.state,
        priority: kind.priority, evidence_gate: kind.gate,
        reconciliation_status: 'reviewed-current-file-metadata-conflict',
        standing_finding: finding, reviewed_resolution_action: resolution.action,
        reviewed_at: resolution.reviewed_at, latest_observed_at: evidence.checked_at,
        pointer_url: evidence.pointerUrl, mrf_url: evidence.url,
        next_action: evidence.next_action || kind.action + detail
      };
    });
  const records = [...supported, ...reviewedFileConflicts]
    .sort((a, b) => a.priority - b.priority || a.ccn.localeCompare(b.ccn));
  if (new Set(records.map(row => row.ccn)).size !== records.length)
    throw new Error('Duplicate CCN in supported uncertainty worklist');
  return { summary: { total: records.length,
    by_gate: Object.fromEntries(['file-address-conflict', 'identity-and-pointer-linkage',
      ...Object.values(observedConflicts).map(item => item.gate)]
      .map(gate => [gate, records.filter(row => row.evidence_gate === gate).length])) }, records };
}

function main() {
  const reconciliationBytes = fs.readFileSync(reconciliationPath);
  const resolutionsBytes = fs.readFileSync(resolutionsPath);
  const conflictsBytes = fs.readFileSync(conflictsPath);
  const result = build(JSON.parse(reconciliationBytes), JSON.parse(resolutionsBytes));
  result.source_sha256 = {
    'nationwide-reconciliation.json': sha(reconciliationBytes),
    'reviewed-resolutions.json': sha(resolutionsBytes),
    'reconciliation-browser-file-address-conflicts.json': sha(conflictsBytes)
  };
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result.summary));
}

if (require.main === module) main();
module.exports = { build };
