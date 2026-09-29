'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const proof = new Map(JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-remaining-quarantine-proof.json'), 'utf8')).records.map(row => [row.ccn, row]));
const nationwide = new Map(JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-verification.json'), 'utf8')).records.map(row => [row.ccn, row]));

function preserve(resolution) {
  resolution.superseded_resolutions = [...(resolution.superseded_resolutions || []),
    { action: resolution.action, reviewed_at: resolution.reviewed_at, note: resolution.note,
      evidence_run: resolution.evidence_run || '', evidence: resolution.evidence || null, proof: resolution.proof || null }];
}

for (const ccn of ['330141', '390430']) {
  const resolution = ledger.find(row => row.ccn === ccn), observed = proof.get(ccn), report = nationwide.get(ccn);
  if (!resolution || resolution.action !== 'quarantine' || observed?.http_status < 200 || observed?.http_status >= 300
      || !observed.payload_sha256 || !observed.metadata?.hospital_name || !observed.metadata?.address
      || !report?.evidence?.pointer_sha256s?.length) throw new Error(`Incomplete wrong-campus proof ${ccn}`);
  const nextProof = { pointer_sha256: report.evidence.pointer_sha256s[0], payload_sha256: observed.payload_sha256,
    file_sha256: observed.sha256, pointer_url: report.pointer_url, mrf_url: observed.source_url,
    http_status: observed.http_status, observed_at: observed.observed_at,
    observed_hospital_name: observed.metadata.hospital_name, observed_location_name: observed.metadata.location_name,
    observed_address: observed.metadata.address, roster_hospital_name: report.hospital_name,
    roster_city: report.city, official_sources: [resolution.official.page] };
  const note = ccn === '330141'
    ? 'Fresh bounded CSV bytes identify NYU Langone Long Island at 259 1st Street in Mineola, not the former Long Island Community Hospital campus in Patchogue. The wrong-campus assignment remains quarantined pending a Patchogue-specific pointer entry and file.'
    : 'Fresh bounded JSON bytes identify Lehigh Valley Hospital - Dickson City at 330 Main Street, not Lehigh Valley Hospital - Macungie. The wrong-campus assignment remains quarantined pending a Macungie-specific pointer entry and file.';
  if (resolution.evidence_run === 'remaining-quarantine-byte-review-2026-09-15'
      && JSON.stringify(resolution.proof) === JSON.stringify(nextProof) && resolution.note === note) continue;
  preserve(resolution);
  resolution.evidence_run = 'remaining-quarantine-byte-review-2026-09-15';
  resolution.reviewed_at = observed.observed_at;
  resolution.note = note;
  resolution.proof = nextProof;
}

{
  const ccn = '100167', resolution = ledger.find(row => row.ccn === ccn), observed = proof.get(ccn), report = nationwide.get(ccn);
  // Address agreement against the local roster is expected to be false; validate the current CMS/official identity explicitly.
  if (!resolution || resolution.action !== 'quarantine' || observed?.http_status !== 206
      || !observed?.payload_sha256 || observed.metadata?.hospital_name !== 'HCA FLORIDA MERCY HOSPITAL'
      || observed.metadata?.license_state !== 'FL' || !/3663 South Miami Ave/i.test(observed.metadata?.address || ''))
    throw new Error('Incomplete HCA Mercy identity proof');
  const evidence = { identity: 'corroborated', identity_basis: 'reviewed-cms-ccn-official-pointer-and-file-name-address-state',
    pointerUrl: 'https://www.hcafloridahealthcare.com/cms-hpt.txt',
    pointerSha256: '3a0aa2dede5ac96d0ffce378a52c3def50393a44a4514e4337ee4ab45682df46',
    url: observed.source_url, fileSha256: observed.sha256, payloadSha256: observed.payload_sha256,
    http_status: observed.http_status, checked_at: observed.observed_at, date: observed.metadata.date,
    version: observed.metadata.version, officialDomain: 'hcafloridahealthcare.com',
    location_name: observed.metadata.location_name, file_kind: observed.file_kind,
    sourcePageUrl: 'https://www.hcafloridahealthcare.com/patient-resources/patient-financial-resources/pricing-transparency-cms-required-file-of-standard-charges',
    officialSources: ['https://www.cms.gov/medicare/medicare-general-information/medicareapprovedfacilitie/carotid-artery-stenting-facilities-items/mercy-hospital-fl',
      'https://www.hcafloridahealthcare.com/locations/mercy-hospital'],
    rosterAddressException: 'CMS identifies CCN 100167 at 3663 South Miami Avenue and describes it as a campus of Plantation General Hospital; the local roster city is an administrative-campus artifact.' };
  const note = 'Current CMS CCN evidence, HCA official location evidence, the exact official pointer entry, and fresh MRF bytes all identify HCA Florida Mercy Hospital at 3663 South Miami Avenue, Miami. The previous Plantation-address quarantine was based on an administrative-campus roster artifact and is superseded.';
  if (!(resolution.action === 'replace' && resolution.evidence_run === 'hca-mercy-cms-address-review-2026-09-15'
      && JSON.stringify(resolution.evidence) === JSON.stringify(evidence) && resolution.note === note)) {
    preserve(resolution);
    resolution.action = 'replace';
    resolution.evidence_run = 'hca-mercy-cms-address-review-2026-09-15';
    resolution.reviewed_at = observed.observed_at;
    resolution.note = note;
    resolution.evidence = evidence;
    delete resolution.proof;
  }
}

fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
console.log(JSON.stringify({ applied: ['100167'], supported_uncertainties: ['330141', '390430'] }, null, 2));
