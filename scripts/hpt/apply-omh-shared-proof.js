'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const records = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-omh-shared-proof.json'), 'utf8')).records;
let changed = 0;
for (const observed of records) {
  const resolution = ledger.find(row => row.ccn === observed.ccn);
  if (!resolution || resolution.action !== 'quarantine') throw new Error(`Missing quarantine ${observed.ccn}`);
  const proof = { pointer_sha256: observed.pointer_sha256, payload_sha256: observed.payload_sha256,
    file_sha256: observed.file_sha256, pointer_url: observed.pointer_url, mrf_url: observed.mrf_url,
    http_status: observed.mrf_http_status, observed_at: observed.observed_at,
    mrf_bytes: observed.mrf_bytes, pointer_entry_name: observed.pointer_entry_name,
    observed_hospital_name: observed.observed_hospital_name, observed_location_name: observed.observed_location_name,
    observed_address: observed.observed_address, roster_hospital_name: observed.roster_hospital_name,
    roster_address: observed.roster_address, official_sources: [observed.official_page] };
  const note = `${observed.reason} The assignment remains quarantined pending file root metadata that identifies this facility or explicit publisher clarification that the shared statewide rates cover it.`;
  if (resolution.evidence_run === 'omh-shared-byte-review-2026-09-15'
      && JSON.stringify(resolution.proof) === JSON.stringify(proof) && resolution.note === note) continue;
  resolution.superseded_resolutions = [...(resolution.superseded_resolutions || []),
    { action: resolution.action, reviewed_at: resolution.reviewed_at, note: resolution.note,
      evidence_run: resolution.evidence_run || '', proof: resolution.proof || null }];
  resolution.evidence_run = 'omh-shared-byte-review-2026-09-15';
  resolution.reviewed_at = observed.observed_at;
  resolution.note = note;
  resolution.proof = proof;
  changed++;
}
fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
console.log(JSON.stringify({ changed }, null, 2));
