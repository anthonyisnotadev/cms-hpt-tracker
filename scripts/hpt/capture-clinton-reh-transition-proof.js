'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { curlGet, decode, sha } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofName = 'reconciliation-clinton-reh-transition-proof.json';
const pointerUrl = 'https://crhaok.com/cms-hpt.txt';
const siteUrl = 'https://www.crhaok.com/';
const pageUrl = 'https://secure.claraprice.net/price-transparency/clinton-regional-hospital-ok';
const fileUrl = 'https://secure.claraprice.net/price-transparency/OGFL-1782507604288/machine-readable/884062444_clinton-regional-hospital_standardcharges.json';
const enrollmentUrl = ccn => `https://data.cms.gov/data-api/v1/dataset/3b5eae55-981c-4358-b3f8-7032d053d893/data?filter%5BCCN%5D=${ccn}&size=10`;

async function get(url, cap) {
  const response = await curlGet(url, cap, 30000, 6, {}, false);
  if (response.status !== 200 || !response.body.length || Number(response.headers['content-length'] || response.body.length) > cap)
    throw new Error(`Incomplete source ${url}: ${response.status}, ${response.body.length} bytes`);
  return response;
}

async function main() {
  const roster = JSON.parse(fs.readFileSync(path.join(root, 'cms_data/hpt/roster.json'), 'utf8'));
  const verification = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-verification.json'), 'utf8')).records;
  const ledgerPath = path.join(audit, 'reconciliation-manual-access-observations.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  for (const ccn of ['370245', '370784']) {
    const facility = roster.find(row => row.ccn === ccn);
    const current = verification.find(row => row.ccn === ccn);
    if (facility?.name !== 'CLINTON REGIONAL HOSPITAL' || facility.address !== '100 N 30TH STREET'
      || facility.city !== 'CLINTON' || facility.state !== 'OK' || facility.zip !== '73601'
      || current?.disposition !== 'pointer-facility-match-unresolved'
      || current.pointer_corpus_checked_url !== pointerUrl
      || ledger.records.some(row => row.ccn === ccn)) throw new Error(`Source or ledger changed for ${ccn}`);
  }
  if (fs.existsSync(path.join(audit, proofName))) throw new Error('Clinton proof already exists');

  const [oldEnrollment, currentEnrollment, pointer, site, page, file] = await Promise.all([
    get(enrollmentUrl('370245'), 16384), get(enrollmentUrl('370784'), 16384),
    get(pointerUrl, 16384), get(siteUrl, 262144), get(pageUrl, 262144), get(fileUrl, 5 * 1024 * 1024),
  ]);
  const formerRows = JSON.parse(decode(oldEnrollment.body));
  const currentRows = JSON.parse(decode(currentEnrollment.body));
  const enrollment = currentRows[0];
  const mrf = JSON.parse(decode(file.body));
  const pointerLines = decode(pointer.body).split(/\r?\n/).map(line => line.trim())
    .filter(line => /^(location-name|source-page-url|mrf-url):/.test(line));
  if (formerRows.length !== 0 || currentRows.length !== 1
    || enrollment.CCN !== '370784' || enrollment.NPI !== '1942921929'
    || enrollment['REH CONVERSION FLAG'] !== 'Y'
    || enrollment['REH CONVERSION DATE'] !== '2025-12-02'
    || enrollment['CAH OR HOSPITAL CCN'] !== '370245'
    || enrollment['PROVIDER TYPE TEXT'] !== 'PART A PROVIDER - RURAL EMERGENCY HOSPITAL (REH)'
    || enrollment['ADDRESS LINE 1'] !== '100 NORTH 30TH STREET'
    || enrollment.CITY !== 'CLINTON' || enrollment.STATE !== 'OK'
    || !String(enrollment['ZIP CODE']).startsWith('73601')
    || pointerLines.length !== 3
    || !pointerLines.includes('location-name: Clinton Regional Hospital')
    || !pointerLines.includes(`source-page-url: ${pageUrl}`)
    || !pointerLines.includes(`mrf-url: ${fileUrl}`)
    || !decode(site.body).includes('100 N 30th St')
    || !decode(page.body).includes('Clinton Regional Hospital')
    || mrf.hospital_name !== 'Clinton Regional Hospital'
    || JSON.stringify(mrf.location_name) !== '["Clinton Regional Hospital"]'
    || JSON.stringify(mrf.hospital_address) !== '["100 North 30th Street, Clinton, OK 73601"]'
    || JSON.stringify(mrf.type_2_npi) !== '["1942921929"]'
    || mrf.license_information?.state !== 'OK'
    || mrf.last_updated_on !== '2026-07-28' || mrf.version !== '3.0.0'
    || !Array.isArray(mrf.standard_charge_information) || mrf.standard_charge_information.length !== 4761)
    throw new Error('Clinton source or identity gate changed');

  const observedAt = new Date().toISOString();
  const proof = {
    ccns: ['370245', '370784'], observed_at: observedAt,
    cms_enrollment_dataset: 'CMS Hospital Enrollments',
    cms_current_enrollment_url: enrollmentUrl('370784'),
    cms_current_enrollment_response_sha256: sha(currentEnrollment.body),
    cms_former_enrollment_url: enrollmentUrl('370245'),
    cms_former_enrollment_response_sha256: sha(oldEnrollment.body),
    cms_former_enrollment_rows_in_current_snapshot: 0,
    cms_current_enrollment: {
      ccn: enrollment.CCN, provider_type: enrollment['PROVIDER TYPE TEXT'], npi: enrollment.NPI,
      organization_name: enrollment['ORGANIZATION NAME'], doing_business_as: enrollment['DOING BUSINESS AS NAME'],
      address: enrollment['ADDRESS LINE 1'], city: enrollment.CITY, state: enrollment.STATE,
      zip: enrollment['ZIP CODE'], reh_conversion_flag: enrollment['REH CONVERSION FLAG'],
      reh_conversion_date: enrollment['REH CONVERSION DATE'], former_hospital_ccn: enrollment['CAH OR HOSPITAL CCN'],
    },
    first_party_site_url: siteUrl, first_party_site_sha256: sha(site.body),
    pointer_url: pointerUrl, pointer_sha256: sha(pointer.body), pointer_entry_without_contacts: pointerLines,
    pricing_page_url: pageUrl, pricing_page_sha256: sha(page.body),
    pointer_file_url: fileUrl, file_http_status: file.status, file_bytes: file.body.length,
    file_sha256: sha(file.body), file_hospital_name: mrf.hospital_name,
    file_location_name: mrf.location_name, file_address: mrf.hospital_address,
    file_type_2_npi: mrf.type_2_npi, file_license_state: mrf.license_information.state,
    file_last_updated_on: mrf.last_updated_on, file_version: mrf.version,
    charge_entry_count: mrf.standard_charge_information.length,
    conclusion: 'The current CMS REH enrollment explicitly records conversion from former hospital CCN 370245 to current CCN 370784. The current pointer-linked complete JSON agrees with the REH enrollment on name, street, state and NPI. It is current-facility evidence for 370784, not a historical file for 370245. This review checks identity and root metadata, not all charge rows or CMS compliance.',
  };
  fs.writeFileSync(path.join(audit, proofName), JSON.stringify(proof, null, 2) + '\n');
  for (const [ccn, role, disposition, nextAction] of [
    ['370245', 'former-acute-care-hospital', 'cms-confirmed-reh-conversion-former-ccn',
      'Preserve the historical acute-care CCN separately. The current CMS enrollment maps it to REH CCN 370784 effective 2025-12-02; do not assign the current REH file to 370245. Find a historical acute-care file and effective period only if a historical claim is needed.'],
    ['370784', 'current-rural-emergency-hospital', 'current-reh-complete-file-identity-corroborated',
      'The current root-pointer JSON and CMS REH enrollment agree on name, address, state and NPI; review the full-file metadata proof for CCN-specific promotion. This is not line-item or legal compliance validation.'],
  ]) ledger.records.push({ ccn, observed_at: observedAt, proof_file: proofName, facility_role: role,
    cms_enrollment_url: enrollmentUrl('370784'), pointer_url: pointerUrl, pointer_file_url: fileUrl,
    pointer_file_sha256: sha(file.body), disposition, next_action: nextAction });
  ledger.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(JSON.stringify({ ccns: proof.ccns, current: '370784', former: '370245', file_sha256: proof.file_sha256 }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
