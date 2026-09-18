'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { retrieve, parsePayload } = require('./lib/recovery-transport');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const pointerUrl = 'https://www.adventisthealth.org/cms-hpt.txt';
const sourcePageUrl = 'https://www.adventisthealth.org/patients-and-visitors/price-transparency/';
const urls = {
  '050236': 'https://apps.para-hcfs.com/PTT/FinalLinks/Reports.aspx?dbName=dbAHSVSIMIVALLEYCA&type=CDMWithoutLabel&fileType=CSV',
  '050455': 'https://apps.para-hcfs.com/PTT/FinalLinks/Reports.aspx?dbName=dbAHBBAKERSFIELDCA&type=CDMWithoutLabel&fileType=CSV',
};
const expected = {
  '050236': { roster: '2975 N SYCAMORE DR', name: 'SIMI VALLEY HOSPITAL AND HEALTH CARE SERVICES', address: '2975 Sycamore Dr Simi Valley CA 93065', date: '2026-05-21' },
  '050455': { roster: '2615 CHESTER AVENUE', name: 'SAN JOAQUIN COMMUNITY HOSPITAL', address: '3001 Sillect Avenue Bakersfield CA 93308|3001 Sillect Avenue Bakersfield CA 93308', date: '2026-07-29' },
};

async function main() {
  const roster = new Map(csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8')).map(row => [row['Facility ID'], row]));
  const base = new Map(csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).map(row => [row.ccn, row]));
  const pointer = await retrieve(pointerUrl, 65536, { timeoutMs: 30000 });
  const pointerText = pointer.body.toString('utf8');
  if (![200, 206].includes(pointer.status) || !pointerText.includes('location-name: SIMI VALLEY HOSPITAL AND HEALTH CARE SERVICES')
      || !pointerText.includes('location-name: SAN JOAQUIN COMMUNITY HOSPITAL')
      || !Object.values(urls).every(url => pointerText.includes(`mrf-url: ${url}`)))
    throw new Error('Adventist pointer entries changed');
  const records = {};
  for (const ccn of Object.keys(urls)) {
    const r = roster.get(ccn), b = base.get(ccn), x = expected[ccn];
    if (!r || r.Address !== x.roster || r.State !== 'CA' || !b
        || b.finding !== 'not-assessed-not-named-in-file'
        || b.pointer_url !== 'https://adventisthealth.org/cms-hpt.txt')
      throw new Error(`Source identity changed for ${ccn}`);
    const file = await retrieve(urls[ccn], 262144, { timeoutMs: 30000 });
    const parsed = (await parsePayload(file.body, file.headers['content-type'] || 'text/csv')).parsed.find(item => item.innerKind === 'csv');
    if (![200, 206].includes(file.status) || file.body.length !== 262144 || !parsed
        || parsed.mrfHospitalName !== x.name || parsed.mrfAddress !== x.address
        || parsed.mrfLicenseState !== 'CA' || parsed.declaredLastUpdated !== x.date
        || parsed.cmsVersion !== '3.0.0') throw new Error(`File metadata changed for ${ccn}`);
    const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
    fs.mkdirSync(sampleDir, { recursive: true });
    const sample = path.join(sampleDir, `${file.sha256}.bin`);
    fs.writeFileSync(sample, file.body);
    if (crypto.createHash('sha256').update(fs.readFileSync(sample)).digest('hex') !== file.sha256)
      throw new Error(`Retained sample differs for ${ccn}`);
    records[ccn] = { ccn, roster: r, base: b, file, parsed, sample: path.relative(root, sample).replaceAll('\\', '/') };
  }
  const simi = records['050236'], bakersfield = records['050455'];
  const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
  const observationPath = path.join(audit, 'reconciliation-manual-access-observations.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  const observations = JSON.parse(fs.readFileSync(observationPath, 'utf8'));
  const priorSimi = ledger.find(row => row.ccn === '050236');
  const priorBakersfield = observations.records.find(row => row.ccn === '050455');
  if (priorSimi || priorBakersfield) {
    if (!priorSimi || !priorBakersfield
        || priorSimi.evidence.pointerSha256 !== pointer.sha256
        || priorSimi.evidence.fileSha256 !== simi.file.sha256
        || priorBakersfield.pointer_sha256 !== pointer.sha256
        || priorBakersfield.mrf_sample_sha256 !== bakersfield.file.sha256)
      throw new Error('Adventist prior evidence changed or is incomplete; manual review required');
    console.log(JSON.stringify({ verified_existing: ['050236', '050455'], pointer_sha256: pointer.sha256 }));
    return;
  }
  const proof = {
    observed_at: new Date().toISOString(), pointer_url: pointerUrl, pointer_http_status: pointer.status,
    pointer_sha256: pointer.sha256, source_page_url: sourcePageUrl,
    first_party_legal_alias_source: 'https://www.adventisthealth.org/documents/system/2023-annual-audit-report.pdf',
    first_party_simi_address_source: 'https://www.adventisthealth.org/documents/system/financial-assistance-policy-and-application.pdf',
    first_party_bakersfield_campus_source: 'https://www.adventisthealth.org/documents/Community-Benefit/AHBD2023_AnnualReport_Final_Mar_Com.pdf',
    records: Object.fromEntries(Object.entries(records).map(([ccn, record]) => [ccn, {
      roster_name: record.roster['Facility Name'], roster_address: record.roster.Address,
      roster_city: record.roster['City/Town'], roster_state: record.roster.State, roster_zip: record.roster['ZIP Code'],
      pointer_location_name: expected[ccn].name, file_url: urls[ccn], file_http_status: record.file.status,
      retained_sample: record.sample, retained_bytes: record.file.body.length, sample_sha256: record.file.sha256,
      declared_hospital_name: record.parsed.mrfHospitalName, declared_location_name: record.parsed.mrfLocationName,
      declared_address: record.parsed.mrfAddress, declared_license_state: record.parsed.mrfLicenseState,
      declared_date: record.parsed.declaredLastUpdated, version: record.parsed.cmsVersion,
      file_observed_at: record.file.checkedAt,
    }])),
    limitation: 'MRF evidence is a bounded header sample, not a complete-file usability or legal-compliance validation.',
  };
  fs.writeFileSync(path.join(audit, 'reconciliation-adventist-campus-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  const resolution = {
    ccn: '050236', base: simi.base, action: 'replace', reviewed_at: simi.file.checkedAt,
    evidence_run: 'adventist-simi-campus-2026-09-16',
    evidence: {
      identity: 'corroborated', identity_basis: 'first-party-legal-alias-and-roster-street-city-zip-agree-with-pointer-linked-file-header',
      pointerUrl, pointerSha256: pointer.sha256, pointerHttpStatus: pointer.status,
      url: urls['050236'], fileSha256: simi.file.sha256, http_status: simi.file.status,
      checked_at: simi.file.checkedAt, date: simi.parsed.declaredLastUpdated, version: simi.parsed.cmsVersion,
      officialDomain: 'adventisthealth.org', location_name: simi.parsed.mrfLocationName,
      declared_hospital_name: simi.parsed.mrfHospitalName, declared_address: simi.parsed.mrfAddress,
      declared_license_state: 'CA', facility_state: 'CA', file_kind: 'csv', sourcePageUrl,
    },
    note: 'First-party Adventist annual audit explicitly identifies Simi Valley Hospital and Health Care Services as dba Adventist Health Simi Valley. The pointer-linked CSV header gives 2975 Sycamore Dr, Simi Valley CA 93065, agreeing with the roster 2975 N Sycamore Dr except for omitted directional N; Adventist address material corroborates that directional form. This is a bounded header observation, not complete-file or legal compliance validation.',
  };
  ledger.push(resolution); ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  observations.records.push({
    ccn: '050455', observed_at: bakersfield.file.checkedAt, pointer_url: pointerUrl,
    pointer_sha256: pointer.sha256, pointer_http_status: pointer.status,
    pointer_location_name: expected['050455'].name, pointer_mrf_url: urls['050455'],
    mrf_http_status: bakersfield.file.status, mrf_sample_sha256: bakersfield.file.sha256,
    mrf_sample_bytes: bakersfield.file.body.length, mrf_declared_hospital_name: bakersfield.parsed.mrfHospitalName,
    mrf_declared_locations: bakersfield.parsed.mrfLocationName, mrf_declared_addresses: bakersfield.parsed.mrfAddress,
    mrf_declared_state: bakersfield.parsed.mrfLicenseState, mrf_declared_date: bakersfield.parsed.declaredLastUpdated,
    mrf_declared_version: bakersfield.parsed.cmsVersion, roster_address: '2615 CHESTER AVENUE, BAKERSFIELD CA 93301',
    first_party_campus_source: proof.first_party_bakersfield_campus_source,
    disposition: 'shared-pointer-entry-file-header-identifies-specialty-campus-not-main-roster-address',
    next_action: 'Locate the first-party, pointer-declared MRF for the main 2615 Chester Avenue Bakersfield facility or authoritative documentation establishing its coverage in another file. Do not assign the 3001 Sillect Avenue specialty-campus file to CCN 050455 without explicit facility-scope proof; validate complete file bytes and metadata before changing status.',
  });
  fs.writeFileSync(observationPath, JSON.stringify(observations, null, 2) + '\n');
  console.log(JSON.stringify({ promoted: '050236', kept_unresolved: '050455', pointer_sha256: pointer.sha256,
    sample_sha256: Object.fromEntries(Object.entries(records).map(([ccn, record]) => [ccn, record.file.sha256])) }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
