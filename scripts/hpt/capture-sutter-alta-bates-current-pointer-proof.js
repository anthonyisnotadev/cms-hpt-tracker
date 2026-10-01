'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const pageUrl = 'https://www.sutterhealth.org/billing-insurance/costs-and-charges/cost-transparency/';
const pointerUrl = 'https://www.sutterhealth.org/cms-hpt.txt';
const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
const pointerDir = path.join(root, 'cms_data/hpt/nationwide-verification/pointer-provenance-rechecks');
const files = [
  {
    ccn: '050043',
    role: 'primary-summit-campus',
    url: 'https://edge.sitecorecloud.io/sutterhealt962c-sutterhealt8fce-production57cc-4860/media/Project/SutterHealth/SutterHealth/Files/billing-insurance/costs-and-charges/940562680-1295181477_alta-bates-summit-medical-center-summit-campus_standardcharges.csv',
    pointerLocation: 'ALTA BATES SUMMIT MEDICAL CENTER SUMMIT CAMPUS',
    pageLabel: 'Alta Bates Summit Medical Center - Summit Campus',
    hospitalName: 'Alta Bates Summit Medical Center',
    locationName: 'Alta Bates Summit Medical Center',
    address: '350 Hawthorne Avenue, Oakland, CA 94609',
    rosterName: 'ALTA BATES SUMMIT MEDICAL CENTER',
    rosterAddress: '350 HAWTHORNE AVENUE',
    rosterCity: 'OAKLAND',
    license: '140000284'
  },
  {
    ccn: '050043',
    role: 'related-summit-campus-hawthorne',
    url: 'https://edge.sitecorecloud.io/sutterhealt962c-sutterhealt8fce-production57cc-4860/media/Project/SutterHealth/SutterHealth/Files/billing-insurance/costs-and-charges/940562680-1194171371_alta-bates-summit-medical-center-hawthorne-campus_standardcharges.csv',
    pointerLocation: 'ALTA BATES SUMMIT MEDICAL CENTER SUMMIT CAMPUS - HAWTHORNE',
    pageLabel: 'Alta Bates Summit Medical Center - Summit Campus - Hawthorne',
    hospitalName: 'Alta Bates Summit Medical Center-Summit Campus-Hawthorne',
    locationName: 'Alta Bates Summit Medical Center-Summit Campus-Hawthorne',
    address: '350 Hawthorne Avenue, Oakland, CA 94609',
    rosterName: 'ALTA BATES SUMMIT MEDICAL CENTER',
    rosterAddress: '350 HAWTHORNE AVENUE',
    rosterCity: 'OAKLAND',
    license: '140000284'
  },
  {
    ccn: '050305',
    role: 'alta-bates-campus',
    url: 'https://edge.sitecorecloud.io/sutterhealt962c-sutterhealt8fce-production57cc-4860/media/Project/SutterHealth/SutterHealth/Files/billing-insurance/costs-and-charges/940562680-1639523004_alta-bates-summit-medical-center-alta-bates-campus_standardcharges.csv',
    pointerLocation: 'ALTA BATES SUMMIT MEDICAL CENTER ALTA BATES CAMPUS',
    pageLabel: 'Alta Bates Summit Medical Center - Alta Bates Campus',
    hospitalName: 'Alta Bates Summit Medical Center - Alta Bates Camp',
    locationName: 'Alta Bates Summit Medical Center - Alta Bates Camp',
    address: '2450 Ashby Avenue, Berkeley, CA 94705',
    rosterName: 'ALTA BATES SUMMIT MEDICAL CENTER - ALTA BATES CAMP',
    rosterAddress: '2450 ASHBY AVENUE',
    rosterCity: 'BERKELEY',
    license: '140000284'
  }
];

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const safeArtifact = (dir, digest, bytes) => {
  const file = path.join(dir, `${digest}.bin`);
  fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(file) && sha256(fs.readFileSync(file)) !== digest) {
    throw new Error(`Existing retained artifact failed its content hash: ${file}`);
  }
  if (!fs.existsSync(file)) fs.writeFileSync(file, bytes);
  return path.relative(root, file).replaceAll(path.sep, '/');
};

