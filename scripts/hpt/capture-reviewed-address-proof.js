'use strict';
const fs = require('fs');
const path = require('path');
const { csvToObjects } = require('./lib/util');
const { retrieve, parsePayload, sha } = require('./lib/recovery-transport');
const root = path.resolve(__dirname, '../..');
const headers = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/hpt/nationwide-verification/mrf-headers.csv'), 'utf8'));
const roster = new Map(JSON.parse(fs.readFileSync(path.join(root, 'cms_data/hpt/roster.json'), 'utf8')).map(r => [r.ccn, r]));
const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
const output = path.join(root, 'data/hpt-audit/reconciliation-reviewed-address-proof.json');
const cases = [
  { ccn: '351319', marker: '456013474_Pembina-County', official_domain: 'cavalierhospital.com',
    official_url: 'https://www.cavalierhospital.com/contact-us/', address_basis: 'first-party-page-joins-roster-po-box-to-file-physical-address' },
  { ccn: '470001', marker: '222547186_central-vermont', official_domain: 'uvmhealth.org',
    official_url: 'https://www.uvmhealth.org/locations/central-vermont-medical-center/about-us', address_basis: 'first-party-current-campus-address-reconciles-roster-mailing-address' },
  { ccn: '234042', marker: '383473188_the-behavioral', official_domain: 'behavioralcenter.com',
    official_url: 'https://www.michigan.gov/mdhhs/keep-mi-healthy/mentalhealth/mentalhealth/recipientrights/Counties/macomb-county', address_basis: 'current-state-hospital-list-confirms-east-twelve-mile-address' },
  { ccn: '501331', marker: 'dbPMHPULLMANWA', official_domain: 'pullmanregional.org',
    official_url: 'https://www.pullmanregional.org/patient-care/visit-us', address_basis: 'first-party-current-campus-address-confirms-se-directional' }
  ,{ ccn: '400014', marker: '660204776_bella-vista', official_domain: 'bvhpr.org',
    official_url: 'https://bvhpr.org/', address_basis: 'first-party-page-confirms-carr-349-km-2-7-cerro-las-mesas-address' }
  ,{ ccn: '400044', marker: '66-0589727-Saint-Lukes', official_domain: 'sanlucaspr.org',
    official_url: 'https://sanlucaspr.org/centro-medico/centro-medico/', address_basis: 'first-party-current-ponce-campus-and-exact-tito-castro-address' }
  ,{ ccn: '420104', marker: 'roper-st-francis-mount-pleasant', official_domain: 'rsfh.com',
    official_url: 'https://www.rsfh.com/Locations/Roper-St-Francis-Mount-Pleasant-Hospital', address_basis: 'first-party-current-hospital-address-reconciles-roster-street-number' }
  ,{ ccn: '100204', marker: '61-1269294_HCA-FLORIDA-NORTH-FLORIDA-HOSPITAL', official_domain: 'hcafloridahealthcare.com',
    official_url: 'https://www.hcafloridahealthcare.com/locations/north-florida-hospital/about-us/quality-at-hca-healthcare', address_basis: 'exact-roster-name-and-current-first-party-main-campus-address-among-file-locations' }
  ,{ ccn: '340047', marker: '/11239/560552787_north-carolina-baptist-hospital', official_domain: 'atriumhealth.org',
    official_url: 'https://cdn.atriumhealth.org/-/media/wakeforest/clinical/files/patient-and-family-resources/campus-maps/24-0016989-updated-maps-for-ed-and-op-surgery-center-opening-final-employee.pdf', address_basis: 'exact-roster-legal-name-and-current-first-party-main-campus-address' }
];

async function main() {
  fs.mkdirSync(sampleDir, { recursive: true });
  const records = fs.existsSync(output) ? JSON.parse(fs.readFileSync(output, 'utf8')).records || [] : [];
  for (const item of cases) {
    if (records.some(record => record.ccn === item.ccn)) continue;
    const row = headers.find(r => r.mrf_url.includes(item.marker) && (r.review_ccns || '').split('|').includes(item.ccn));
    const hospital = roster.get(item.ccn);
    if (!row || !hospital || row.header_status !== 'review') throw new Error(`Expected reviewed candidate ${item.ccn}`);
    const rawCandidates = row.raw_files.split('|').map(file => ({ file, body: fs.readFileSync(path.join(root, file)) }));
    const selected = rawCandidates.find(candidate => {
      const text = candidate.body.toString('utf8');
      return text.includes(row.mrf_url) && row.pointer_location_names.split('|').some(name => text.includes(`location-name: ${name}`));
    });
    if (!selected || !row.pointer_sha256s.split('|').includes(sha(selected.body))) throw new Error(`Pointer proof mismatch ${item.ccn}`);
    const response = await retrieve(row.mrf_url, 262144, { timeoutMs: 30000, curlOnStatuses: [403, 429, 500, 502, 503, 504] });
    if (response.status < 200 || response.status >= 300 || !response.body.length) throw new Error(`MRF retrieval failed ${item.ccn}`);
    const parsed = await parsePayload(response.body, response.headers['content-type'] || '');
    const candidate = parsed.parsed.find(p => p.cmsVersion && p.mrfHospitalName && p.mrfAddress && p.mrfLicenseState);
    if (!candidate || candidate.mrfLicenseState !== hospital.state || candidate.cmsVersion !== '3.0.0') throw new Error(`Metadata gate failed ${item.ccn}`);
    const sample = path.join(sampleDir, `${response.sha256}.bin`); fs.writeFileSync(sample, response.body);
    records.push({ ...item, roster_name: hospital.name, roster_address: hospital.address, roster_city: hospital.city, roster_state: hospital.state, roster_zip: hospital.zip,
      pointer_url: row.pointer_urls.split('|')[0], pointer_sha256: sha(selected.body), pointer_location_name: row.pointer_location_names,
      pointer_raw_file: selected.file.replaceAll('\\', '/'), source_page_url: row.source_page_urls, mrf_url: row.mrf_url,
      mrf_final_url: response.finalUrl || row.mrf_url, mrf_http_status: response.status, mrf_sha256: response.sha256,
      retained_bytes: response.body.length, retained_sample: path.relative(root, sample).replaceAll('\\', '/'), file_kind: candidate.innerKind || candidate.fileKind,
      declared_hospital_name: candidate.mrfHospitalName, declared_location_name: candidate.mrfLocationName,
      declared_address: candidate.mrfAddress, declared_state: candidate.mrfLicenseState, declared_date: candidate.declaredLastUpdated,
      version: candidate.cmsVersion, observed_at: response.checkedAt, disposition: 'verified-after-reviewed-address-reconciliation' });
  }
  fs.writeFileSync(output, JSON.stringify({ generated_at: new Date().toISOString(), records }, null, 2) + '\n');
  console.log(JSON.stringify(records.map(r => ({ ccn: r.ccn, status: r.mrf_http_status, bytes: r.retained_bytes, sha256: r.mrf_sha256 })), null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
