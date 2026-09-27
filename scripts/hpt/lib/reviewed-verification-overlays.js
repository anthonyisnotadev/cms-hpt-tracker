'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { normalizeName } = require('./util');
const { strongAddressAgreement } = require('./mrf-header-match');

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const split = value => String(value || '').split('|').map(part => part.trim()).filter(Boolean);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function applyReviewedVerificationOverlays(records, auditDir) {
  const root = path.resolve(auditDir, '../..');
  const overlayPath = path.join(auditDir, 'reconciliation-nationwide-verification-overlays.json');
  if (!fs.existsSync(overlayPath)) return records;
  const document = readJson(overlayPath);
  if (document.schema_version !== 1 || !Array.isArray(document.records))
    throw new Error('Unsupported nationwide verification overlay schema');

  const rawRows = new Map(records.map(record => [record.ccn, record]));
  if (rawRows.size !== records.length) throw new Error('Duplicate CCN in nationwide verification input');
  const overlays = new Map();
  for (const overlay of document.records) {
    if (!overlay.ccn || overlays.has(overlay.ccn)) throw new Error(`Duplicate or missing overlay CCN ${overlay.ccn || ''}`);
    overlays.set(overlay.ccn, overlay);
  }

  const manualDoc = readJson(path.join(auditDir, 'reconciliation-manual-access-observations.json'));
  const manualByCcn = new Map(manualDoc.records.map(record => [record.ccn, record]));
  const byteProofDoc = readJson(path.join(auditDir, 'nationwide-file-byte-proof.json'));
  const roster = new Map(readJson(path.join(root, 'cms_data/hpt/roster.json')).map(record => [record.ccn, record]));

  return records.map(record => {
    const overlay = overlays.get(record.ccn);
    if (!overlay) return record;
    const base = overlay.base || {};
    const actualBase = {
      disposition: record.disposition,
      observed_at: record.observed_at,
      mrf_http_status: String(record.mrf_http_status || ''),
      mrf_url_sha256: sha256(String(record.mrf_url || '')),
      facility_identity: record.facility_identity,
      declared_hospital_name: record.declared_hospital_name || '',
      declared_location_name: record.declared_location_name || '',
      declared_address: record.declared_address || '',
      declared_license_state: record.declared_license_state || '',
      declared_last_updated: record.declared_last_updated || '',
      cms_template_version: record.cms_template_version || ''
    };
    const exactBase = Object.keys(actualBase).every(key => actualBase[key] === base[key]);

    const proofPath = path.resolve(auditDir, overlay.source_proof_file || '');
    if (!overlay.source_proof_file || !proofPath.startsWith(path.resolve(auditDir) + path.sep) || !fs.existsSync(proofPath))
      throw new Error(`Nationwide overlay ${record.ccn} has no safe retained proof file`);
    const proof = readJson(proofPath);
    const manual = manualByCcn.get(record.ccn);
    const rosterRow = roster.get(record.ccn);
    if (proof.ccn !== record.ccn || !manual || manual.ccn !== record.ccn || !rosterRow)
      throw new Error(`Nationwide overlay ${record.ccn} lost its exact-CCN evidence binding`);

    const byteProofDoc = readJson(path.join(auditDir, 'nationwide-file-byte-proof.json'));
    const byteProof = byteProofDoc.records.find(item => item.ccns?.includes(record.ccn)
      && item.ccns?.includes(record.ccn)
      && item.raw_artifact
      && item.http_status === 206
      && Number(item.bytes_retained) >= 65536
      && /^[a-f0-9]{64}$/.test(String(item.sha256 || '')));
    if (!byteProof || proof.file_url !== manual.facility_file_url
      || manual.proof_file !== overlay.source_proof_file
      || manual.page_mrf_url !== overlay.page_linked_mrf_url
      || Number(manual.facility_file_status) !== 206
      || Number(manual.official_pricing_page_status) !== 200
      || Number(proof.official_page_http_status) !== 200
      || ![record.official_domain, 'tristarhealth.com'].includes(new URL(manual.official_pricing_page).hostname.replace(/^www\./, ''))
      || ![record.official_domain, 'tristarhealth.com'].includes(new URL(proof.official_pricing_page).hostname.replace(/^www\./, ''))
      || new URL(overlay.page_linked_mrf_url).protocol !== 'https:'
      || Number(proof.file_http_status) !== 206
      || Number(proof.sample_bytes) < 65536
      || proof.root_pointer_status !== overlay.root_pointer_observation?.http_status
      || proof.cms_template_version !== '3.0.0'
      || !proof.attestation || !proof.usable_rows_observed
      || !Number.isFinite(Date.parse(byteProof.checked_at))
      || !Number.isFinite(Date.parse(proof.declared_last_updated)))
      throw new Error(`Nationwide overlay ${record.ccn} source proof is incomplete or no longer matches`);

    const rawFilePath = path.resolve(root, byteProof.raw_artifact);
    if (!rawFilePath.startsWith(root + path.sep) || !fs.existsSync(rawFilePath))
      throw new Error(`Nationwide overlay ${record.ccn} retained byte sample is missing`);
    const bytes = fs.readFileSync(rawFilePath);
    if (bytes.length !== byteProof.bytes_retained || sha256(bytes) !== byteProof.sha256)
      throw new Error(`Nationwide overlay ${record.ccn} retained byte sample hash changed`);

    const candidate = byteProof.parsed_root_candidates?.find(item => item.fileKind === 'json'
      && item.cmsVersion === proof.cms_template_version
      && item.declaredLastUpdated === proof.declared_last_updated
      && normalizeName(item.mrfHospitalName) === normalizeName(proof.declared_hospital_name)
      && item.mrfLicenseState === proof.declared_license_state
      && split(item.mrfAddress).some(address => strongAddressAgreement(rosterRow.address, address)));
    const cms = manual.cms_record;
    if (!candidate || normalizeName(rosterRow.name) !== normalizeName(proof.declared_hospital_name)
      || rosterRow.state !== proof.declared_license_state
      || normalizeName(cms?.facility_name) !== normalizeName(rosterRow.name)
      || cms?.facility_id !== record.ccn || cms?.state !== rosterRow.state
      || !split(candidate.mrfLocationName).some(name => normalizeName(name) === normalizeName(rosterRow.name))
      || !split(candidate.mrfAddress).some(address => strongAddressAgreement(cms.address, address))
      || proof.declared_npi !== '1023055126'
      || proof.declared_license_number !== '136'
      || normalizeName(manual.official_facility_name) !== normalizeName(rosterRow.name)
      || !split(proof.declared_addresses).some(address => strongAddressAgreement(rosterRow.address, address)))
      throw new Error(`Nationwide overlay ${record.ccn} facility identity or metadata no longer agrees`);

    if (!exactBase) {
      const alreadyApplied = record.disposition === 'verified-current-mrf'
        && record.mrf_url === overlay.page_linked_mrf_url
        && record.observed_at === byteProof.checked_at
        && record.declared_last_updated === candidate.declaredLastUpdated
        && record.cms_template_version === candidate.cmsVersion
        && record.declared_license_state === candidate.mrfLicenseState
        && record.declared_hospital_name === candidate.mrfHospitalName;
      if (alreadyApplied) return record;
      throw new Error(`Nationwide overlay ${record.ccn} base observation changed; review before applying cached evidence`);
    }

    return {
      ...record,
      mrf_url: overlay.page_linked_mrf_url,
      mrf_state: 'verified-current-v3',
      mrf_http_status: String(byteProof.http_status),
      browser_mrf_status: 'retrieved',
      browser_mrf_observed_at: byteProof.checked_at,
      browser_mrf_final_url: '',
      browser_identity_gate: 'official-page-file-header-name-address-state-agree',
      header_identity_gate: '',
      facility_identity: 'corroborated-by-reviewed-browser-read',
      declared_hospital_name: candidate.mrfHospitalName,
      declared_location_name: candidate.mrfLocationName,
      declared_address: candidate.mrfAddress,
      declared_license_number: proof.declared_license_number,
      declared_license_state: candidate.mrfLicenseState,
      declared_npi: proof.declared_npi,
      declared_last_updated: candidate.declaredLastUpdated,
      cms_template_version: candidate.cmsVersion,
      metadata_source: 'header-observation',
      observed_at: byteProof.checked_at,
      pointer_state: 'not-retrieved-from-checked-locations',
      pointer_result: 'http-not-found',
      pointer_reason: `The root cms-hpt.txt returned HTTP ${overlay.root_pointer_observation.http_status} on ${overlay.root_pointer_observation.observed_at}; earlier hash-corroborated pointer bytes are retained separately. The first-party pricing page independently links the current file.`,
      pointer_observed_at: overlay.root_pointer_observation.observed_at,
      next_action: overlay.current_file_next_action,
      evidence: {
        ...(record.evidence || {}),
        reviewed_page_file_overlay: {
          source_proof_file: overlay.source_proof_file,
          page_linked_mrf_url: overlay.page_linked_mrf_url,
          byte_sample_bytes: byteProof.bytes_retained,
          byte_sample_sha256: byteProof.sha256,
          byte_sample_checked_at: byteProof.checked_at,
          last_modified: proof.last_modified,
          etag: proof.etag,
          root_pointer_status: overlay.root_pointer_observation.http_status,
          root_pointer_observed_at: overlay.root_pointer_observation.observed_at
        }
      },
      reviewed_page_file_overlay: overlay.source_proof_file
    };
  });
}

module.exports = { applyReviewedVerificationOverlays };