async function main() {
  const [page, pointer] = await Promise.all([
    retrieve(pageUrl, 2 * 1024 * 1024, { timeoutMs: 45000 }),
    retrieve(pointerUrl, 262144, { timeoutMs: 45000 })
  ]);
  const mrfResults = await Promise.all(files.map(item =>
    retrieve(item.url, 65536, { timeoutMs: 45000 })));

  if (page.status !== 200 && page.status !== 206) throw new Error(`Sutter page status changed: ${page.status}`);
  const pageTotalBytes = Number((page.headers['content-range'] || '').split('/')[1]) || page.body.length;
  if (pageTotalBytes !== page.body.length) throw new Error('Sutter official pricing page response was not complete');
  const pageText = page.body.toString('utf8');
  for (const item of files) {
    if (!pageText.includes(item.url) || !pageText.includes(item.pageLabel)) {
      throw new Error(`Current Sutter pricing page no longer links the expected ${item.ccn} file/location`);
    }
  }
  if (pointer.status !== 206 && pointer.status !== 200) throw new Error(`Sutter pointer status changed: ${pointer.status}`);
  const pointerBytes = Number((pointer.headers['content-range'] || '').split('/')[1]) || pointer.body.length;
  if (pointerBytes !== pointer.body.length) throw new Error('Sutter pointer response was not complete');
  const pointerText = pointer.body.toString('utf16le');
  const pointerSha = sha256(pointer.body);
  const previousPointerSha = '76cf5ee42d726154cfadf3b5d2fdd6605eea5599b8751fc24707dba424a6b2ca';
  if (pointerSha !== previousPointerSha) throw new Error(`Sutter pointer changed; review entries before applying: ${pointerSha}`);

  const reviewedFiles = [];
  for (let index = 0; index < files.length; index += 1) {
    const item = files[index];
    const response = mrfResults[index];
    if (response.status !== 206 || response.body.length !== 65536) {
      throw new Error(`Expected bounded HTTP 206/65,536-byte sample for ${item.ccn} ${item.role}; received ${response.status}/${response.body.length}`);
    }
    if (!pointerText.includes(item.pointerLocation) || !pointerText.includes(item.url)) {
      throw new Error(`Exact pointer entry does not declare ${item.role} for CCN ${item.ccn}`);
    }
    const parsed = await parsePayload(response.body, response.headers['content-type'] || '');
    const header = parsed.parsed.find(row => row.mrfHospitalName && row.mrfLocationName && row.mrfAddress);
    if (!header || header.cmsVersion !== '3.0.0' || header.declaredLastUpdated !== '2026-04-01'
        || header.mrfLicenseState !== 'CA' || header.mrfHospitalName !== item.hospitalName
        || header.mrfLocationName !== item.locationName || !header.mrfAddress.includes(item.address)) {
      throw new Error(`CMS v3 identity/header gate failed for ${item.ccn} ${item.role}: ${JSON.stringify(header)}`);
    }
    const digest = sha256(response.body);
    const rawArtifact = safeArtifact(sampleDir, digest, response.body);
    reviewedFiles.push({
      ...item,
      httpStatus: response.status,
      contentType: response.headers['content-type'] || '',
      contentRange: response.headers['content-range'] || '',
      sampleBytes: response.body.length,
      totalBytes: Number((response.headers['content-range'] || '').split('/')[1]) || 0,
      sampleSha256: digest,
      rawArtifact,
      declaredHospitalName: header.mrfHospitalName,
      declaredLocationName: header.mrfLocationName,
      declaredAddress: header.mrfAddress,
      declaredLicenseState: header.mrfLicenseState,
      declaredLicenseNumber: item.license,
      declaredNpis: header.mrfType2Npi || '',
      declaredLastUpdated: header.declaredLastUpdated,
      cmsTemplateVersion: header.cmsVersion,
      attestation: !!header.attestation,
      parsedUsableRowsObserved: parsed.parsed.length > 1
    });
  }

  const observedAt = new Date().toISOString();
  const pointerArtifact = safeArtifact(pointerDir, pointerSha, pointer.body);
  const pageSha = sha256(page.body);
  const pageArtifact = safeArtifact(path.join(root, 'cms_data/hpt/nationwide-verification/page-byte-proof'), pageSha, page.body);
  const ccnProofs = new Map();
  for (const ccn of ['050043', '050305']) {
    const primary = reviewedFiles.find(item => item.ccn === ccn && item.role !== 'related-summit-campus-hawthorne');
    const related = reviewedFiles.filter(item => item.ccn === ccn && item !== primary);
    const proofFile = `reconciliation-sutter-${ccn}-current-pointer-file-proof-2026-09-29.json`;
    const proof = {
      audit_id: `sutter-${ccn}-current-pointer-file-proof-2026-09-29`,
      ccn,
      observed_at: observedAt,
      official_domain: 'https://www.sutterhealth.org/',
      official_pricing_page: pageUrl,
      official_pricing_page_status: page.status,
      official_pricing_page_bytes: page.body.length,
      official_pricing_page_sha256: pageSha,
      official_pricing_page_raw_artifact: pageArtifact,
      current_cms_roster_identity: {
        facility_id: ccn,
        facility_name: primary.rosterName,
        address: primary.rosterAddress,
        city: primary.rosterCity,
        state: 'CA',
        source: 'cms_data/Hospital_General_Information.csv'
      },
      pointer: {
        url: pointerUrl,
        http_status: pointer.status,
        content_type: pointer.headers['content-type'] || '',
        bytes: pointer.body.length,
        sha256: pointerSha,
        raw_artifact: pointerArtifact,
        raw_encoding: 'UTF-16LE',
        historical_sha256_match: previousPointerSha,
        exact_entries: reviewedFiles.filter(item => item.ccn === ccn).map(item => ({
          location_name: item.pointerLocation,
          mrf_url: item.url
        }))
      },
      primary_mrf: {
        role: primary.role,
        page_location_label: primary.pageLabel,
        url: primary.url,
        http_status: primary.httpStatus,
        content_type: primary.contentType,
        content_range: primary.contentRange,
        total_bytes: primary.totalBytes,
        sample_bytes: primary.sampleBytes,
        sample_sha256: primary.sampleSha256,
        raw_artifact: primary.rawArtifact,
        declared_hospital_name: primary.declaredHospitalName,
        declared_location_name: primary.declaredLocationName,
        declared_address: primary.declaredAddress,
        declared_license_number: primary.declaredLicenseNumber,
        declared_license_state: primary.declaredLicenseState,
        declared_type2_npis: primary.declaredNpis,
        declared_last_updated: primary.declaredLastUpdated,
        cms_template_version: primary.cmsTemplateVersion,
        attestation: primary.attestation,
        usable_rows_observed: primary.parsedUsableRowsObserved
      },
      related_mrf_entries: related.map(item => ({
        role: item.role,
        page_location_label: item.pageLabel,
        url: item.url,
        http_status: item.httpStatus,
        content_range: item.contentRange,
        total_bytes: item.totalBytes,
        sample_bytes: item.sampleBytes,
        sample_sha256: item.sampleSha256,
        raw_artifact: item.rawArtifact,
        declared_location_name: item.declaredLocationName,
        declared_address: item.declaredAddress,
        declared_license_state: item.declaredLicenseState,
        declared_last_updated: item.declaredLastUpdated,
        cms_template_version: item.cmsTemplateVersion,
        attestation: item.attestation
      })),
      interpretation: 'Current first-party pricing page and hash-retained root pointer both declare the exact facility file. A bounded sample identifies the distinct CMS roster CCN by facility name/address/state and CMS 3.0.0 metadata effective for the 2026 requirements. This supports observed current pointer-linked MRF evidence; it is not full-file or line-item validation.',
      disposition: 'verified-current-mrf',
      next_action: 'Retain the exact pointer/page/file chain and recheck on the next publisher pointer or file change; keep separately named Sutter campuses and CCNs distinct.'
    };
    fs.writeFileSync(path.join(audit, proofFile), `${JSON.stringify(proof, null, 2)}\n`);
    ccnProofs.set(ccn, { proof, proofFile, primary });
  }

  const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
  const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
  for (const [ccn, { proof, proofFile, primary }] of ccnProofs) {
    manual.records = manual.records.filter(row => !(row.ccn === ccn && row.proof_file === proofFile));
    manual.records.push({
      ccn,
      observed_at: observedAt,
      proof_file: proofFile,
      official_domain: proof.official_domain,
      official_pricing_page: pageUrl,
      official_pricing_page_status: page.status,
      official_pricing_page_sha256: pageSha,
      official_facility_name: primary.rosterName,
      official_facility_address: `${primary.rosterAddress}, ${primary.rosterCity}, CA`,
      pointer_url: pointerUrl,
      pointer_status: pointer.status,
      pointer_sha256: pointerSha,
      pointer_location_name: primary.pointerLocation,
      pointer_declared_mrf_url: primary.url,
      facility_file_url: primary.url,
      file_status: primary.httpStatus,
      file_bytes: primary.sampleBytes,
      file_sha256: primary.sampleSha256,
      declared_hospital_name: primary.declaredHospitalName,
      declared_location_name: primary.declaredLocationName,
      declared_address: primary.declaredAddress,
      declared_license_number: primary.declaredLicenseNumber,
      declared_license_state: primary.declaredLicenseState,
      declared_npi: primary.declaredNpis,
      declared_last_updated: primary.declaredLastUpdated,
      cms_template_version: primary.cmsTemplateVersion,
      attestation: primary.attestation,
      file_kind: 'csv',
      manual_identity: 'corroborated',
      manual_identity_gate: 'official-file-header-name-address-state-version-attestation-agree',
      manual_disposition: 'verified-current-mrf',
      disposition: 'verified-current-mrf',
      latest_pointer_recheck: {
        observed_at: observedAt,
        pointer_url: pointerUrl,
        pointer_http_status: pointer.status,
        pointer_content_range: pointer.headers['content-range'] || '',
        pointer_bytes: pointer.body.length,
        pointer_sha256: pointerSha,
        pointer_location_name: primary.pointerLocation,
        pointer_declared_mrf_url: primary.url,
        exact_pointer_mrf_status: primary.httpStatus,
        declared_hospital_name: primary.declaredHospitalName,
        declared_location_name: primary.declaredLocationName,
        declared_address: primary.declaredAddress,
        declared_license_state: primary.declaredLicenseState,
        declared_last_updated: primary.declaredLastUpdated,
        cms_template_version: primary.cmsTemplateVersion,
        declared_npi: primary.declaredNpis,
        declared_attestation: primary.attestation,
        manual_identity: 'corroborated',
        manual_identity_gate: 'exact-pointer-ccn-file-name-address-state-v3-attestation-agree',
        manual_disposition: 'verified-current-mrf'
      },
      next_action: proof.next_action
    });
  }
  manual.records.sort((a, b) => a.ccn.localeCompare(b.ccn)
    || String(a.observed_at || '').localeCompare(String(b.observed_at || '')));
  fs.writeFileSync(manualPath, `${JSON.stringify(manual, null, 2)}\n`);
  console.log(JSON.stringify({
    observed_at: observedAt,
    pointer_sha256: pointerSha,
    page_sha256: pageSha,
    proofs: [...ccnProofs].map(([ccn, value]) => ({ ccn, proof_file: value.proofFile,
      primary_mrf_sha256: value.primary.sampleSha256, related_entries: value.proof.related_mrf_entries.length }))
  }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
