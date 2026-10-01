'use strict';

// Capture a changed current REH MRF at the already verified publisher pointer.
// Keep the previous full-file proof immutable; this revision is only for CCN 370784.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { curlGet, decode, sha } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const rawDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
const proofName = 'reconciliation-clinton-reh-current-mrf-revision-proof-2026-09-29.json';
const pointerUrl = 'https://crhaok.com/cms-hpt.txt';
const siteUrl = 'https://www.crhaok.com/';
const pageUrl = 'https://secure.claraprice.net/price-transparency/clinton-regional-hospital-ok';
const fileUrl = 'https://secure.claraprice.net/price-transparency/OGFL-1782507604288/machine-readable/884062444_clinton-regional-hospital_standardcharges.json';
const cmsUrl = 'https://data.cms.gov/data-api/v1/dataset/3b5eae55-981c-4358-b3f8-7032d053d893/data?filter%5BCCN%5D=370784&size=10';
const expected = {
  previous_bytes: 3871397,
  previous_sha256: 'd00b4865ffb24203334c32a55f25742d25a67e06f93d686d8876d8d12209ff06',
  current_bytes: 5496900,
  current_sha256: 'd254c5499608cc6da36079958c1364845c817d480fa62a35b88f8c6a82e8b404',
  charge_entries: 5089
};

async function get(url, cap) {
  const response = await curlGet(url, cap, 60000, 6, {}, false);
  if (response.status !== 200 || !response.body.length
      || Number(response.headers['content-length'] || response.body.length) > cap)
    throw new Error(`Incomplete source ${url}: ${response.status}, ${response.body.length} bytes`);
  return response;
}

function getCmsResponse() {
  // The CMS JSON API does not support the bounded Range behavior used by the
  // publisher-file helper. Fetch its small, exact-CCN response without Range.
  const body = execFileSync('curl.exe', ['--fail', '--silent', '--show-error', '--location',
    '--max-time', '30', '--url', cmsUrl], { encoding: 'buffer', maxBuffer: 65536 });
  return { status: 200, body };
}

