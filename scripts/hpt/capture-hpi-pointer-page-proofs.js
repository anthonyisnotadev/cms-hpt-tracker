'use strict';
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const browserObservedAt = '2026-09-16T13:46:37.000Z';
const facilities = [
  {
    ccn: '241320', officialDomain: 'riverviewhealth.org', name: 'RiverView Health', pointerName: 'Riverview Health',
    city: 'Crookston', state: 'MN', zip: '56716', street: '323 S Minnesota St',
    pointerUrl: 'https://riverviewhealth.org/cms-hpt.txt',
    sourceUrl: 'https://search.hospitalpriceindex.com/hpi2/machineReadable/RiverviewHealth/7983',
    identityUrl: 'https://www.riverviewhealth.org/locations/', identityStreet: '323 S Minnesota Street',
    oldUrl: 'https://sthpiprd.blob.core.windows.net/machine-readable-files/7983/410724029_riverview-health-association_standardcharges.csv',
    currentUrl: 'https://sthpiprd.blob.core.windows.net/machine-readable-files/7983/410724029-1477525566_riverview-health-association_standardcharges.csv',
    headerName: 'RiverView Health Association', headerLocation: 'RiverView Health', date: '2026-05-15',
  },
  {
    ccn: '260025', officialDomain: 'hannibalregional.org', name: 'Hannibal Regional Hospital',
    city: 'Hannibal', state: 'MO', zip: '63401', street: '6000 Hospital Drive',
    pointerUrl: 'https://hannibalregional.org/cms-hpt.txt',
    sourceUrl: 'https://search.hospitalpriceindex.com/hpi2/machineReadable/HannibalRegionalHospital/8042',
    identityUrl: 'https://www.hannibalregional.org/locations/hannibal-regional-hospital/', identityStreet: '6000 Hospital Drive',
    oldUrl: 'https://sthpiprd.blob.core.windows.net/machine-readable-files/8042/430662495_hannibal-regional-hospital_standardcharges.csv',
    currentUrl: 'https://sthpiprd.blob.core.windows.net/machine-readable-files/8042/430332495_hannibal-regional-hospital_standardcharges.csv',
    headerName: 'Hannibal Regional Hospital', headerLocation: 'Hannibal Regional Hospital', date: '2026-08-14',
  },
  {
    ccn: '281357', officialDomain: 'sidneyrmc.com', name: 'Sidney Regional Medical Center',
    city: 'Sidney', state: 'NE', zip: '69162', street: '1000 Pole Creek Crossing',
    pointerUrl: 'https://www.sidneyrmc.com/cms-hpt.txt',
    sourceUrl: 'https://search.hospitalpriceindex.com/hpi2/machineReadable/SidneyRegionalMedicalCenter/8186or',
    identityUrl: 'https://www.sidneyrmc.com/visitor-guide/', identityStreet: '1000 Pole Creek Crossing',
    oldUrl: 'https://sthpiprd.blob.core.windows.net/machine-readable-files/8186/470408242_sidney-regional-medical-center_standardcharges.csv',
    currentUrl: 'https://sthpiprd.blob.core.windows.net/machine-readable-files/8186/470408242_cheyenne-county-hospital-association-inc_standardcharges.csv',
    headerName: 'Cheyenne County Hospital Association Inc', headerLocation: 'Sidney Regional Medical Center', date: '2026-01-09',
  },
];

async function capture(f) {
  const [pointer, source, identity, oldFile, currentFile] = await Promise.all([
    retrieve(f.pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(f.sourceUrl, 65536, { timeoutMs: 30000 }),
    retrieve(f.identityUrl, 262144, { timeoutMs: 30000 }),
    retrieve(f.oldUrl, 65536, { timeoutMs: 30000, curlOnStatuses: [403, 404] }),
    retrieve(f.currentUrl, 262144, { timeoutMs: 30000 }),
  ]);
  const pointerText = pointer.body.toString('utf8');
  const identityText = cheerio.load(identity.body.toString('utf8')).text().replace(/\s+/g, ' ');
  const header = (await parsePayload(currentFile.body,
    currentFile.headers['content-type'] || 'text/csv')).parsed.find(item => item.innerKind === 'csv' && item.mrfHospitalName);
  if (![200, 206].includes(pointer.status) || ![200, 206].includes(source.status)
      || identity.status !== 200 || oldFile.status !== 404 || currentFile.status !== 206
      || currentFile.body.length !== 262144
      || !pointerText.includes(`location-name: ${f.pointerName || f.name}`)
      || !pointerText.includes(`source-page-url: ${f.sourceUrl}`)
      || !pointerText.includes(`mrf-url: ${f.oldUrl}`)
      || !identityText.includes(f.identityStreet) || !identityText.includes(f.city)
      || !identityText.includes(f.zip)
      || header?.mrfHospitalName !== f.headerName
      || !header.mrfLocationName.includes(f.headerLocation)
      || !header.mrfAddress.includes(f.street) || !header.mrfAddress.includes(f.zip)
      || header.mrfLicenseState !== f.state || header.declaredLastUpdated !== f.date
      || header.cmsVersion !== '3.0.0') throw new Error(`HPI proof changed for ${f.ccn}`);
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${currentFile.sha256}.bin`);
  fs.writeFileSync(samplePath, currentFile.body);
  return {
    ccn: f.ccn, official_domain: f.officialDomain, identity_url: f.identityUrl,
    identity_sha256: identity.sha256, pointer_url: f.pointerUrl,
    pointer_http_status: pointer.status, pointer_sha256: pointer.sha256,
    pointer_mrf_url: f.oldUrl, pointer_mrf_http_status: oldFile.status,
    source_page_url: f.sourceUrl, source_page_shell_http_status: source.status,
    source_page_shell_sha256: source.sha256,
    rendered_source_heading: f.ccn === '260025' ? 'Hannibal Regional Healthcare System' : f.name,
    rendered_source_update: f.date, rendered_source_download_url: f.currentUrl,
    rendered_source_observed_at: browserObservedAt,
    current_mrf_url: f.currentUrl, current_mrf_http_status: currentFile.status,
    current_mrf_sha256: currentFile.sha256, retained_bytes: currentFile.body.length,
    retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    declared_hospital_name: header.mrfHospitalName,
    declared_location_name: header.mrfLocationName,
    declared_address: header.mrfAddress, declared_state: header.mrfLicenseState,
    declared_date: header.declaredLastUpdated, version: header.cmsVersion,
    observed_at: currentFile.checkedAt,
    next_action: `Recheck the exact ${f.name} root-pointer target after a publisher update; preserve the separate rendered source-page CSV and audit its complete structure independently.`,
  };
}

async function main() {
  const records = await Promise.all(facilities.map(capture));
  fs.writeFileSync(path.join(root, 'data/hpt-audit/reconciliation-hpi-pointer-page-proofs.json'),
    JSON.stringify({ disposition: 'pointer-target-404-rendered-source-page-current-file', records }, null, 2) + '\n');
  console.log(JSON.stringify(records.map(row => ({ ccn: row.ccn, stale_status: row.pointer_mrf_http_status,
    current_status: row.current_mrf_http_status, sample_sha256: row.current_mrf_sha256 }))));
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
