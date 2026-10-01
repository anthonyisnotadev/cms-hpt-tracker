'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { normalizeName, parseCSV } = require('./util');
const { strongAddressAgreement } = require('./mrf-header-match');

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const split = value => String(value || '').split('|').map(part => part.trim()).filter(Boolean);
const INCOMPLETE_RETRY_DISPOSITIONS = new Set([
  'pointer-not-retrieved', 'pointer-access-denied-to-client', 'pointer-discovery-incomplete',
  'pointer-facility-match-unresolved', 'mrf-request-unsuccessful', 'mrf-verification-pending',
  'pointer-linked-file-not-probed', 'pointer-linked-file-review-pending'
]);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function applyReviewedPointerFileIdentity(record, overlay, auditDir, root, rosterRow) {
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
  if (!overlay.source_proof_file || !proofPath.startsWith(path.resolve(auditDir) + path.sep)
    || !fs.existsSync(proofPath)) throw new Error(`Nationwide overlay ${record.ccn} has no safe pointer/file identity proof`);
  const proof = readJson(proofPath);
  if (proof.schema_version !== 1 || proof.ccn !== record.ccn
    || proof.audit_id !== 'reconciliation-maniilaq-browser-byte-identity-proof-2026-09-17'
    || proof.prior_complete_pointer_file_review?.proof_file !== 'reconciliation-maniilaq-proof.json'
    || proof.later_exact_url_browser_byte_proof?.proof_file !== 'nationwide-file-byte-proof.json'
    || proof.browser_review?.proof_file !== 'nationwide-browser-reviews.json')
    throw new Error(`Nationwide overlay ${record.ccn} has an unexpected pointer/file proof identity`);
  const fileProofDoc = readJson(path.join(auditDir, proof.later_exact_url_browser_byte_proof?.proof_file || ''));
  const sample = fileProofDoc.records.find(item => item.ccns?.includes(record.ccn)
    && item.url === proof.later_exact_url_browser_byte_proof.url);
  const priorProofDoc = readJson(path.join(auditDir, proof.prior_complete_pointer_file_review?.proof_file || ''));
  const priorProof = priorProofDoc.records.find(item => item.ccn === record.ccn);
  const browserDoc = readJson(path.join(auditDir, proof.browser_review?.proof_file || ''));
  const browserReview = browserDoc.records.find(item => item.kind === 'mrf'
    && item.target === proof.later_exact_url_browser_byte_proof.url);
  const declared = sample?.parsed_root_candidates?.find(item => item.fileKind === 'csv');
  const identity = proof.facility_identity_reconciliation || {};
  const pointerPath = path.resolve(root, sample?.raw_artifact || '');
  if (!exactBase && !(record.disposition === 'verified-current-mrf'
    && record.mrf_url === proof.later_exact_url_browser_byte_proof?.url
    && record.observed_at === proof.later_exact_url_browser_byte_proof?.checked_at
    && record.facility_identity === 'corroborated-by-reviewed-browser-read'))
    throw new Error(`Nationwide overlay ${record.ccn} base observation changed; review before applying pointer/file proof`);
  if (!priorProof || priorProof.pointer_http_status !== 200
    || priorProof.pointer_sha256 !== record.pointer_corpus_sha256
    || priorProof.pointer_location_name !== 'MANIILAQ HEALTH CENTER'
    || priorProof.mrf_url !== record.mrf_url || priorProof.mrf_http_status !== 200
    || priorProof.mrf_bytes !== 3705850
    || priorProof.mrf_sha256 !== '6ee15e3f6d0f761e36bfd41f9b256cb6ece229007e7dfe3317d53644e3cd7702'
    || !sample || sample.http_status !== 200 || sample.bytes_retained !== 262144
    || proof.later_exact_url_browser_byte_proof.url !== record.mrf_url
    || sample.checked_at !== proof.reviewed_observed_at
    || sample.sha256 !== proof.later_exact_url_browser_byte_proof.sha256
    || !declared || declared.mrfHospitalName !== 'MANIILAQ ASSOCIATION'
    || declared.mrfLocationName !== 'MANIILAQ ASSOCIATION'
    || declared.mrfAddress !== '436 5th Ave Kotzebue AK 99752'
    || declared.mrfLicenseState !== rosterRow.state || declared.cmsVersion !== '3.0.0'
    || declared.declaredLastUpdated !== '2026-07-16'
    || !browserReview || browserReview.status !== 'retrieved' || browserReview.identity !== 'corroborated'
    || browserReview.observed_at !== proof.browser_review.observed_at
    || !record.evidence?.pointer_location_names?.includes('MANIILAQ HEALTH CENTER')
    || rosterRow.ccn !== record.ccn || rosterRow.state !== 'AK'
    || identity.roster_address !== 'PO BOX 43'
    || identity.official_physical_address !== '436 5th Avenue, Kotzebue, AK 99752'
    || identity.official_contact_page !== 'https://www.maniilaq.org/contact/'
    || identity.official_health_services_page !== 'https://www.maniilaq.org/health-services/'
    || proof.current_official_source_recheck?.contact_page !== identity.official_contact_page
    || proof.current_official_source_recheck?.health_services_page !== identity.official_health_services_page
    || !Number.isFinite(Date.parse(proof.current_official_source_recheck?.observed_at))
    || !/P\.?O\.?\s*Box 43.*436 5th Avenue.*Kotzebue/i.test(proof.current_official_source_recheck?.contact_page_facts || '')
    || !/Maniilaq Association.*Maniilaq Health Center.*Kotzebue/i.test(proof.current_official_source_recheck?.health_services_page_facts || '')
    || !pointerPath.startsWith(root + path.sep) || !fs.existsSync(pointerPath))
    throw new Error(`Nationwide overlay ${record.ccn} pointer/file identity proof is incomplete or no longer matches`);
  const sampleBytes = fs.readFileSync(pointerPath);
  if (sampleBytes.length !== sample.bytes_retained || sha256(sampleBytes) !== sample.sha256)
    throw new Error(`Nationwide overlay ${record.ccn} retained browser sample hash changed`);
  if (exactBase) {
    const retry = {
      disposition: record.disposition,
      observed_at: record.observed_at,
      mrf_http_status: String(record.mrf_http_status || ''),
      pointer_state: record.pointer_state || '',
      pointer_result: record.pointer_result || '',
      mrf_url_sha256: sha256(String(record.mrf_url || '')),
      next_action: record.next_action || ''
    };
    return {
      ...record,
      disposition: 'verified-current-mrf',
      mrf_state: 'verified-current-v3',
      mrf_http_status: '200',
      browser_mrf_status: 'retrieved',
      browser_mrf_observed_at: sample.checked_at,
      browser_mrf_final_url: sample.final_url,
      browser_identity_gate: 'reviewed-file-address-equivalence',
      facility_identity: 'corroborated-by-reviewed-browser-read',
      declared_hospital_name: declared.mrfHospitalName,
      declared_location_name: declared.mrfLocationName,
      declared_address: declared.mrfAddress,
      declared_license_state: declared.mrfLicenseState,
      declared_last_updated: declared.declaredLastUpdated,
      cms_template_version: declared.cmsVersion,
      metadata_source: 'reviewed-browser',
      observed_at: sample.checked_at,
      address_reconciliation: {
        ccn: record.ccn,
        state: rosterRow.state,
        reviewed_on: sample.checked_at.slice(0, 10),
        roster_address: identity.roster_address,
        file_address: declared.mrfAddress,
        mrf_url: sample.url,
        browser_observed_at: sample.checked_at,
        source_url: identity.official_contact_page,
        additional_source_url: identity.official_health_services_page,
        basis: identity.basis
      },
      latest_retry_observation: { ...retry, superseded_by_reviewed_pointer_file_identity: true },
      observation_role: 'current-observation',
      latest_observation_superseded: false,
      standing_evidence_retained: false,
      standing_evidence_reason: '',
      superseding_resolution_observed_at: '',
      superseding_resolution_run: '',
      prior_finding: 'compliant-observed',
      next_action: 'Retain the current pointer-linked CMS v3 file evidence; recheck on a publisher pointer or file change.',
      evidence: {
        ...record.evidence,
        header_match_reason: 'reviewed-file-address-equivalence',
        reviewed_pointer_file_identity_overlay: {
          source_proof_file: overlay.source_proof_file,
          pointer_sha256: priorProof.pointer_sha256,
          complete_mrf_bytes: priorProof.mrf_bytes,
          complete_mrf_sha256: priorProof.mrf_sha256,
          latest_sample_bytes: sample.bytes_retained,
          latest_sample_sha256: sample.sha256,
          latest_sample_checked_at: sample.checked_at
        }
      },
      reviewed_pointer_file_identity_overlay: overlay.source_proof_file
    };
  }
  return record;
}

