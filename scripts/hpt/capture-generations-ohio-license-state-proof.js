'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { csvToObjects } = require('./lib/util');
const { parsePointer } = require('./lib/parse');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const pointerUrl = 'https://generationsbehavioralhealth.com/cms-hpt.txt';
const locationsUrl = 'https://generationsbehavioralhealth.com/locations/';
const expectedPointerSha = 'f9bc6da47451f1ffa6a6942223b2e1404bf9f6a4b9a81b1d38dfb05f70645335';
const cases = [
  { ccn: '364054', key: 'geneva', rosterName: 'GENERATIONS BEHAVIORAL HEALTH - GENEVA',
    rosterAddress: '60 WEST STREET', rosterZip: '44041', pointerName: 'Generations Behavioral Health Geneva',
    hospitalName: 'Generations Behavioral Health - Geneva, LLC',
    locationName: 'Generations Behavioral Health - Geneva', address: '60 West Street Geneva OH 44041',
    fileBytes: 498748, fileSha: '2cae2e1d222d05e86130b42d4bbbb3fa145fa82caa14d0d01aaa041c26441819' },
  { ccn: '364060', key: 'youngstown', rosterName: 'GENERATIONS BEHAVIORAL HEALTH-YOUNGSTOWN LLC',
    rosterAddress: '196 COLONIAL DRIVE', rosterZip: '44504', pointerName: 'Generations Behavioral Health Youngstown',
    hospitalName: 'Generations Behavioral Health - Youngstown, LLC',
    locationName: 'Generations Behavioral Health - Youngstown', address: '196 Colonial Dr Youngstown OH 44505',
    fileBytes: 489770, fileSha: '6a36b66493c1ab83cc4296776be657d18f636e838c02c8d6b88bb6ab16a4c8e4' },
];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

async function main() {
  const roster = new Map(csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .map(row => [row['Facility ID'], row]));
  const corpus = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/hpt/pointer-corpus/cms_hpt_entries.csv'), 'utf8'));
  const current = corpus.filter(row => row.pointer_url === pointerUrl && row.pointer_sha256 === expectedPointerSha
    && row.record_status === 'ok');
  if (current.length !== 2) throw new Error('Generations current pointer entries changed');
  const retainedPointer = fs.readFileSync(path.join(root, current[0].raw_file));
  const entries = parsePointer(retainedPointer.toString('utf8')).entries;
  if (sha(retainedPointer) !== expectedPointerSha || entries.length !== 2)
    throw new Error('Generations retained pointer bytes changed');
  const [pointer, locations, ...files] = await Promise.all([
    retrieve(pointerUrl, 16384, { timeoutMs: 30000 }),
    retrieve(locationsUrl, 262144, { timeoutMs: 30000 }),
    ...cases.map(item => retrieve(`https://generationsbehavioralhealth.com/wp-content/uploads/2026/04/price-transparency-${item.key}-2026-03.csv`,
      600000, { timeoutMs: 30000 })),
  ]);
  const pageText = locations.body.toString('utf8');
  if (pointer.status < 200 || pointer.status >= 300 || pointer.sha256 !== expectedPointerSha
      || locations.status !== 200 || locations.sha256 !== 'ef7f49ad9a661fca6b8ccefdbcfea121b7d300298ffd78967ba6b342a3c3b868'
      || !pageText.includes('60 West Street') || !pageText.includes('196 Colonial Drive')
      || !pageText.includes('44505'))
    throw new Error('Generations current root pointer or locations page changed');
  const retainedDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(retainedDir, { recursive: true });
  const records = [];
  for (let i = 0; i < cases.length; i++) {
    const item = cases[i], facility = roster.get(item.ccn), file = files[i];
    const fileUrl = `https://generationsbehavioralhealth.com/wp-content/uploads/2026/04/price-transparency-${item.key}-2026-03.csv`;
    const row = current.find(entry => entry.location_name === item.pointerName && entry.mrf_url === fileUrl);
    const entry = entries.find(value => value.locationName === item.pointerName && value.mrfUrl === fileUrl);
    const parsed = (await parsePayload(file.body, file.headers['content-type'] || 'text/csv')).parsed[0];
    if (!facility || facility['Facility Name'] !== item.rosterName || facility.Address !== item.rosterAddress
        || facility.State !== 'OH' || facility['ZIP Code'] !== item.rosterZip
        || !row || !entry || file.status !== 206 || file.body.length !== item.fileBytes
        || file.headers['content-range'] !== `bytes 0-${item.fileBytes - 1}/${item.fileBytes}`
        || file.sha256 !== item.fileSha
        || parsed.mrfHospitalName !== item.hospitalName || parsed.mrfLocationName !== item.locationName
        || parsed.mrfAddress !== item.address || parsed.mrfLicenseState !== 'CA'
        || parsed.declaredLastUpdated !== '2026-03-31' || parsed.cmsVersion !== '3.0.0'
        || !file.body.subarray(0, 4096).toString('utf8').includes('license_number|CA'))
      throw new Error(`Generations ${item.ccn} roster, pointer, or complete CSV changed`);
    const retained = path.join(retainedDir, `${file.sha256}.csv`);
    fs.writeFileSync(retained, file.body);
    records.push({
      ccn: item.ccn, roster_name: facility['Facility Name'], roster_address: facility.Address,
      roster_city: facility['City/Town'], roster_state: facility.State, roster_zip: facility['ZIP Code'],
      pointer_location_name: item.pointerName, mrf_url: fileUrl,
      file_http_status: file.status, file_sha256: file.sha256,
      file_bytes: file.body.length, file_total_bytes: item.fileBytes,
      retained_file: path.relative(root, retained).replaceAll('\\', '/'),
      full_csv_retained: true, declared_hospital_name: parsed.mrfHospitalName,
      declared_location_name: parsed.mrfLocationName, declared_address: parsed.mrfAddress,
      literal_license_header: 'license_number|CA', declared_license_state: parsed.mrfLicenseState,
      declared_date: parsed.declaredLastUpdated, version: parsed.cmsVersion,
      observed_at: file.checkedAt,
      next_action: 'Ask the publisher to correct or explain the literal license_number|CA field in this Ohio hospital CSV. Independently validate the rate rows and recheck the exact pointer/file after a publisher change; do not infer legal compliance or failure from this field alone.',
    });
  }
  const proof = {
    pointer_url: pointerUrl, pointer_sha256: expectedPointerSha, pointer_http_status: pointer.status,
    pointer_rechecked_at: pointer.checkedAt, pointer_entry_count: entries.length,
    locations_page_url: locationsUrl, locations_page_sha256: locations.sha256,
    locations_page_http_status: locations.status, locations_page_observed_at: locations.checkedAt,
    records,
  };
  fs.writeFileSync(path.join(root, 'data/hpt-audit/reconciliation-generations-ohio-license-state-proof.json'),
    JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify({ records: records.length, pointer_sha256: proof.pointer_sha256,
    file_sha256s: records.map(record => record.file_sha256) }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
