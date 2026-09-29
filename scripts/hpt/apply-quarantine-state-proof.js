'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const auditDir = path.join(root, 'data/hpt-audit');
const ledgerPath = path.join(auditDir, 'reviewed-resolutions.json');
const proofPath = path.join(auditDir, 'reconciliation-quarantine-state-proof.json');
const nationwidePath = path.join(auditDir, 'nationwide-verification.json');

const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const proof = new Map(JSON.parse(fs.readFileSync(proofPath, 'utf8')).records.map(row => [row.ccn, row]));
const cameronProof = JSON.parse(fs.readFileSync(path.join(auditDir, 'reconciliation-cameron-official-page-proof.json'), 'utf8')).records[0];
const nationwide = new Map(JSON.parse(fs.readFileSync(nationwidePath, 'utf8')).records.map(row => [row.ccn, row]));
const notes = {
  '250174': 'Fresh bounded CSV bytes match Alliance Healthcare System and its Mississippi street address, but the source header declares license_number|GA and also mixes Georgia into the address field. The identity conflict is publisher-supplied and remains quarantined pending a corrected file or publisher clarification.',
  '260057': 'The current official price-transparency page exposes a versioned CSV that was readable with a bounded request. Its header exactly names Cameron Regional Medical Center and its Missouri street address but declares license_number|IN, reproducing the publisher-supplied state conflict independently of the blocked pointer-derived URL. It remains quarantined pending a corrected file or publisher clarification.',
  '371331': 'Fresh bounded CSV bytes match Drumright Regional Hospital and its Oklahoma street address, but the source header declares license_number|KY. The identity conflict is publisher-supplied and remains quarantined pending a corrected file or publisher clarification.',
  '400139': 'Fresh bounded CSV bytes declare Hospital Episcopal San Lucas Ponce at 917 Ave. Tito Castro in Ponce. CCN 400139 is Hospital Episcopal San Lucas Metro in San Juan, so this is a different-campus assignment. It remains quarantined pending a Metro-specific file or publisher clarification.',
  '510094': 'Fresh bounded CSV bytes match Williamson Memorial and its West Virginia street address, but the source header declares license_number|CA. The identity conflict is publisher-supplied and remains quarantined pending a corrected file or publisher clarification.'
};

let changed = 0;
for (const [ccn, note] of Object.entries(notes)) {
  const resolution = ledger.find(row => row.ccn === ccn);
  const observed = ccn === '260057' ? cameronProof : proof.get(ccn);
  const report = nationwide.get(ccn);
  if (!resolution || resolution.action !== 'quarantine') throw new Error(`Missing quarantine resolution ${ccn}`);
  if (!observed || observed.http_status !== 206 || !observed.payload_sha256 || !observed.metadata) throw new Error(`Missing retained file proof ${ccn}`);
  if (!report?.evidence?.pointer_sha256s?.length || !report.mrf_url) throw new Error(`Missing pointer linkage ${ccn}`);
  const nextProof = {
    file_sha256: observed.sha256,
    payload_sha256: observed.payload_sha256,
    pointer_sha256: report.evidence.pointer_sha256s[0],
    pointer_url: report.pointer_url,
    mrf_url: observed.source_url || report.mrf_url,
    http_status: observed.http_status,
    observed_at: observed.observed_at,
    observed_hospital_name: observed.metadata.hospital_name,
    observed_location_name: observed.metadata.location_name,
    observed_address: observed.metadata.address,
    observed_license_state: observed.metadata.license_state,
    roster_state: report.state,
    declared_date: observed.metadata.date,
    cms_template_version: observed.metadata.version,
    ...(ccn === '260057' ? { official_sources: ['https://www.cameronregional.org/price-transparency'] } : {})
  };
  if (resolution.evidence_run === 'quarantine-state-byte-review-2026-09-15'
      && JSON.stringify(resolution.proof) === JSON.stringify(nextProof) && resolution.note === note) continue;
  const superseded = { action: resolution.action, reviewed_at: resolution.reviewed_at, note: resolution.note,
    evidence_run: resolution.evidence_run || '', proof: resolution.proof || null };
  resolution.superseded_resolutions = [...(resolution.superseded_resolutions || []), superseded];
  resolution.evidence_run = 'quarantine-state-byte-review-2026-09-15';
  resolution.reviewed_at = observed.observed_at;
  resolution.note = note;
  resolution.proof = nextProof;
  changed++;
}

fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
console.log(JSON.stringify({ changed, supported_uncertainties: Object.keys(notes) }, null, 2));