function applyReviewedTrinityOperatorAliasPointerFile(record, overlay, auditDir, root, rosterRow) {
  const proofPath = path.resolve(auditDir, overlay.source_proof_file || '');
  if (!overlay.source_proof_file || !proofPath.startsWith(path.resolve(auditDir) + path.sep)
    || !fs.existsSync(proofPath)) throw new Error(`Nationwide overlay ${record.ccn} has no safe Trinity pointer/file proof`);
  const proof = readJson(proofPath);
  const pointer = proof.sources?.official_current_root_pointer || {};
  const pricing = proof.sources?.official_current_pricing_page || {};
  const recheck = proof.latest_live_recheck_2026_09_30 || {};
  const file = proof.mrf || {};
  const base = overlay.base || {};
  const actualBase = {
    disposition: record.disposition,
    observed_at: record.observed_at,
    mrf_http_status: String(record.mrf_http_status || ''),
    mrf_url_sha256: sha256(String(record.mrf_url || '')),
    pointer_state: record.pointer_state || '',
    pointer_result: record.pointer_result || ''
  };
  const exactBase = Object.keys(actualBase).every(key => actualBase[key] === base[key]);
  const alreadyApplied = record.disposition === 'verified-current-mrf'
    && record.mrf_url === file.url && record.observed_at === recheck.observed_at
    && record.declared_last_updated === '2026-03-30' && record.cms_template_version === '3.0.0';
  const pointerPath = path.resolve(root, pointer.retained_raw_file || '');
  const mrfPath = path.resolve(root, file.retained_file || '');
  if (!pointer.retained_raw_file || !pointerPath.startsWith(root + path.sep) || !fs.existsSync(pointerPath)
    || !file.retained_file || !mrfPath.startsWith(root + path.sep) || !fs.existsSync(mrfPath))
    throw new Error(`Nationwide overlay ${record.ccn} retained pointer/file proof is missing or out of scope`);
  const pointerBytes = fs.readFileSync(pointerPath);
  const pointerSha = sha256(pointerBytes);
  const pointerFields = Object.fromEntries(pointerBytes.toString('utf8').split(/\r?\n/).map(line => {
    const splitAt = line.indexOf(':');
    return splitAt < 0 ? null : [line.slice(0, splitAt).trim().toLowerCase(), line.slice(splitAt + 1).trim()];
  }).filter(Boolean));
  const fileBytes = fs.readFileSync(mrfPath);
  const fileSha = sha256(fileBytes);
  const parsed = parseCSV(fileBytes.toString('utf8'));
  const metadata = parsed[1] || [];
  const dataHeaders = parsed[2] || [];
  const badRows = parsed.slice(3).filter(row => row.length !== 95).length;
  const sampleBytes = Number(recheck.mrf_bounded_recheck?.sample_bytes);
  const liveFilePrefixMatches = sampleBytes > 0
    && fileBytes.subarray(0, sampleBytes).length === sampleBytes
    && sha256(fileBytes.subarray(0, sampleBytes)) === recheck.mrf_bounded_recheck?.sample_sha256;
  const contact = proof.sources?.official_current_trinity_contact_page || {};
  const facilityPage = proof.sources?.official_current_trinity_facility_page || {};
  const identity = proof.identity_reconciliation || {};
  const exactSources = proof.audit_id === 'reconciliation-trinity-hospital-ccn-051315-pointer-alias-full-file-proof-2026-09-30'
    && proof.ccn === record.ccn && proof.hospital === 'TRINITY HOSPITAL'
    && pointer.url === 'https://mcmedical.org/cms-hpt.txt' && pointer.http_status === 200
    && pointer.bytes === pointerBytes.length && pointer.sha256 === pointerSha
    && pointer.location_name === 'MOUNTAIN COMMUNITIES HEALTHCARE DISTRICT'
    && pointerFields['location-name'] === pointer.location_name
    && pointerFields['source-page-url'] === pointer.source_page_url
    && pointerFields['mrf-url'] === pointer.mrf_url
    && pointer.mrf_url === file.url && pointer.mrf_url === recheck.mrf_bounded_recheck?.url
    && pointer.entry_count === 1
    && pricing.url === 'https://www.mcmedical.org/price-transparency'
    && pricing.http_status === 200
    && /Machine Readable File/.test(pricing.source_html_observation || '')
    && /208236808_trinity-hospital_standardcharges\.csv/.test(pricing.source_html_observation || '')
    && /Trinity Hospital and Clinics/.test(pricing.source_html_observation || '')
    && recheck.official_price_page_browser_observation?.url === pricing.url
    && recheck.official_price_page_browser_observation?.download_filename === '208236808_trinity-hospital_standardcharges.csv'
    && Number(recheck.mrf_bounded_recheck?.http_status) === 206
    && recheck.mrf_bounded_recheck?.content_range === `bytes 0-${sampleBytes - 1}/${file.complete_bytes}`
    && recheck.mrf_bounded_recheck?.matches_retained_complete_file_prefix === true && liveFilePrefixMatches
    && sampleBytes === 131072
    && recheck.mrf_bounded_recheck?.sample_sha256 === '17ef63a28bf3ccb219c6cf695b7bd2875912a244fc45b56a376f692241e1333f'
    && Number(file.http_status) === 200 && file.complete_bytes === fileBytes.length && file.complete_sha256 === fileSha
    && file.url === 'https://www.mcmedical.org/208236808_trinity-hospital_standardcharges.csv'
    && file.declared_hospital_name === 'MOUNTAIN COMMUNTIES HEALTHCARE DISTRICT'
    && file.declared_location_name === 'MOUNTAIN COMMUNITIES HEALTHCARE DISTRICT'
    && file.declared_address === '60 EASTER AVENUE, PO BOX 1229, WEAVERVILLE, CA, 96093-1229'
    && file.declared_license_state === 'CA' && file.declared_license_number === '230000038'
    && file.declared_date === '2026-03-30' && file.cms_template_version === '3.0.0'
    && file.attestation === true && file.metadata_columns === 95 && file.charge_columns === 95
    && file.parsed_data_rows === 8701 && file.rows_with_unexpected_column_count === 0
    && parsed.length === file.parsed_data_rows + 3 && dataHeaders.length === 95 && badRows === 0
    && metadata[0] === file.declared_hospital_name && metadata[1] === '3/30/2026'
    && metadata[2] === file.cms_template_version && metadata[3] === file.declared_location_name
    && metadata[4] === file.declared_address && metadata[6] === file.declared_license_number
    && metadata[7] === 'Kelly Simpson' && metadata[8] === 'TRUE'
    && rosterRow?.ccn === record.ccn && rosterRow.name === 'TRINITY HOSPITAL'
    && rosterRow.address === '60 EASTER AVENUE' && rosterRow.city === 'WEAVERVILLE'
    && rosterRow.state === 'CA' && rosterRow.zip === '96093'
    && strongAddressAgreement(rosterRow.address, file.declared_address)
    && contact.url === 'https://www.mcmedical.org/contact-us'
    && contact.department === 'Trinity Hospital' && contact.street === '60 Easter Ave'
    && contact.city_state_zip === 'Weaverville, CA 96093'
    && facilityPage.url === 'https://www.mcmedical.org/trinity-hospital'
    && /titled Trinity Hospital/.test(facilityPage.facts || '')
    && /exact street, city and California state agree/i.test(identity.address_match || '')
    && proof.disposition === 'verified-current-mrf'
    && proof.effect?.includes('complete hash-bound CMS v3 file');
  if (!exactSources) throw new Error(`Nationwide overlay ${record.ccn} Trinity pointer/file identity evidence is incomplete or no longer matches`);
  if (alreadyApplied) return record;
  if (!exactBase) throw new Error(`Nationwide overlay ${record.ccn} base observation changed; review before applying Trinity pointer/file evidence`);

  const retry = {
    disposition: record.disposition,
    observed_at: record.observed_at,
    mrf_http_status: String(record.mrf_http_status || ''),
    pointer_state: record.pointer_state || '',
    pointer_result: record.pointer_result || '',
    mrf_url_sha256: sha256(String(record.mrf_url || '')),
    next_action: record.next_action || '',
    superseded_by_reviewed_operator_alias_pointer_file_identity: true
  };
  return {
    ...record,
    disposition: 'verified-current-mrf',
    mrf_state: 'verified-current-v3',
    mrf_http_status: '200',
    pointer_state: 'retrieved-facility-match',
    pointer_result: 'retrieved',
    pointer_observed_at: pointer.observed_at,
    pointer_corpus_checked_url: pointer.url,
    pointer_corpus_final_url: pointer.url,
    pointer_corpus_sha256: pointerSha,
    pointer_corpus_observed_at: pointer.observed_at,
    pointer_corpus_raw_integrity: 'hash-corroborated; raw pointer retained only in private local corpus',
    pointer_reason: 'The current district-operator pointer has one entry naming its Trinity Hospital MRF, independently listed by the operator price-transparency page; exact file metadata matches the roster campus address and California license state.',
    facility_identity: 'corroborated',
    browser_identity_gate: 'official-facility-page-current-pointer-and-complete-csv-address-state-metadata-agree',
    header_identity_gate: 'exact-campus-address-and-license-state-agree; hospital_name spelling variance recorded',
    declared_hospital_name: file.declared_hospital_name,
    declared_location_name: file.declared_location_name,
    declared_address: file.declared_address,
    declared_license_number: file.declared_license_number,
    declared_license_state: file.declared_license_state,
    declared_npi: '1750462271|1407027568',
    declared_last_updated: '2026-03-30',
    cms_template_version: '3.0.0',
    metadata_source: 'reviewed-complete-pointer-linked-csv',
    observed_at: recheck.observed_at,
    prior_finding: 'compliant-observed',
    observation_role: 'current-observation',
    latest_observation_superseded: false,
    standing_evidence_retained: false,
    standing_evidence_reason: '',
    latest_retry_observation: retry,
    next_action: 'Recheck the pointer or MRF after a source change. The exact current operator-linked file has a complete retained hash and 8,701 parsed data rows; this is not a legal-compliance or line-item conclusion.',
    evidence: {
      ...record.evidence,
      reviewed_operator_alias_pointer_file_identity: {
        source_proof_file: overlay.source_proof_file,
        pointer_sha256: pointerSha,
        pointer_observed_at: pointer.observed_at,
        file_sha256: fileSha,
        complete_file_bytes: fileBytes.length,
        complete_file_observed_at: proof.observed_at,
        latest_live_prefix_sha256: recheck.mrf_bounded_recheck.sample_sha256,
        latest_live_prefix_matches_complete_file: liveFilePrefixMatches,
        official_pricing_page_url: pricing.url,
        declared_hospital_name: file.declared_hospital_name,
        declared_location_name: file.declared_location_name,
        declared_address: file.declared_address,
        declared_license_state: file.declared_license_state,
        declared_last_updated: '2026-03-30',
        cms_template_version: '3.0.0',
        attestation: true,
        parsed_data_rows: parsed.length - 3,
        review_note: 'The operator name in the header has a one-letter omission, while the location name, first-party Trinity pages, exact street/city/state/license, and exact root-pointer MRF URL corroborate the facility. The literal typo is preserved. A later pointer retry was blocked and yielded no bytes; it does not displace the same-day successful hash-bound pointer result.'
      }
    },
    reviewed_operator_alias_pointer_file_identity: overlay.source_proof_file
  };
}

