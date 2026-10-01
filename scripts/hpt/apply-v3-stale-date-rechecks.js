'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofName = 'reconciliation-v3-stale-date-rechecks-2026-09-30.json';
const proof = JSON.parse(fs.readFileSync(path.join(audit, proofName), 'utf8'));
const roster = new Map(JSON.parse(fs.readFileSync(path.join(root, 'cms_data/hpt/roster.json'), 'utf8'))
  .map(row => [row.ccn, row]));
const compliance = new Map(csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
  .map(row => [row.ccn, row]));
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const now = Date.parse(proof.observed_at);
const nextAction = 'Recheck this exact pointer-linked file after a publisher update or material source change; preserve its CMS v3 literal and do not infer a legal violation from the stale date alone.';

if (!Number.isFinite(now) || proof.records.length !== 4) throw new Error('Invalid freshness proof checkpoint');
for (const record of proof.records) {
  const hospital = roster.get(record.ccn);
  const base = compliance.get(record.ccn);
  const ageDays = Math.floor((now - Date.parse(`${record.declared_last_updated}T00:00:00Z`)) / 86400000);
  const rawPath = path.resolve(root, record.prior_raw_artifact);
  const raw = fs.readFileSync(rawPath);
  const rawHash = crypto.createHash('sha256').update(raw).digest('hex');
  if (!hospital || !base || !['3.0', '3.0.0'].includes(record.cms_template_version)
      || record.resulting_disposition !== 'verified-stale-mrf'
      || ageDays <= 365 || ageDays !== record.age_days_as_of_observation
      || record.range_bytes !== 262144 || record.mrf_status !== 206
      || !record.range_unchanged || rawHash !== record.range_sha256
      || rawHash !== record.prior_range_sha256
      || !record.pointer_url || !/^[a-f0-9]{64}$/i.test(record.pointer_sha256)
      || !record.mrf_url || !record.declared_address || record.declared_license_state !== hospital.state)
    throw new Error(`Freshness proof failed source/date gate for ${record.ccn}`);
  const evidence = {
    identity: 'corroborated',
    identity_basis: 'current-pointer-linked-v3-file-sample-hash-reproduced-name-address-state-and-declared-date',
    officialDomain: record.official_domain,
    sourcePageUrl: record.pointer_url,
    pointerUrl: record.pointer_url,
    pointerSha256: record.pointer_sha256,
    pointerLocationName: record.declared_location_name,
    url: record.mrf_url,
    finalUrl: record.mrf_url,
    http_status: record.mrf_status,
    checked_at: proof.observed_at,
    date: record.declared_last_updated,
    version: record.cms_template_version,
    declared_hospital_name: record.declared_hospital_name,
    location_name: record.declared_location_name,
    declared_address: record.declared_address,
    declared_license_state: record.declared_license_state,
    declared_npi: record.declared_npi || '',
    file_kind: 'csv',
    fileSha256: record.range_sha256,
    bytesRetained: record.range_bytes,
    sampleRange: record.range,
    sampleBytes: record.range_bytes,
    completeFileValidated: false,
    attestationPresent: true,
    observedFinding: 'mrf-stale-over-365-days',
    next_action: nextAction
  };
  const resolution = {
    ccn: record.ccn,
    base,
    action: 'replace-observation',
    evidence,
    evidence_run: 'v3-annual-freshness-recheck-2026-09-30',
    reviewed_at: proof.observed_at,
    note: `Current bounded file evidence retains exact CMS ${record.cms_template_version}, location, address, state and update date ${record.declared_last_updated}. At the 2026-09-30 snapshot the declared date is ${ageDays} days old, so the record is verified stale rather than verified current. This is an observed metadata classification, not a legal-compliance determination.`
  };
  const index = ledger.findIndex(item => item.ccn === record.ccn);
  if (index >= 0) ledger[index] = resolution;
  else ledger.push(resolution);
}
ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');

// Keep Mad River's independently timed pointer proof (Sep. 26) distinct from
// today's file freshness observation (Sep. 30) in the manual sidecar.
const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
const madRiver = manual.records.find(row => row.ccn === '050028');
const madRiverProof = proof.records.find(row => row.ccn === '050028');
if (!madRiver || !madRiverProof) throw new Error('Mad River manual source record missing');
madRiver.latest_file_freshness_recheck = {
  observed_at: proof.observed_at,
  proof_file: proofName,
  mrf_url: madRiverProof.mrf_url,
  mrf_http_status: madRiverProof.mrf_status,
  file_sample_bytes: madRiverProof.range_bytes,
  file_sample_sha256: madRiverProof.range_sha256,
  declared_hospital_name: madRiverProof.declared_hospital_name,
  declared_location_name: madRiverProof.declared_location_name,
  declared_address: madRiverProof.declared_address,
  declared_license_state: madRiverProof.declared_license_state,
  declared_npi: madRiverProof.declared_npi,
  declared_last_updated: madRiverProof.declared_last_updated,
  cms_template_version: madRiverProof.cms_template_version,
  disposition: 'verified-stale-mrf',
  next_action: nextAction,
  pointer_observation_at: madRiverProof.pointer_observed_at,
  pointer_observation_sha256: madRiverProof.pointer_sha256
};
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({
  updated: proof.records.map(row => ({ ccn: row.ccn, finding: 'mrf-stale-over-365-days', ageDays: row.age_days_as_of_observation })),
  proof: proofName
}, null, 2));
