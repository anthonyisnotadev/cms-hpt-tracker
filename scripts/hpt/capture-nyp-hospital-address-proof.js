'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { csvToObjects } = require('./lib/util');
const { parsePointer } = require('./lib/parse');
const { retrieve, zipEntries } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const pointerUrl = 'https://nyp.org/cms-hpt.txt';
const pageUrl = 'https://www.nyp.org/patients-visitors/paying-for-care/hospital-price-transparency';
const identityUrl = 'https://www.nyp.org/locations/manhattan/nyp-weill-cornell-medical-center';
const fileUrl = 'https://nyp.widen.net/content/hisgjrgpuk/original/133957095_NewYork-Presbyterian-Hospital_standardcharges.json.zip?u=n8xzey&download=true';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

async function main() {
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === '330101');
  if (roster?.['Facility Name'] !== 'NEW YORK-PRESBYTERIAN HOSPITAL'
      || roster.Address !== '525 EAST 68TH STREET' || roster['ZIP Code'] !== '10065'
      || roster.State !== 'NY') throw new Error('NYP roster changed');
  const rows = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/hpt/pointer-corpus/cms_hpt_entries.csv'), 'utf8'));
  const shared = rows.filter(row => row.pointer_url === pointerUrl && row.mrf_url === fileUrl
    && row.pointer_sha256 === 'f6e58d6e9e82fac0c0483c3bd65597ce1fc8997dbba1d31a0b53de0f4a909576');
  if (shared.length !== 7 || !shared.some(row => row.location_name === 'NewYork-Presbyterian Weill Cornell Medical Center'))
    throw new Error('NYP shared-file corpus entries changed');
  const pointerRaw = fs.readFileSync(path.join(root, shared[0].raw_file));
  const pointerHash = sha(pointerRaw);
  const entries = parsePointer(pointerRaw.toString('utf8')).entries;
  if (pointerHash !== shared[0].pointer_sha256
      || entries.filter(entry => entry.mrfUrl === fileUrl).length !== 7)
    throw new Error('NYP retained pointer bytes changed');
  const [page, identity, file] = await Promise.all([
    retrieve(pageUrl, 524288, { timeoutMs: 30000 }),
    retrieve(identityUrl, 524288, { timeoutMs: 30000 }),
    retrieve(fileUrl, 4000000, { timeoutMs: 45000 }),
  ]);
  const pageText = page.body.toString('utf8'), identityText = identity.body.toString('utf8');
  if (page.status !== 206 || !pageText.includes('NewYork-Presbyterian Hospital')
      || !pageText.includes('NewYork-Presbyterian Weill Cornell Medical Center')
      || !pageText.includes('hisgjrgpuk') || identity.status !== 206
      || !identityText.includes('525 East 68th Street') || !identityText.includes('10065')
      || file.status !== 206 || file.body.length !== 3452858
      || file.headers['content-range'] !== 'bytes 0-3452857/3452858'
      || file.sha256 !== '98a205e7e0241f5595c414d1ba1cf50ae0b131d68ee1399a1c0f6aefb45a71a8')
    throw new Error('NYP current page, identity page, or complete archive changed');
  const members = zipEntries(file.body);
  if (members.length !== 1 || members[0].method !== 8 || !members[0].name.endsWith('.json'))
    throw new Error('NYP ZIP member structure changed');
  const member = zlib.inflateRawSync(file.body.subarray(members[0].start, members[0].start + members[0].size));
  const json = JSON.parse(member.toString('utf8'));
  const declaredAddress = '525 East 68th Street New York NY 10021';
  if (member.length !== 228944591 || json.version !== '3.0.0' || json.last_updated_on !== '2026-03-31'
      || !String(json.hospital_name).includes('NewYork-Presbyterian Weill Cornell Medical Center')
      || !Array.isArray(json.hospital_address) || !json.hospital_address.includes(declaredAddress)
      || !JSON.stringify(json.location_name).includes('NewYork-Presbyterian Weill Cornell Medical Center')
      || !Array.isArray(json.standard_charge_information))
    throw new Error('NYP full JSON metadata or structure changed');
  const retainedDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(retainedDir, { recursive: true });
  const retained = path.join(retainedDir, `${file.sha256}.zip`);
  fs.writeFileSync(retained, file.body);
  const proof = {
    ccn: '330101', roster_name: roster['Facility Name'], roster_address: roster.Address,
    roster_city: roster['City/Town'], roster_state: roster.State, roster_zip: roster['ZIP Code'],
    pointer_url: pointerUrl, pointer_sha256: pointerHash, pointer_shared_file_entries: 7,
    pointer_location_name: 'NewYork-Presbyterian Weill Cornell Medical Center',
    source_page_url: pageUrl, source_page_sha256: page.sha256, source_page_status: page.status,
    identity_page_url: identityUrl, identity_page_sha256: identity.sha256, identity_page_status: identity.status,
    identity_page_address: '525 East 68th Street New York NY 10065',
    file_url: fileUrl, file_http_status: file.status, file_sha256: file.sha256,
    file_bytes: file.body.length, file_total_bytes: 3452858,
    retained_file: path.relative(root, retained).replaceAll('\\', '/'),
    member_name: members[0].name, member_sha256: sha(member), member_bytes: member.length,
    json_syntax_valid: true, standard_charge_information_entries: json.standard_charge_information.length,
    declared_hospital_name: json.hospital_name, declared_location_name: json.location_name,
    declared_addresses: json.hospital_address, declared_address: declaredAddress,
    declared_license_information: json.license_information,
    declared_date: json.last_updated_on, declared_version: json.version,
    observed_at: file.checkedAt,
    next_action: 'Ask the publisher to reconcile the Weill Cornell hospital_address ZIP 10021 with its current 10065 campus page and roster. Retain the shared pointer/file linkage; validate individual rate records separately before any full-file quality or legal claim.',
  };
  fs.writeFileSync(path.join(root, 'data/hpt-audit/reconciliation-nyp-hospital-address-proof.json'),
    JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify({ ccn: proof.ccn, pointer_sha256: pointerHash, file_sha256: file.sha256,
    member_sha256: proof.member_sha256, rate_entries: proof.standard_charge_information_entries,
    declared_address: proof.declared_address, identity_page_address: proof.identity_page_address }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