function applyReviewedCurrentPointerFileIdentity(record, overlay, auditDir, root, rosterRow) {
  const proofPath = path.resolve(auditDir, overlay.source_proof_file || '');
  if (!overlay.source_proof_file || !proofPath.startsWith(path.resolve(auditDir) + path.sep)
    || !fs.existsSync(proofPath)) throw new Error(`Nationwide overlay ${record.ccn} has no safe current-pointer/file proof`);
  const proof = readJson(proofPath);
  const current = proof.latest_source_recheck_2026_09_30 || {};
  const base = overlay.base || {};
  const actualBase = {
    disposition: record.disposition,
    observed_at: record.observed_at,
    mrf_http_status: String(record.mrf_http_status || ''),
    mrf_url_sha256: sha256(String(record.mrf_url || '')),
    pointer_state: record.pointer_state || '',
    pointer_result: record.pointer_result || ''
  };
  const exactBase = Object.keys(actualBase).every(key => actualBase[key] === base[key]);
  const alreadyApplied = record.disposition === 'verified-current-mrf'
    && record.mrf_url === proof.mrf_url
    && record.observed_at === current.observed_at
    && record.declared_last_updated === proof.declared_last_updated
    && record.cms_template_version === proof.cms_template_version;
  if (!exactBase && alreadyApplied) return record;
  if (!exactBase) throw new Error(`Nationwide overlay ${record.ccn} base observation changed; review before applying current-pointer/file evidence`);

  const manualDoc = readJson(path.join(auditDir, 'reconciliation-manual-access-observations.json'));
  const manual = manualDoc.records.find(item => item.ccn === record.ccn);
  const resolutions = readJson(path.join(auditDir, 'reviewed-resolutions.json'));
  const resolution = resolutions.find(item => item.ccn === record.ccn);
  const bytePath = path.resolve(root, current.mrf_sample_artifact || '');
  if (!bytePath.startsWith(root + path.sep) || !fs.existsSync(bytePath))
    throw new Error(`Nationwide overlay ${record.ccn} retained current file sample is missing`);
  const sample = fs.readFileSync(bytePath);
  const rows = parseCSV(sample.toString('utf8'));
  const metadata = rows[1] || [];
  const pointerSha = String(current.pointer_sha256 || '').toLowerCase();
  const fileSha = sha256(sample);
  const pointerAndHeaderAgree = proof.ccn === record.ccn
    && proof.pointer_url === 'https://www.sutterhealth.org/cms-hpt.txt'
    && proof.mrf_url === proof.pointer_declared_mrf_url
    && proof.mrf_url === current.pointer_declared_mrf_url
    && proof.official_domain === 'https://www.sutterhealth.org/'
    && proof.pointer_status === 200 && proof.mrf_status === 206
    && current.pointer_url === proof.pointer_url && current.pointer_http_status === 200
    && current.pointer_hash_matches_reviewed_resolution === true
    && pointerSha === String(resolution?.evidence?.pointerSha256 || '').toLowerCase()
    && Number(current.pointer_bytes) > 0
    && Number(current.mrf_http_status) === 206
    && current.mrf_content_range === 'bytes 0-262143/18532238'
    && Number(current.mrf_sample_bytes) === 262144 && sample.length === 262144
    && current.mrf_sample_sha256 === fileSha
    && proof.mrf_url === resolution?.evidence?.url
    && resolution?.evidence?.pointerUrl === proof.pointer_url
    && resolution?.evidence?.header_address === proof.declared_address
    && resolution?.evidence?.header_state === proof.declared_license_state
    && resolution?.evidence?.date === proof.declared_last_updated
    && resolution?.evidence?.version === proof.cms_template_version
    && resolution?.evidence?.fileSha256 === '0dc4bf3c43403882faa3a0cbc7bbba33b625a7f565520f3a3b9bb60e4a5f8b64'
    && manual?.proof_file === overlay.source_proof_file
    && manual?.manual_disposition === 'verified-current-mrf'
    && manual?.observed_at === proof.observed_at
    && manual?.pointer_url === proof.pointer_url
    && manual?.pointer_declared_mrf_url === proof.mrf_url
    && manual?.mrf_url === proof.mrf_url
    && Number(manual?.pointer_status) === 200 && Number(manual?.mrf_status) === 206
    && manual?.declared_hospital_name === proof.declared_hospital_name
    && manual?.declared_location_name === proof.declared_location_name
    && manual?.declared_address === proof.declared_address
    && manual?.declared_license_state === proof.declared_license_state
    && manual?.declared_last_updated === proof.declared_last_updated
    && manual?.cms_template_version === proof.cms_template_version
    && manual?.attestation === proof.attestation
    && rosterRow?.ccn === record.ccn && current.roster_ccn === record.ccn
    && rosterRow.state === 'CA' && current.roster_state === rosterRow.state
    && current.roster_address === `${rosterRow.address}, ${rosterRow.city}, ${rosterRow.state} ${rosterRow.zip}`
    && normalizeName(proof.declared_hospital_name) === normalizeName(manual.declared_hospital_name)
    && normalizeName(proof.declared_location_name) === normalizeName(manual.declared_location_name)
    && proof.declared_address === manual.declared_address
    && proof.declared_license_state === rosterRow.state
    && proof.declared_last_updated === '2026-04-01'
    && proof.cms_template_version === '3.0.0'
    && proof.attestation === true && proof.file_kind === 'csv'
    && metadata[0] === proof.declared_hospital_name
    && metadata[1] === proof.declared_last_updated
    && metadata[2] === proof.cms_template_version
    && metadata[3] === proof.declared_location_name
    && metadata[4] === proof.declared_address
    && metadata[5] === current.declared_npi
    && metadata[6] === current.declared_license_number
    && metadata[7] === 'true'
    && proof.next_action === 'Retain as verified current MRF and recheck on the next pointer update.'
    && Number.isFinite(Date.parse(current.observed_at))
    && Date.parse(current.observed_at) > Date.parse(record.observed_at)
    && Date.parse(current.observed_at) >= Date.parse(proof.observed_at);
  if (!pointerAndHeaderAgree)
    throw new Error(`Nationwide overlay ${record.ccn} current pointer/file identity evidence is incomplete or no longer matches`);

  const retry = {
    disposition: record.disposition,
    observed_at: record.observed_at,
    mrf_http_status: String(record.mrf_http_status || ''),
    pointer_state: record.pointer_state || '',
    pointer_result: record.pointer_result || '',
    mrf_url_sha256: sha256(String(record.mrf_url || '')),
    next_action: record.next_action || '',
    superseded_by_reviewed_current_pointer_file_identity: true
  };
  const note = 'A hash-matched current Sutter root pointer and fresh bounded header bind the Mills-Peninsula CSV to CCN 050007. The later generic pointer-match retry is retained in latest_retry_observation; it did not identify this exact entry and does not negate the reviewed evidence. This is pointer/file/header verification, not full-file or line-item validation and not a legal-compliance conclusion.';
  return {
    ...record,
    disposition: 'verified-current-mrf',
    mrf_state: 'verified-current-v3',
    mrf_http_status: '206',
    browser_mrf_status: 'retrieved',
    browser_mrf_observed_at: current.observed_at,
    browser_mrf_final_url: proof.mrf_url,
    pointer_state: 'retrieved-facility-match',
    pointer_result: 'retrieved',
    pointer_observed_at: current.observed_at,
    pointer_corpus_checked_url: proof.pointer_url,
    pointer_corpus_final_url: proof.pointer_url,
    pointer_corpus_sha256: pointerSha,
    pointer_corpus_observed_at: current.observed_at,
    pointer_corpus_raw_integrity: 'current-response-hash-matched-reviewed-pointer; raw-body-omitted-for-contact-privacy',
    pointer_reason: 'Fresh current root-pointer bytes match the reviewed Sutter pointer hash and contain the exact Mills-Peninsula MRF URL; the exact file header matches the facility roster identity.',
    facility_identity: 'corroborated',
    browser_identity_gate: 'current-pointer-and-bounded-file-header-name-address-state-date-version-attestation-agree',
    header_identity_gate: 'exact-facility-header-and-roster-address-state-agree',
    declared_hospital_name: proof.declared_hospital_name,
    declared_location_name: proof.declared_location_name,
    declared_address: proof.declared_address,
    declared_license_number: current.declared_license_number,
    declared_license_state: proof.declared_license_state,
    declared_npi: current.declared_npi,
    declared_last_updated: proof.declared_last_updated,
    cms_template_version: proof.cms_template_version,
    metadata_source: 'reviewed-current-pointer-and-file-header',
    observed_at: current.observed_at,
    prior_finding: 'compliant-observed',
    observation_role: 'current-observation',
    latest_observation_superseded: false,
    standing_evidence_retained: false,
    standing_evidence_reason: '',
    latest_retry_observation: retry,
    next_action: 'Retain the verified current pointer-linked CMS 3.0.0 MRF evidence. Recheck after a pointer or file change; this is bounded header/sample evidence, not complete-file or line-item validation.',
    evidence: {
      ...record.evidence,
      reviewed_current_pointer_file_identity: {
        source_proof_file: overlay.source_proof_file,
        pointer_sha256: pointerSha,
        pointer_response_bytes: current.pointer_bytes,
        file_sample_bytes: sample.length,
        file_sample_sha256: fileSha,
        file_sample_checked_at: current.observed_at,
        declared_hospital_name: proof.declared_hospital_name,
        declared_location_name: proof.declared_location_name,
        declared_address: proof.declared_address,
        declared_license_state: proof.declared_license_state,
        declared_last_updated: proof.declared_last_updated,
        cms_template_version: proof.cms_template_version,
        attestation: proof.attestation,
        review_note: note
      }
    },
    reviewed_current_pointer_file_identity: overlay.source_proof_file
  };
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
    if (overlay.type === 'reviewed-pointer-file-identity')
      return applyReviewedPointerFileIdentity(record, overlay, auditDir, root, roster.get(record.ccn));
    if (overlay.type === 'reviewed-current-pointer-file-identity')
      return applyReviewedCurrentPointerFileIdentity(record, overlay, auditDir, root, roster.get(record.ccn));
    if (overlay.type === 'reviewed-trinity-operator-alias-pointer-file')
      return applyReviewedTrinityOperatorAliasPointerFile(record, overlay, auditDir, root, roster.get(record.ccn));
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
      && item.url === overlay.page_linked_mrf_url
      && item.raw_artifact
      && item.http_status === 206
      && Number(item.bytes_retained) >= 65536
      && /^[a-f0-9]{64}$/.test(String(item.sha256 || '')));
    if (!byteProof || proof.file_url !== overlay.page_linked_mrf_url
      || manual.facility_file_url !== overlay.page_linked_mrf_url
      || manual.proof_file !== overlay.source_proof_file
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
    if (overlay.tracker_link_url !== proof.official_pricing_page
      || new URL(overlay.tracker_link_url).hostname.replace(/^www\./, '') !== record.official_domain)
      throw new Error(`Nationwide overlay ${record.ccn} has no stable first-party tracker link`);

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

    let retainedRetry;
    if (!exactBase) {
      const alreadyApplied = record.disposition === 'verified-current-mrf'
        && record.mrf_url === overlay.page_linked_mrf_url
        && record.observed_at === byteProof.checked_at
        && record.declared_last_updated === candidate.declaredLastUpdated
        && record.cms_template_version === candidate.cmsVersion
        && record.declared_license_state === candidate.mrfLicenseState
        && record.declared_hospital_name === candidate.mrfHospitalName;
      if (alreadyApplied) return record;
      const retryAt = Date.parse(record.observed_at);
      const verifiedAt = Date.parse(byteProof.checked_at);
      if (!INCOMPLETE_RETRY_DISPOSITIONS.has(record.disposition)
        || !Number.isFinite(retryAt) || !Number.isFinite(verifiedAt) || retryAt <= verifiedAt)
        throw new Error(`Nationwide overlay ${record.ccn} base observation changed; review before applying cached evidence`);
      retainedRetry = {
        disposition: record.disposition,
        observed_at: record.observed_at,
        mrf_http_status: String(record.mrf_http_status || ''),
        pointer_state: record.pointer_state || '',
        pointer_result: record.pointer_result || '',
        mrf_url_sha256: sha256(String(record.mrf_url || '')),
        next_action: record.next_action || ''
      };
    }

    return {
      ...record,
      disposition: 'verified-current-mrf',
      // Keep the ephemeral signed download URL in retained evidence only. The
      // tracker points to the first-party pricing page that publishes it.
      mrf_url: overlay.tracker_link_url,
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
      ...(retainedRetry ? {
        latest_retry_observation: retainedRetry,
        observation_role: 'incomplete-retry-standing-retained',
        standing_evidence_retained: true,
        standing_evidence_reason: 'A later incomplete operational retry is retained alongside the separately verified page-linked file; it does not negate that file evidence or renew the root-pointer finding.'
      } : {}),
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