async function main() {
  const previous = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-clinton-reh-transition-proof.json'), 'utf8'));
  if (previous.file_bytes !== expected.previous_bytes || previous.file_sha256 !== expected.previous_sha256)
    throw new Error('The immutable previous Clinton REH file proof changed');

  // Keep this verification pass sequential so the bounded curl fallback does
  // not fan out concurrent requests to the same publisher/CDN.
  const pointer = await get(pointerUrl, 16384);
  const site = await get(siteUrl, 262144);
  const page = await get(pageUrl, 262144);
  const cms = getCmsResponse();
  const file = await get(fileUrl, 8 * 1024 * 1024);
  const pointerText = decode(pointer.body);
  const pointerEntry = pointerText.split(/\r?\n/).map(line => line.trim())
    .filter(line => /^(location-name|source-page-url|mrf-url):/.test(line));
  const cmsRows = JSON.parse(decode(cms.body));
  const enrollment = cmsRows[0];
  const mrf = JSON.parse(decode(file.body));
  const address = mrf.hospital_address?.[0] || '';
  const rawPath = `cms_data/hpt/nationwide-verification/file-byte-proof/${sha(file.body)}.bin`;
  const rawFile = path.join(root, rawPath);

  if (sha(file.body) !== expected.current_sha256 || file.body.length !== expected.current_bytes
      || cmsRows.length !== 1 || enrollment.CCN !== '370784' || enrollment.NPI !== '1942921929'
      || enrollment['REH CONVERSION FLAG'] !== 'Y' || enrollment['REH CONVERSION DATE'] !== '2025-12-02'
      || enrollment['CAH OR HOSPITAL CCN'] !== '370245'
      || enrollment['PROVIDER TYPE TEXT'] !== 'PART A PROVIDER - RURAL EMERGENCY HOSPITAL (REH)'
      || enrollment['ADDRESS LINE 1'] !== '100 NORTH 30TH STREET' || enrollment.CITY !== 'CLINTON'
      || enrollment.STATE !== 'OK' || !String(enrollment['ZIP CODE']).startsWith('73601')
      || !pointerEntry.includes('location-name: Clinton Regional Hospital')
      || !pointerEntry.includes(`source-page-url: ${pageUrl}`)
      || !pointerEntry.includes(`mrf-url: ${fileUrl}`)
      || !decode(site.body).toLowerCase().includes('100 n 30th st')
      || !decode(page.body).includes('Clinton Regional Hospital')
      || mrf.hospital_name !== 'Clinton Regional Hospital'
      || JSON.stringify(mrf.location_name) !== '["Clinton Regional Hospital"]'
      || address !== '100 North 30th Street, Clinton, OK 73601'
      || JSON.stringify(mrf.type_2_npi) !== '["1942921929"]'
      || mrf.license_information?.state !== 'OK' || mrf.last_updated_on !== '2026-07-28'
      || mrf.version !== '3.0.0' || mrf.standard_charge_information?.length !== expected.charge_entries
      || file.body.length === previous.file_bytes || sha(file.body) === previous.file_sha256)
    throw new Error('Current Clinton REH source, metadata, or material file-change gate failed');

  fs.mkdirSync(rawDir, { recursive: true });
  if (fs.existsSync(rawFile) && sha(fs.readFileSync(rawFile)) !== expected.current_sha256)
    throw new Error('Existing raw file-byte artifact does not match its content hash');
  if (!fs.existsSync(rawFile)) fs.writeFileSync(rawFile, file.body);

  const observedAt = new Date().toISOString();
  const proof = {
    ccn: '370784',
    observed_at: observedAt,
    current_scope: 'Current rural emergency hospital CCN 370784 only; not historical acute-care CCN 370245.',
    official_site_url: siteUrl,
    official_site_sha256: sha(site.body),
    cms_enrollment_url: cmsUrl,
    cms_enrollment_sha256: sha(cms.body),
    cms_current_enrollment: {
      ccn: enrollment.CCN, npi: enrollment.NPI, provider_type: enrollment['PROVIDER TYPE TEXT'],
      legal_name: enrollment['ORGANIZATION NAME'], doing_business_as: enrollment['DOING BUSINESS AS NAME'],
      address: enrollment['ADDRESS LINE 1'], city: enrollment.CITY, state: enrollment.STATE,
      zip: enrollment['ZIP CODE'], reh_conversion_flag: enrollment['REH CONVERSION FLAG'],
      reh_conversion_date: enrollment['REH CONVERSION DATE'], former_hospital_ccn: enrollment['CAH OR HOSPITAL CCN']
    },
    root_pointer_url: pointerUrl,
    root_pointer_sha256: sha(pointer.body),
    root_pointer_entry_without_contacts: pointerEntry,
    pricing_page_url: pageUrl,
    pricing_page_sha256: sha(page.body),
    mrf_url: fileUrl,
    mrf_status: file.status,
    mrf_content_type: file.headers['content-type'] || '',
    mrf_content_disposition: file.headers['content-disposition'] || '',
    previous_revision: {
      proof_file: 'reconciliation-clinton-reh-transition-proof.json',
      observed_at: previous.observed_at,
      bytes: previous.file_bytes,
      sha256: previous.file_sha256,
      declared_date: previous.file_last_updated_on,
      version: previous.file_version,
      charge_entries: previous.charge_entry_count
    },
    current_revision: {
      bytes: file.body.length,
      sha256: sha(file.body),
      raw_artifact: rawPath,
      declared_date: mrf.last_updated_on,
      version: mrf.version,
      hospital_name: mrf.hospital_name,
      location_name: mrf.location_name,
      address: mrf.hospital_address,
      license_state: mrf.license_information.state,
      type_2_npi: mrf.type_2_npi,
      charge_entries: mrf.standard_charge_information.length,
      attestation_field_present: Object.hasOwn(mrf, 'attestation'),
      attester_name_field_present: Object.hasOwn(mrf, 'attester_name')
    },
    comparison: {
      sha256_changed: sha(file.body) !== previous.file_sha256,
      bytes_delta: file.body.length - previous.file_bytes,
      charge_entry_delta: mrf.standard_charge_information.length - previous.charge_entry_count,
      declared_date_changed: mrf.last_updated_on !== previous.file_last_updated_on,
      interpretation: 'The publisher served different complete JSON bytes and 328 additional standard-charge entries at the same official pointer target while leaving last_updated_on at 2026-07-28. Record this as a file-content revision; do not infer when or why the publisher changed it.'
    },
    conclusion: 'Current pointer-linked complete MRF identity and metadata continue to match CMS REH CCN 370784. The separate current CMS enrollment confirms former acute-care CCN 370245 conversion on 2025-12-02. This updated current REH file does not establish historical MRF coverage for CCN 370245; no legal-compliance or line-item correctness conclusion is made.'
  };
  fs.writeFileSync(path.join(audit, proofName), JSON.stringify(proof, null, 2) + '\n');

  const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
  const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
  const currentObservation = manual.records.find(row => row.ccn === '370784');
  if (!currentObservation) throw new Error('Current REH manual observation is missing');
  currentObservation.latest_complete_file_revision = {
    observed_at: observedAt, proof_file: proofName, mrf_url: fileUrl,
    http_status: file.status, bytes: file.body.length, sha256: sha(file.body),
    previous_bytes: previous.file_bytes, previous_sha256: previous.file_sha256,
    declared_date: mrf.last_updated_on, version: mrf.version,
    charge_entries: mrf.standard_charge_information.length,
    charge_entry_delta: mrf.standard_charge_information.length - previous.charge_entry_count,
    current_cms_ccn: '370784', former_hospital_ccn: '370245',
    historical_ccn_effect: 'none; current REH file is not assigned to former acute-care CCN 370245'
  };
  currentObservation.observed_at = observedAt;
  currentObservation.next_action = 'Current pointer-linked REH file remains promoted for CCN 370784; its bytes and metadata were rechecked on 2026-09-29 with a changed full-file hash/count. Keep former acute-care CCN 370245 separate pending historical-file evidence.';
  fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');

  const resolutionsPath = path.join(audit, 'reviewed-resolutions.json');
  const resolutions = JSON.parse(fs.readFileSync(resolutionsPath, 'utf8'));
  const resolution = resolutions.find(row => row.ccn === '370784');
  if (!resolution || resolution.action !== 'replace'
      || resolution.evidence.fileSha256 !== previous.file_sha256)
    throw new Error('Active REH resolution does not reference the expected previous full-file proof');
  Object.assign(resolution.evidence, {
    fileSha256: sha(file.body), fullFileBytes: file.body.length, http_status: file.status,
    checked_at: observedAt, date: mrf.last_updated_on, version: mrf.version,
    declared_hospital_name: mrf.hospital_name, location_name: mrf.location_name[0],
    declared_address: address, declared_license_state: mrf.license_information.state,
    currentFileRevisionProof: proofName, currentFileRevisionObservedAt: observedAt,
    currentFileRevisionPreviousSha256: previous.file_sha256,
    currentFileRevisionPreviousBytes: previous.file_bytes,
    currentFileRevisionChargeEntries: mrf.standard_charge_information.length
  });
  resolution.evidence_run = 'clinton-reh-current-mrf-revision-2026-09-29';
  resolution.reviewed_at = observedAt;
  resolution.note = `The current CMS REH enrollment, exact official pointer, and complete pointer-linked JSON continue to agree on Clinton Regional Hospital, 100 North 30th Street, Oklahoma and NPI 1942921929. A full-file recheck found a publisher-served byte revision at the same URL: ${previous.file_bytes} bytes / ${previous.charge_entry_count} charge entries / SHA-256 ${previous.file_sha256} became ${file.body.length} bytes / ${mrf.standard_charge_information.length} entries / SHA-256 ${sha(file.body)} while the file still declares ${mrf.last_updated_on} and CMS template ${mrf.version}. The prior revision remains preserved in ${'reconciliation-clinton-reh-transition-proof.json'}. Current file evidence applies only to REH CCN 370784, not former acute-care CCN 370245. This is not line-item validation or a legal-compliance conclusion.`;
  fs.writeFileSync(resolutionsPath, JSON.stringify(resolutions, null, 2) + '\n');

  console.log(JSON.stringify({ ccn: proof.ccn, proof_file: proofName, previous_bytes: previous.file_bytes,
    previous_sha256: previous.file_sha256, current_bytes: file.body.length,
    current_sha256: sha(file.body), declared_date: mrf.last_updated_on,
    previous_charge_entries: previous.charge_entry_count,
    current_charge_entries: mrf.standard_charge_information.length, raw_artifact: rawPath }, null, 2));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
